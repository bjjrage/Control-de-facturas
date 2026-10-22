-- Scanner session rows contain credentials and private Storage object references.
-- Clients may read only the sessions allowed by their tenant/role; all mutations
-- remain behind the existing server/service-role scanner endpoints and RPCs.
ALTER TABLE public.scan_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal insert scan_sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "internal read scan_sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "internal update scan_sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "scanner sessions scoped read" ON public.scan_sessions;

CREATE POLICY "scanner sessions scoped read"
ON public.scan_sessions
FOR SELECT
TO authenticated
USING (
  empresa_id = (SELECT public.current_empresa_id())
  AND (
    (SELECT public.is_internal_role(ARRAY['admin', 'administracion']::public.user_role[]))
    OR (
      created_by = (SELECT auth.uid())
      AND context_type = 'general'
      AND (SELECT public.current_profile_role()) = 'comercial'::public.user_role
    )
  )
);

-- The browser only needs SELECT for owner-scoped Realtime/status consumers.
-- Session creation, state changes, PIN claims, and completion use the existing
-- trusted server client and service-only atomic RPC grants.
REVOKE ALL PRIVILEGES ON TABLE public.scan_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  empresa_id,
  created_by,
  context_type,
  context_id,
  target_field,
  status,
  expires_at,
  storage_path,
  file_name,
  file_size_bytes,
  page_count,
  created_at,
  claimed_at,
  completed_at
) ON TABLE public.scan_sessions TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.scan_sessions TO service_role;
