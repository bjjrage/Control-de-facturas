-- Read-only. Run ONLY against kyiihlkncatojvlasoag (isolated PR #38 branch).
-- The login needs SELECT on supabase_migrations.schema_migrations.
-- This file grants no permissions and changes no rows or schema.
WITH expected(version) AS (
  VALUES ('20261018120000'),('20261018120100'),('20261018120200'),
         ('20261018120300'),('20261018120400'),('20261018120500'),
         ('20261018120600'),('20261018120700'),('20261018120800'),
         ('20261018120900'),('20261019165649')
), ledger AS (
  SELECT e.version, m.name, m.version IS NOT NULL AS applied
  FROM expected e LEFT JOIN supabase_migrations.schema_migrations m USING(version)
), functions AS (
  SELECT n.nspname AS schema, p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prosecdef AS security_definer, p.proconfig AS config,
    md5(pg_get_functiondef(p.oid)) AS definition_md5,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='private' AND p.proname IN (
    'guard_proforma_void_with_work_order','guard_project_cost_price_tenant',
    'lock_work_order_responsible_role','guard_sales_emission_cap',
    'inventory_opening_guard','inventory_opening_key'
  )) OR (n.nspname='public' AND p.proname IN (
    'ejecutar_orden_pago_atomica','mark_apto_y_crear_op_atomica',
    'inventory_portal_receipt','rfq_create_cost_once'
  ))
), triggers AS (
  SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,
    t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND t.tgfoid IN (
    SELECT p.oid FROM pg_proc p JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE pn.nspname='private' AND p.proname IN (
      'guard_proforma_void_with_work_order','guard_project_cost_price_tenant',
      'lock_work_order_responsible_role','guard_sales_emission_cap','inventory_opening_guard'
    )
  )
)
SELECT jsonb_build_object(
  'ledger',(SELECT jsonb_agg(to_jsonb(ledger) ORDER BY version) FROM ledger),
  'functions',(SELECT jsonb_agg(to_jsonb(functions) ORDER BY schema,name) FROM functions),
  'triggers',(SELECT jsonb_agg(to_jsonb(triggers) ORDER BY schema,table_name,name) FROM triggers),
  'payment_constraint',(SELECT jsonb_agg(jsonb_build_object(
    'name',conname,'validated',convalidated,'definition',pg_get_constraintdef(oid)
  )) FROM pg_constraint WHERE conname='payment_order_executed_account_required'),
  'portal_expiry_not_null',(SELECT attnotnull FROM pg_attribute
    WHERE attrelid='public.warehouse_portal_links'::regclass AND attname='expires_at')
) AS verification;
