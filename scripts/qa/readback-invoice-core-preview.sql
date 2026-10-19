SELECT
  p.prosecdef AS security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261017204700'
  ) AS ledger_applied
FROM pg_proc p
WHERE p.oid='public.create_invoice_with_lines_atomico(uuid,uuid,jsonb,jsonb)'::regprocedure;
