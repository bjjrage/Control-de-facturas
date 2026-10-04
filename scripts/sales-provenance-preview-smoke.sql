-- PREVIEW ONLY. Synthetic domain fixtures and SQL auth context, always rolled back.
-- This verifies database behavior; it is not an authenticated browser smoke.
BEGIN;
SET LOCAL search_path = public, extensions;
DO $$
DECLARE
  tenant uuid; actor uuid; client uuid; other_tenant uuid;
  quote uuid; rem uuid; rem2 uuid; invoice uuid; direct_invoice uuid; nc uuid; legacy uuid;
  token uuid; token_hash text; version integer; ot uuid; receipt uuid; account uuid;
  result jsonb; sources jsonb; before_sales integer; before_receipts integer;
BEGIN
  SELECT p.id,p.empresa_id INTO actor,tenant FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
    WHERE p.active AND e.active AND p.role::text IN ('admin','administracion')
    ORDER BY p.created_at LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'No eligible Preview fixture actor'; END IF;
  -- Preview fixtures have Sales disabled. This setting is also rolled back.
  UPDATE public.empresas SET modulo_ventas=true WHERE id=tenant;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  SELECT id INTO other_tenant FROM public.empresas WHERE id<>tenant LIMIT 1;
  EXECUTE 'SET LOCAL ROLE authenticated';
  sources:=public.cashflow_read_sources(current_date,current_date+30);
  before_sales:=jsonb_array_length(sources->'sales'); before_receipts:=jsonb_array_length(sources->'receipts');

  INSERT INTO public.clients(empresa_id,name) VALUES(tenant,'B10 rollback fixture') RETURNING id INTO client;
  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,created_by)
    VALUES(tenant,client,'PROFORMA',actor) RETURNING id INTO quote;
  INSERT INTO public.sales_document_items(sales_document_id,description,quantity,unit_price,vat_rate,line_total)
    VALUES(quote,'B10 service',1,100,10,100);
  SELECT quotation_version INTO version FROM public.sales_documents WHERE id=quote;
  token_hash:=encode(digest(gen_random_uuid()::text,'sha256'),'hex');
  INSERT INTO public.sales_quotation_tokens(empresa_id,sales_document_id,quotation_version,token_hash,token_prefix,created_by)
    VALUES(tenant,quote,version,token_hash,'B10test',actor) RETURNING id INTO token;
  UPDATE public.sales_documents SET acceptance_status='PENDING_ACCEPTANCE' WHERE id=quote;
  -- Acceptance is intentionally service-only in the existing portal contract.
  EXECUTE 'RESET ROLE';
  result:=public.accept_quotation(token_hash,'B10 fixture',NULL,NULL,NULL,'B10 rollback test');
  IF result->>'already_accepted'<>'false' THEN RAISE EXCEPTION 'First acceptance failed'; END IF;
  result:=public.accept_quotation(token_hash,'B10 fixture',NULL,NULL,NULL,NULL);
  IF result->>'already_accepted'<>'true' THEN RAISE EXCEPTION 'Acceptance idempotency failed'; END IF;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT id INTO ot FROM public.work_orders WHERE sales_document_id=quote AND empresa_id=tenant;
  IF ot IS NULL OR (SELECT count(*) FROM public.sales_quotation_acceptances WHERE sales_document_id=quote)<>1 THEN
    RAISE EXCEPTION 'Canonical acceptance/OT missing';
  END IF;

  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
    VALUES(tenant,client,'REMISION',quote,actor) RETURNING id INTO rem;
  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
    VALUES(tenant,client,'REMISION',quote,actor) RETURNING id INTO rem2;
  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
    VALUES(tenant,client,'FACTURA',quote,actor) RETURNING id INTO direct_invoice;
  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
    VALUES(tenant,client,'FACTURA',rem,actor) RETURNING id INTO invoice;
  INSERT INTO public.sales_document_items(sales_document_id,description,quantity,unit_price,vat_rate,line_total)
    VALUES(rem,'B10 delivery',1,100,10,100),(rem2,'B10 delivery 2',1,100,10,100),
          (direct_invoice,'B10 direct invoice',1,100,10,100),(invoice,'B10 invoice',1,100,10,100);
  sources:=public.cashflow_read_sources(current_date,current_date+30);
  IF jsonb_array_length(sources->'sales')<>before_sales THEN RAISE EXCEPTION 'Accepted quote/remision/draft duplicated receivable'; END IF;
  BEGIN
    DELETE FROM public.sales_documents WHERE id=rem;
    RAISE EXCEPTION 'DELETE unexpectedly allowed';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE public.sales_documents SET source_document_id=NULL WHERE id=invoice;
    RAISE EXCEPTION 'NULL source unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%inmutable%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.sales_documents SET source_document_id=quote WHERE id=invoice;
    RAISE EXCEPTION 'Repoint unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%inmutable%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.sales_documents SET status='ANULADA' WHERE id=rem;
    RAISE EXCEPTION 'Parent annulment unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%derivados activos%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
      VALUES(other_tenant,client,'REMISION',quote,actor);
    RAISE EXCEPTION 'Cross tenant unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%origen de esta empresa%' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
      VALUES(tenant,client,'FACTURA',gen_random_uuid(),actor);
    RAISE EXCEPTION 'Missing source unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%origen de esta empresa%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.work_orders SET total=total+1 WHERE id=ot;
    BEGIN
      UPDATE public.sales_documents SET status='EMITIDA' WHERE id=invoice;
      RAISE EXCEPTION 'Snapshot mismatch unexpectedly allowed';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%snapshot%' THEN RAISE; END IF; END;
    -- Abort subtransaction to restore the synthetic OT snapshot.
    RAISE EXCEPTION 'restore fixture';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'restore fixture' THEN RAISE; END IF; END;
  UPDATE public.sales_documents SET status='EMITIDA' WHERE id=invoice;
  sources:=public.cashflow_read_sources(current_date,current_date+30);
  IF jsonb_array_length(sources->'sales')<>before_sales+1 THEN RAISE EXCEPTION 'Invoice receivable not exactly once'; END IF;
  UPDATE public.sales_documents SET status='EMITIDA' WHERE id=rem;
  UPDATE public.sales_documents SET status='EMITIDA' WHERE id=direct_invoice;
  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,source_document_id,created_by)
    VALUES(tenant,client,'NOTA_CREDITO',invoice,actor) RETURNING id INTO nc;
  INSERT INTO public.sales_document_items(sales_document_id,description,quantity,unit_price,vat_rate,line_total)
    VALUES(nc,'B10 credit',1,10,10,10);
  UPDATE public.sales_documents SET status='EMITIDA' WHERE id=nc;
  sources:=public.cashflow_read_sources(current_date,current_date+30);
  IF jsonb_array_length(sources->'sales')<>before_sales+2 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(sources->'sales') d WHERE d->>'doc_type' NOT IN ('FACTURA','NOTA_VENTA')
  ) THEN RAISE EXCEPTION 'REMISION/NC duplicated future receivable'; END IF;
  -- Historical read fixture only; NOTA_VENTA is prohibited by the current editor actions.
  INSERT INTO public.sales_documents(empresa_id,client_id,doc_type,created_by)
    VALUES(tenant,client,'NOTA_VENTA',actor) RETURNING id INTO legacy;
  INSERT INTO public.sales_document_items(sales_document_id,description,quantity,unit_price,vat_rate,line_total)
    VALUES(legacy,'B10 historical read fixture',1,100,10,100);
  UPDATE public.sales_documents SET status='EMITIDA' WHERE id=legacy;
  sources:=public.cashflow_read_sources(current_date,current_date+30);
  IF (SELECT count(*) FROM jsonb_array_elements(sources->'sales') d WHERE d->>'id'=legacy::text AND d->>'doc_type'='NOTA_VENTA')<>1 THEN
    RAISE EXCEPTION 'B09 legacy NOTA_VENTA read regression';
  END IF;
  UPDATE public.sales_documents SET status='ANULADA' WHERE id=legacy;

  -- Bank fixture setup uses the SQL runner; normal collections use the existing guarded RPC.
  EXECUTE 'RESET ROLE';
  INSERT INTO public.cuentas_financieras(empresa_id,nombre,tipo,moneda,created_by)
    VALUES(tenant,'B10 rollback bank','BANCO','PYG',actor) RETURNING id INTO account;
  EXECUTE 'SET LOCAL ROLE authenticated';
  receipt:=public.registrar_cobro_atomico(tenant,invoice,40,'TRANSFERENCIA',current_date,NULL,NULL,account,actor);
  IF (SELECT total-cobrado_amount FROM public.sales_documents WHERE id=invoice)<>60 THEN RAISE EXCEPTION 'Remaining balance incorrect'; END IF;
  sources:=public.cashflow_read_sources(current_date,current_date+30);
  IF (SELECT (d->>'total')::numeric-(d->>'cobrado_amount')::numeric FROM jsonb_array_elements(sources->'sales') d
      WHERE d->>'id'=invoice::text) IS DISTINCT FROM 60::numeric THEN RAISE EXCEPTION 'B09 remaining balance incorrect'; END IF;
  IF jsonb_array_length(sources->'receipts')<>before_receipts+1
    OR (SELECT count(*) FROM jsonb_array_elements(sources->'receipts') r WHERE r->>'id'=receipt::text)<>1
    OR (SELECT count(*) FROM jsonb_array_elements(sources->'movements') m WHERE m->>'sales_receipt_id'=receipt::text)<>1 THEN
    RAISE EXCEPTION 'Receipt/treasury factual linkage incorrect';
  END IF;
  PERFORM public.revertir_cobro_atomico(tenant,receipt,'B10 rollback reversal',actor);
  PERFORM public.revertir_cobro_atomico(tenant,receipt,'B10 rollback reversal retry',actor);
  IF (SELECT cobrado_amount FROM public.sales_documents WHERE id=invoice)<>0 THEN RAISE EXCEPTION 'Reversal idempotency failed'; END IF;
  UPDATE public.sales_documents SET status='ANULADA' WHERE id=nc;
  UPDATE public.sales_documents SET status='ANULADA' WHERE id=invoice;
  UPDATE public.sales_documents SET status='ANULADA' WHERE id=rem;
  BEGIN
    UPDATE public.sales_documents SET status='EMITIDA' WHERE id=invoice;
    RAISE EXCEPTION 'Annulled source unexpectedly allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%anulado%' THEN RAISE; END IF; END;
  IF (SELECT source_document_id FROM public.sales_documents WHERE id=invoice) IS DISTINCT FROM rem THEN RAISE EXCEPTION 'Lost provenance'; END IF;
  RAISE NOTICE 'B10 PREVIEW PASS: acceptance/OT, branches, RESTRICT, immutable source, annulment, snapshot, tenant, emission, NC, cobro/reversal, B09';
END;
$$;
ROLLBACK;
SELECT 'B10 PREVIEW SMOKE PASS (all fixtures rolled back)' AS result;
