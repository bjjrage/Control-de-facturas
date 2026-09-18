-- 20260918020000_scan_sessions_hardening.sql
-- Hotfix forward-only: endurecimiento de scan_sessions, credenciales móviles dedicadas y operaciones atómicas.

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

-- 6. Revocar ejecución de RPCs privilegiadas a clientes (solo service_role puede ejecutarlas)
revoke all on function public.scan_session_claim_atomic(uuid, text, jsonb, uuid) from public, authenticated, anon;
grant execute on function public.scan_session_claim_atomic(uuid, text, jsonb, uuid) to service_role;

revoke all on function public.scan_session_complete_atomic(uuid, text, text, bigint, integer) from public, authenticated, anon;
grant execute on function public.scan_session_complete_atomic(uuid, text, text, bigint, integer) to service_role;

