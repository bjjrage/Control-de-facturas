-- =============================================================================
-- quotation-acceptance-smoke.sql — Smoke test del flujo de aceptación (PUNTO 12)
--
-- ENTORNO: ejecutar SOLO en branch/entorno seguro con 0090+0091 aplicadas,
-- NUNCA en producción sin certificación. Rol: postgres o service_role
-- (bypasea RLS; el portal real usa anon + RPC, ver script .mjs concurrente).
--
-- QUÉ PRUEBA (fail-fast: cualquier ASSERT fallido aborta con EXCEPTION):
--   1. crear cotización (PROFORMA + ítems) → DRAFT v1, total > 0
--   2. generar link (hash, sin plaintext) → PENDING_ACCEPTANCE
--   3. aceptar → acceptance record completo + 1 OT + workflow resuelto
--   4. re-aceptar → idempotente (misma OT, mismo acceptance, already_accepted)
--   5. rechazo post-aceptación → bloqueado, sin OT extra
--   6. versionado: editar → V2, link V1 ya no acepta, link V2 sí
--   7. edición de aceptada → bloqueada por guard de inmutabilidad
--   8. SIN efectos colaterales: stock/OC/facturas/cobros/tesorería/pagos igual
--   9. constraints de idempotencia presentes
--  10. limpieza de datos de prueba
--  11. inmutabilidad del acceptance: UPDATE/DELETE directos bloqueados por
--      trigger; DELETE de cliente/cotización/tenant bloqueado por RESTRICT;
--      DELETE de token no destruye el record (SET NULL + snapshot)
--
-- CONCURRENCIA REAL (2 requests simultáneos): ver
-- scripts/quotation-acceptance-concurrent.mjs (requiere anon key del branch).
-- La garantía a nivel DB son los UNIQUE + locks del RPC (ver asserts §9).
-- =============================================================================

DO $$
DECLARE
  v_empresa uuid;
  v_client uuid;
  v_profile uuid;
  v_doc uuid;
  v_doc2 uuid;
  v_raw text;
  v_hash text;
  v_tok uuid;
  v_tok2 uuid;
  v_res jsonb;
  v_acc record;
  v_wo record;
  v_ver int;
  v_n_acc int; v_n_wo int;
  c_oc0 int; c_inv0 int; c_rec0 int; c_stock0 int; c_tes0 int; c_pay0 int;
  c_oc1 int; c_inv1 int; c_rec1 int; c_stock1 int; c_tes1 int; c_pay1 int;
