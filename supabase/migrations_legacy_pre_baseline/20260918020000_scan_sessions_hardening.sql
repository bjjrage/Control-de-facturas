-- 20260918020000_scan_sessions_hardening.sql
-- Hotfix forward-only: endurecimiento de scan_sessions, credenciales móviles dedicadas,
-- rate-limiting atómico y prevención de colisión global de PINs.

-- 1. Nuevas columnas para credencial móvil independiente y protección brute-force de PIN
alter table public.scan_sessions
  add column if not exists mobile_claim_token_hash text unique,
  add column if not exists claimed_at timestamptz,
  add column if not exists pin_failed_attempts integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- 2. Índice para resolución rápida de credenciales móviles
create index if not exists idx_scan_sessions_mobile_claim_hash
  on public.scan_sessions (mobile_claim_token_hash);

-- 3. Tabla persistente para rate-limiting de PIN por actor/origen (IP/fingerprint)
create table if not exists public.scan_pin_attempts (
  actor_key text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);

create index if not exists idx_scan_pin_attempts_locked_until
  on public.scan_pin_attempts (locked_until)
  where locked_until is not null;

-- Habilitar RLS en scan_pin_attempts (solo backend service_role tiene acceso)
alter table public.scan_pin_attempts enable row level security;

-- 4. Función RPC atómica para reclamo de sesión (Compare-and-Set)
-- Invalida token_hash para que el QR token inicial NO sirva más para operaciones posteriores
create or replace function public.scan_session_claim_atomic(
  p_session_id uuid,
  p_mobile_claim_token_hash text,
  p_device_info jsonb default '{}'::jsonb,
  p_user_id uuid default null
)
returns public.scan_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.scan_sessions;
begin
  update public.scan_sessions
  set status = 'connected',
      mobile_claim_token_hash = p_mobile_claim_token_hash,
      token_hash = 'CLAIMED:' || token_hash, -- Invalida QR token para cualquier operación futura
      claimed_device_info = coalesce(p_device_info, '{}'::jsonb),
      claimed_by_user_id = p_user_id,
      claimed_at = now()
  where id = p_session_id
    and status = 'waiting'
    and expires_at > now()
  returning * into v_session;

  return v_session;
end;
$$;

-- 5. Función RPC atómica para finalización de sesión (Anti-Double-Completion)
-- Invalida mobile_claim_token_hash inmediatamente al completar
create or replace function public.scan_session_complete_atomic(
  p_session_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_size bigint,
  p_page_count integer
)
returns public.scan_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.scan_sessions;
begin
  update public.scan_sessions
  set status = 'completed',
      storage_path = p_storage_path,
      file_name = p_file_name,
      file_size_bytes = p_file_size,
      page_count = p_page_count,
      completed_at = now(),
      mobile_claim_token_hash = null -- Invalida la credencial móvil inmediatamente
  where id = p_session_id
    and status in ('connected', 'scanning', 'processing')
    and expires_at > now()
  returning * into v_session;

  return v_session;
end;
$$;

-- 6. Garantía DB-backed contra colisión de PIN entre sesiones y tenants:
-- Índice único parcial que asegura que solo una sesión en estado 'waiting' puede tener un determinado pin_code en todo el sistema.
create unique index if not exists idx_scan_sessions_unique_active_pin
  on public.scan_sessions (pin_code)
  where status = 'waiting';

