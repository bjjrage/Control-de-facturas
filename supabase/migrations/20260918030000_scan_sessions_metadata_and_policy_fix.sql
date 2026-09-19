-- 20260918030000_scan_sessions_metadata_and_policy_fix.sql
-- Forward-only fix:
-- 1. Ajuste idempotente de políticas RLS para scan_sessions usando la función canónica public.current_empresa_id()
-- 2. Actualización de scan_session_create_atomic para aceptar y persistir p_metadata jsonb
-- 3. Eliminación de la sobrecarga anterior sin p_metadata para garantizar firma única no ambigua

-- 1. Políticas RLS con public.current_empresa_id()
drop policy if exists "internal read scan_sessions" on public.scan_sessions;
create policy "internal read scan_sessions" on public.scan_sessions
  for select using (
    empresa_id = public.current_empresa_id()
  );

drop policy if exists "internal insert scan_sessions" on public.scan_sessions;
create policy "internal insert scan_sessions" on public.scan_sessions
  for insert with check (
    empresa_id = public.current_empresa_id()
  );

drop policy if exists "internal update scan_sessions" on public.scan_sessions;
create policy "internal update scan_sessions" on public.scan_sessions
  for update using (
    empresa_id = public.current_empresa_id()
  );

-- 2. Eliminar firma anterior de scan_session_create_atomic (9 argumentos) para evitar ambigüedad
drop function if exists public.scan_session_create_atomic(
  uuid, uuid, text, text, timestamptz, text, text, text, text
);

-- 3. Crear versión canónica de scan_session_create_atomic con soporte para p_metadata (10 argumentos)
create or replace function public.scan_session_create_atomic(
  p_empresa_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_pin_code text,
  p_expires_at timestamptz,
  p_context_type text default 'general',
  p_context_id text default null,
  p_target_field text default null,
  p_storage_bucket text default 'invoice-files',
  p_metadata jsonb default '{}'::jsonb
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

  -- Insertar nueva sesión preservando metadata y garantizando unicidad mediante índice parcial
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
    metadata,
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
    coalesce(p_metadata, '{}'::jsonb),
    'waiting'
  )
  returning * into v_session;

  return v_session;
end;
$$;

-- 4. Permisos estrictos: revocar de público/anon/authenticated y conceder exclusivamente a service_role
revoke all on function public.scan_session_create_atomic(
  uuid, uuid, text, text, timestamptz, text, text, text, text, jsonb
) from public, authenticated, anon;

grant execute on function public.scan_session_create_atomic(
  uuid, uuid, text, text, timestamptz, text, text, text, text, jsonb
) to service_role;
