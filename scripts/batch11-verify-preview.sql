-- B11 Preview catalog verification. Read-only: no identity impersonation, no business DML.
BEGIN READ ONLY;
DO $$
BEGIN
 ASSERT (SELECT count(*) FROM supabase_migrations.schema_migrations)=52, 'Unexpected Preview ledger';
 ASSERT NOT has_function_privilege('anon','public.claim_invoice_job()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.claim_invoice_job()','EXECUTE');
 ASSERT has_function_privilege('service_role','public.claim_invoice_job()','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.mark_invoice_apto_para_pago(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.mark_invoice_pagado(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.log_audit_event(text,uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.cuentas_financieras','INSERT');
 ASSERT NOT has_column_privilege('authenticated','public.cuentas_financieras','saldo','UPDATE');
 ASSERT has_column_privilege('authenticated','public.cuentas_financieras','nombre','UPDATE');
 ASSERT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('b11_profile_authority','b11_invoice_financial_status','b11_op_financial_status') AND tgenabled='O')=3;
 ASSERT (SELECT count(*) FROM pg_constraint WHERE conname IN ('b11_invoice_provider_tenant','b11_invoice_attachment_tenant','b11_op_provider_tenant') AND contype='f')=3;
 ASSERT pg_get_functiondef('public.current_empresa_id()'::regprocedure) LIKE '%p.active%';
 ASSERT pg_get_functiondef('public.current_profile_role()'::regprocedure) LIKE '%p.active%';
 ASSERT pg_get_functiondef('public.ejecutar_orden_pago_atomica(uuid,uuid,uuid,uuid)'::regprocedure) LIKE '%i.status = ''APTO_PARA_PAGO''%';
 ASSERT pg_get_functiondef('public.recompute_invoice_status(uuid)'::regprocedure) LIKE '%where id=p_invoice_id for update%';
 ASSERT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('b11_invoice_order_relationship','b11_op_invoice_relationship','b11_settled_invoice_delete') AND tgenabled='O')=3;
 ASSERT pg_get_functiondef('private.b11_guard_invoice_order_relationship()'::regprocedure) LIKE '%ORDER BY i.id FOR UPDATE%';
 ASSERT pg_get_functiondef('private.b11_guard_invoice_order_relationship()'::regprocedure) LIKE '%ORDER BY o.id FOR UPDATE%';
 ASSERT pg_get_functiondef('private.b11_guard_op_invoice_relationship()'::regprocedure) LIKE '%ORDER BY p.id FOR UPDATE%';
 ASSERT pg_get_functiondef('private.b11_guard_op_invoice_relationship()'::regprocedure) LIKE '%ORDER BY i.id FOR UPDATE%';
 ASSERT (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE oid IN ('private.b11_guard_invoice_order_relationship()'::regprocedure,'private.b11_guard_op_invoice_relationship()'::regprocedure,'private.b11_guard_settled_invoice_delete()'::regprocedure));
 ASSERT pg_get_functiondef('private.b11_guard_invoice_order_relationship()'::regprocedure) LIKE '%''APTO_PARA_PAGO'',''PAGADO''%';
 ASSERT pg_get_functiondef('private.b11_guard_op_invoice_relationship()'::regprocedure) LIKE '%''EJECUTADA''%';
END;
$$;
SELECT 'PASS' AS defensive_catalog_verification,52 AS expected_preview_ledger;
ROLLBACK;