-- 7. Rate limiting atómico contra colisión / lost updates por concurrencia
create or replace function public.scan_pin_record_failed_attempt(
  p_actor_key text,
  p_max_attempts integer default 5,
  p_lockout_seconds integer default 900
)
returns table(
  failed_attempts integer,
  locked_until timestamptz,
  is_locked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_locked_until timestamptz;
begin
  insert into public.scan_pin_attempts (actor_key, failed_attempts, last_attempt_at, locked_until)
  values (p_actor_key, 1, v_now, null)
  on conflict (actor_key) do update
  set
    failed_attempts = case
      when scan_pin_attempts.locked_until is not null and scan_pin_attempts.locked_until <= v_now then 1
      else scan_pin_attempts.failed_attempts + 1
    end,
    locked_until = case
      when scan_pin_attempts.locked_until is not null and scan_pin_attempts.locked_until <= v_now then null
      when (scan_pin_attempts.failed_attempts + 1) >= p_max_attempts
        then v_now + (p_lockout_seconds || ' seconds')::interval
      else scan_pin_attempts.locked_until
    end,
    last_attempt_at = v_now
  returning scan_pin_attempts.failed_attempts, scan_pin_attempts.locked_until
  into v_attempts, v_locked_until;

  return query select
    v_attempts,
    v_locked_until,
    (v_locked_until is not null and v_locked_until > v_now);
end;
$$;

-- 8. Verificación atómica de bloqueo de actor
create or replace function public.scan_pin_check_actor_lock(
  p_actor_key text
)
returns table(
  is_locked boolean,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row record;
begin
  select * into v_row from public.scan_pin_attempts where actor_key = p_actor_key;
  if found and v_row.locked_until is not null and v_row.locked_until > v_now then
    return query select true, v_row.locked_until;
  else
    return query select false, null::timestamptz;
  end if;
end;
$$;

-- 9. Reset de intentos fallidos al tener éxito
create or replace function public.scan_pin_reset_actor_attempts(
  p_actor_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.scan_pin_attempts where actor_key = p_actor_key;
end;
$$;

-- 10. Función atómica para creación de sesión con limpieza de expirados y detección de colisiones
create or replace function public.scan_session_create_atomic(
  p_empresa_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_pin_code text,
  p_expires_at timestamptz,
  p_context_type text default 'general',
  p_context_id text default null,
  p_target_field text default null,
  p_storage_bucket text default 'invoice-files'
)
returns public.scan_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.scan_sessions;
begin
  -- Limpiar sesiones expiradas que puedan estar reteniendo un PIN en el índice parcial
  update public.scan_sessions
  set status = 'expired'
  where status = 'waiting' and expires_at <= clock_timestamp();

  -- Intentar insertar la nueva sesión (el índice único parcial garantiza ausencia de colisión activa)
  insert into public.scan_sessions (
    empresa_id,
    created_by,
    token_hash,
    pin_code,
    expires_at,
    context_type,
    context_id,
    target_field,
    storage_bucket,
    status
  ) values (
    p_empresa_id,
    p_user_id,
    p_token_hash,
    p_pin_code,
    p_expires_at,
    p_context_type,
    p_context_id,
    p_target_field,
    p_storage_bucket,
    'waiting'
  )
  returning * into v_session;

  return v_session;
end;
$$;

-- 11. Revocar ejecución de RPCs privilegiadas a clientes (solo service_role puede ejecutarlas)
revoke all on function public.scan_session_claim_atomic(uuid, text, jsonb, uuid) from public, authenticated, anon;
grant execute on function public.scan_session_claim_atomic(uuid, text, jsonb, uuid) to service_role;

revoke all on function public.scan_session_complete_atomic(uuid, text, text, bigint, integer) from public, authenticated, anon;
grant execute on function public.scan_session_complete_atomic(uuid, text, text, bigint, integer) to service_role;

revoke all on function public.scan_pin_record_failed_attempt(text, integer, integer) from public, authenticated, anon;
grant execute on function public.scan_pin_record_failed_attempt(text, integer, integer) to service_role;

revoke all on function public.scan_pin_check_actor_lock(text) from public, authenticated, anon;
grant execute on function public.scan_pin_check_actor_lock(text) to service_role;

revoke all on function public.scan_pin_reset_actor_attempts(text) from public, authenticated, anon;
grant execute on function public.scan_pin_reset_actor_attempts(text) to service_role;

revoke all on function public.scan_session_create_atomic(uuid, uuid, text, text, timestamptz, text, text, text, text) from public, authenticated, anon;
grant execute on function public.scan_session_create_atomic(uuid, uuid, text, text, timestamptz, text, text, text, text) to service_role;
