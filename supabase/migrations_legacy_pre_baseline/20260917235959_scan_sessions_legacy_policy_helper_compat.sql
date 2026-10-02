-- 20260917235959_scan_sessions_legacy_policy_helper_compat.sql
-- Compatibility shim: define temporalmente public.current_user_empresa_id()
-- delegando a la función canónica public.current_empresa_id(), permitiendo
-- que la migración histórica intacta 20260918000001_scan_sessions.sql pueda
-- ejecutarse sin errores en una base de datos limpia.
-- Esta función temporal es eliminada limpiamente en 20260918030000.

create or replace function public.current_user_empresa_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select public.current_empresa_id();
$$;