BEGIN
  -- --- 0. Fixtures del branch (primera empresa/cliente/perfil) ---
  SELECT id INTO v_empresa FROM public.empresas ORDER BY created_at LIMIT 1;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'SMOKE: sin empresas en el branch'; END IF;
  SELECT id INTO v_client FROM public.clients WHERE empresa_id = v_empresa AND active ORDER BY created_at LIMIT 1;
  IF v_client IS NULL THEN
    INSERT INTO public.clients (empresa_id, name, email) VALUES (v_empresa, 'SMOKE Cliente', 'smoke@example.com') RETURNING id INTO v_client;
  END IF;
  SELECT id INTO v_profile FROM public.profiles WHERE empresa_id = v_empresa ORDER BY created_at LIMIT 1;

  -- --- 9 (temprano). Constraints de idempotencia presentes ---
  PERFORM 1 FROM pg_constraint WHERE conname = 'sales_quotation_acceptances_sales_document_id_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'SMOKE: falta UNIQUE en acceptances(sales_document_id)'; END IF;
  PERFORM 1 FROM pg_constraint WHERE conname = 'work_orders_sales_document_id_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'SMOKE: falta UNIQUE en work_orders(sales_document_id)'; END IF;
  PERFORM 1 FROM pg_indexes WHERE indexname = 'uq_quotation_tokens_hash';
  IF NOT FOUND THEN RAISE EXCEPTION 'SMOKE: falta índice único de token_hash'; END IF;
  -- Sin columna plaintext con secretos (PUNTO 2).
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sales_quotation_tokens' AND column_name = 'token';
  IF FOUND THEN RAISE EXCEPTION 'SMOKE: la columna plaintext token sigue existiendo'; END IF;
  -- Sin evento SENT (PUNTO 7): el CHECK vigente no debe admitirlo.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_quotation_events_type_allowed'
             AND pg_get_constraintdef(oid) ILIKE '%SENT%')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_quotation_events_type_allowed'
             AND pg_get_constraintdef(oid) ILIKE '%EMAIL_PREPARED%') THEN
    RAISE EXCEPTION 'SMOKE: el vocabulario de eventos no incluye EMAIL_PREPARED';
  END IF;
  RAISE NOTICE 'SMOKE §9 OK: constraints presentes, sin plaintext, vocabulario correcto';

  -- --- 8a. Contadores basales de efectos colaterales ---
  SELECT count(*) INTO c_oc0 FROM public.authorized_orders WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_inv0 FROM public.invoices WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_rec0 FROM public.sales_receipts WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_stock0 FROM public.stock_movimientos WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_tes0 FROM public.movimientos_tesoreria WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_pay0 FROM public.payment_orders WHERE empresa_id = v_empresa;

  -- --- 1. Crear cotización → DRAFT v1 ---
  INSERT INTO public.sales_documents (empresa_id, client_id, doc_type, currency, notes, created_by)
  VALUES (v_empresa, v_client, 'PROFORMA', 'PYG', 'SMOKE test', v_profile)
  RETURNING id INTO v_doc;
  INSERT INTO public.sales_document_items (sales_document_id, description, quantity, unit_price, vat_rate, line_total)
  VALUES (v_doc, 'SMOKE ítem A', 2, 100000, 10, 200000);
  PERFORM public.recompute_sales_document(v_doc);
  IF NOT EXISTS (SELECT 1 FROM public.sales_documents
                 WHERE id = v_doc AND acceptance_status = 'DRAFT' AND total > 0) THEN
    RAISE EXCEPTION 'SMOKE §1: la cotización no quedó DRAFT con total > 0';
  END IF;
  RAISE NOTICE 'SMOKE §1 OK: cotización % DRAFT', v_doc;

  -- --- 2. Generar link (hash, sin plaintext) → PENDING ---
  -- La versión se lee (los INSERT de ítems ya la bump-earon por trigger).
  SELECT quotation_version INTO v_ver FROM public.sales_documents WHERE id = v_doc;
  v_raw := rtrim(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  INSERT INTO public.sales_quotation_tokens
    (empresa_id, sales_document_id, quotation_version, token_hash, token_prefix, created_by)
  VALUES (v_empresa, v_doc, v_ver, v_hash, left(v_raw, 8), v_profile)
  RETURNING id INTO v_tok;
  UPDATE public.sales_documents
  SET acceptance_status = 'PENDING_ACCEPTANCE' WHERE id = v_doc;
  IF NOT EXISTS (SELECT 1 FROM public.sales_quotation_tokens WHERE id = v_tok AND token_hash = v_hash) THEN
    RAISE EXCEPTION 'SMOKE §2: token no persistido por hash';
  END IF;
  RAISE NOTICE 'SMOKE §2 OK: link por hash, PENDING';

  -- --- 3. Aceptar → acceptance record + OT + workflow ---
  v_res := public.accept_quotation(v_hash, 'Smoki Fuma', '1.111.111-1', 'dónde firmo', '203.0.113.10', 'smoke/1.0');
  IF (v_res->>'already_accepted') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'SMOKE §3: primera aceptación no devolvió already_accepted=false (%)', v_res;
  END IF;
  SELECT * INTO v_acc FROM public.sales_quotation_acceptances WHERE sales_document_id = v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'SMOKE §3: sin acceptance record'; END IF;
  -- PUNTO 1, campo por campo:
  IF v_acc.quotation_version IS DISTINCT FROM v_ver THEN RAISE EXCEPTION 'SMOKE §3: version snapshot mal'; END IF;
  IF v_acc.empresa_id IS DISTINCT FROM v_empresa THEN RAISE EXCEPTION 'SMOKE §3: tenant mal'; END IF;
  IF v_acc.client_id IS DISTINCT FROM v_client THEN RAISE EXCEPTION 'SMOKE §3: customer_id mal'; END IF;
  IF v_acc.client_name_snapshot IS NULL OR v_acc.total_snapshot <= 0 THEN RAISE EXCEPTION 'SMOKE §3: snapshots vacíos'; END IF;
  IF v_acc.currency_snapshot IS DISTINCT FROM 'PYG' THEN RAISE EXCEPTION 'SMOKE §3: currency mal'; END IF;
  IF v_acc.channel IS DISTINCT FROM 'PORTAL' THEN RAISE EXCEPTION 'SMOKE §3: canal mal'; END IF;
  IF v_acc.ip IS DISTINCT FROM '203.0.113.10' THEN RAISE EXCEPTION 'SMOKE §3: IP no registrada'; END IF;
  IF v_acc.user_agent IS DISTINCT FROM 'smoke/1.0' THEN RAISE EXCEPTION 'SMOKE §3: UA no registrado'; END IF;
  IF v_acc.token_id IS DISTINCT FROM v_tok THEN RAISE EXCEPTION 'SMOKE §3: token reference mal'; END IF;
  IF jsonb_array_length(v_acc.items_snapshot) <> 1 THEN RAISE EXCEPTION 'SMOKE §3: items snapshot mal'; END IF;
  IF v_acc.accepted_at IS NULL THEN RAISE EXCEPTION 'SMOKE §3: accepted_at nulo'; END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE sales_document_id = v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'SMOKE §3: sin OT'; END IF;
  IF v_acc.work_order_id IS DISTINCT FROM v_wo.id THEN RAISE EXCEPTION 'SMOKE §3: acceptance no apunta a la OT'; END IF;
  IF v_wo.workflow_status IS NULL OR v_wo.approval_mode IS NULL THEN RAISE EXCEPTION 'SMOKE §3: workflow sin resolver'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_quotation_events
                 WHERE sales_document_id = v_doc AND event_type = 'WORKFLOW_RESOLVED') THEN
    RAISE EXCEPTION 'SMOKE §3: sin evento WORKFLOW_RESOLVED';
  END IF;
  RAISE NOTICE 'SMOKE §3 OK: acceptance % + OT % + workflow %', v_acc.id, v_wo.code, v_wo.workflow_status;

  -- --- 4. Re-aceptar → idempotente ---
  v_res := public.accept_quotation(v_hash, 'Smoki Fuma', NULL, NULL, NULL, NULL);
  IF (v_res->>'already_accepted') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'SMOKE §4: segunda aceptación no idempotente (%)', v_res;
  END IF;
  SELECT count(*) INTO v_n_acc FROM public.sales_quotation_acceptances WHERE sales_document_id = v_doc;
  SELECT count(*) INTO v_n_wo FROM public.work_orders WHERE sales_document_id = v_doc;
  IF v_n_acc <> 1 OR v_n_wo <> 1 THEN RAISE EXCEPTION 'SMOKE §4: duplicados: acc=% ot=%', v_n_acc, v_n_wo; END IF;
  RAISE NOTICE 'SMOKE §4 OK: doble aceptación → 1 acceptance, 1 OT';

  -- --- 5. Rechazo post-aceptación bloqueado, sin OT extra ---
  BEGIN
    PERFORM public.reject_quotation(v_hash, 'cambié de idea', NULL, NULL, NULL);
    RAISE EXCEPTION 'SMOKE §5: el rechazo post-aceptación NO fue bloqueado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT ILIKE '%ya fue aceptada%' AND SQLERRM NOT ILIKE '%Orden de Trabajo%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_n_wo FROM public.work_orders WHERE sales_document_id = v_doc;
  IF v_n_wo <> 1 THEN RAISE EXCEPTION 'SMOKE §5: el rechazo tocó las OT'; END IF;
  RAISE NOTICE 'SMOKE §5 OK: rechazo post-aceptación bloqueado';

  -- --- 6. Versionado en segunda cotización: V1→V2 invalida link A ---
  INSERT INTO public.sales_documents (empresa_id, client_id, doc_type, currency, notes, created_by)
  VALUES (v_empresa, v_client, 'PROFORMA', 'PYG', 'SMOKE v', v_profile)
  RETURNING id INTO v_doc2;
  INSERT INTO public.sales_document_items (sales_document_id, description, quantity, unit_price, vat_rate, line_total)
  VALUES (v_doc2, 'SMOKE ítem', 1, 50000, 10, 50000);
  PERFORM public.recompute_sales_document(v_doc2);
  SELECT quotation_version INTO v_ver FROM public.sales_documents WHERE id = v_doc2;
  v_raw := rtrim(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  INSERT INTO public.sales_quotation_tokens
    (empresa_id, sales_document_id, quotation_version, token_hash, token_prefix, created_by)
  VALUES (v_empresa, v_doc2, v_ver, v_hash, left(v_raw, 8), v_profile)
  RETURNING id INTO v_tok2;
  UPDATE public.sales_documents SET acceptance_status = 'PENDING_ACCEPTANCE' WHERE id = v_doc2;
  -- editar → V2 (bump por trigger de ítems)
  INSERT INTO public.sales_document_items (sales_document_id, description, quantity, unit_price, vat_rate, line_total)
  VALUES (v_doc2, 'SMOKE ítem agregado', 1, 10000, 10, 10000);
  PERFORM public.recompute_sales_document(v_doc2);
  IF NOT EXISTS (SELECT 1 FROM public.sales_documents WHERE id = v_doc2 AND quotation_version > 1) THEN
    RAISE EXCEPTION 'SMOKE §6: la edición no bump-eó versión';
  END IF;
  BEGIN
    PERFORM public.accept_quotation(v_hash, 'Otro', NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'SMOKE §6: el link V1 aceptó la V2';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT ILIKE '%actualizada%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'SMOKE §6 OK: link V1 no acepta V2';

  -- --- 7. Edición de aceptada bloqueada por guard ---
  BEGIN
    UPDATE public.sales_documents SET notes = 'hack' WHERE id = v_doc;
    RAISE EXCEPTION 'SMOKE §7: edición de aceptada NO bloqueada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT ILIKE '%inmutable%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.sales_document_items (sales_document_id, description, quantity, unit_price, vat_rate, line_total)
    VALUES (v_doc, 'hack', 1, 1, 10, 1);
    RAISE EXCEPTION 'SMOKE §7: ítem en aceptada NO bloqueado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT ILIKE '%inmutable%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'SMOKE §7 OK: aceptada inmutable';

  -- --- 8b. Sin efectos colaterales ---
  SELECT count(*) INTO c_oc1 FROM public.authorized_orders WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_inv1 FROM public.invoices WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_rec1 FROM public.sales_receipts WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_stock1 FROM public.stock_movimientos WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_tes1 FROM public.movimientos_tesoreria WHERE empresa_id = v_empresa;
  SELECT count(*) INTO c_pay1 FROM public.payment_orders WHERE empresa_id = v_empresa;
  IF (c_oc0, c_inv0, c_rec0, c_stock0, c_tes0, c_pay0) IS DISTINCT FROM (c_oc1, c_inv1, c_rec1, c_stock1, c_tes1, c_pay1) THEN
    RAISE EXCEPTION 'SMOKE §8: EFECTOS COLATERALES oc=% inv=% rec=% stock=% tes=% pay=%',
      c_oc1 - c_oc0, c_inv1 - c_inv0, c_rec1 - c_rec0, c_stock1 - c_stock0, c_tes1 - c_tes0, c_pay1 - c_pay0;
  END IF;
  RAISE NOTICE 'SMOKE §8 OK: sin stock/compras/OC/facturas/cobros/tesorería/pagos';

  -- --- 11. Inmutabilidad del acceptance record (PUNTO 1 auditoría) ---
  -- UPDATE directo → rechazado por trigger (aplica a todos los roles).
  BEGIN
    UPDATE public.sales_quotation_acceptances SET acceptor_name = 'hack' WHERE sales_document_id = v_doc;
    RAISE EXCEPTION 'SMOKE §11: UPDATE de acceptance NO bloqueado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT ILIKE '%append-only%' THEN RAISE; END IF;
  END;
  -- DELETE directo → rechazado por trigger.
  BEGIN
    DELETE FROM public.sales_quotation_acceptances WHERE sales_document_id = v_doc;
    RAISE EXCEPTION 'SMOKE §11: DELETE de acceptance NO bloqueado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT ILIKE '%append-only%' THEN RAISE; END IF;
  END;
  -- DELETE del cliente → bloqueado por RESTRICT (evidencia intacta).
  BEGIN
    DELETE FROM public.clients WHERE id = v_client;
    RAISE EXCEPTION 'SMOKE §11: DELETE de cliente NO bloqueado por RESTRICT';
  EXCEPTION WHEN foreign_key_violation THEN
    -- esperado
  END;
  -- DELETE de la cotización → bloqueado por RESTRICT.
  BEGIN
    DELETE FROM public.sales_documents WHERE id = v_doc;
    RAISE EXCEPTION 'SMOKE §11: DELETE de cotización aceptada NO bloqueado';
  EXCEPTION WHEN foreign_key_violation THEN
    -- esperado
  END;
  -- DELETE del token → permitido pero NO destruye el record (SET NULL;
  -- el snapshot + prefijo conservan la referencia).
  DELETE FROM public.sales_quotation_tokens WHERE id = v_tok;
  IF NOT EXISTS (SELECT 1 FROM public.sales_quotation_acceptances
                 WHERE sales_document_id = v_doc AND token_id IS NULL AND token_prefix IS NOT NULL) THEN
    RAISE EXCEPTION 'SMOKE §11: borrar el token destruyó la referencia del acceptance';
  END IF;
  -- DELETE del tenant → bloqueado por RESTRICT (0092).
  BEGIN
    DELETE FROM public.empresas WHERE id = v_empresa;
    RAISE EXCEPTION 'SMOKE §11: DELETE de tenant NO bloqueado por RESTRICT';
  EXCEPTION WHEN foreign_key_violation THEN
    -- esperado
  END;
  RAISE NOTICE 'SMOKE §11 OK: acceptance append-only, relacionadas no lo destruyen';

  -- --- 10. Limpieza (orden por FKs RESTRICT) ---
  DELETE FROM public.sales_quotation_events WHERE sales_document_id IN (v_doc, v_doc2);
  DELETE FROM public.sales_quotation_acceptances WHERE sales_document_id IN (v_doc, v_doc2);
  DELETE FROM public.work_order_items WHERE work_order_id IN (SELECT id FROM public.work_orders WHERE sales_document_id IN (v_doc, v_doc2));
  DELETE FROM public.work_orders WHERE sales_document_id IN (v_doc, v_doc2);
  DELETE FROM public.sales_quotation_tokens WHERE sales_document_id IN (v_doc, v_doc2);
  DELETE FROM public.sales_document_items WHERE sales_document_id IN (v_doc, v_doc2);
  DELETE FROM public.sales_documents WHERE id IN (v_doc, v_doc2);
  RAISE NOTICE 'SMOKE COMPLETO OK + limpieza realizada';
END $$;
