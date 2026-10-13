-- Approved on 2026-10-13 and verified only on isolated preview kyiihlkncatojvlasoag.
-- Allocate the OT code inside the existing validated-token transaction.
-- Preserve next_doc_code's authenticated-user guard and all current RPC grants.
DO $proposal$
DECLARE
  v_sql text;
  v_declaration text := '  v_name text;';
  v_insert text := E'  INSERT INTO public.work_orders\n    (empresa_id, sales_document_id, client_id, currency, subtotal, vat_amount, total, status, notes)';
  v_values text := E'  VALUES (\n    v_doc.empresa_id, v_doc.id, v_doc.client_id, v_doc.currency,';
BEGIN
  v_sql := pg_get_functiondef('public.accept_quotation(text,text,text,text,text,text)'::regprocedure);
  IF position('-- validated-token OT code allocation' IN v_sql) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_sql) - length(replace(v_sql, v_declaration, ''))) <> length(v_declaration)
     OR (length(v_sql) - length(replace(v_sql, v_insert, ''))) <> length(v_insert)
     OR (length(v_sql) - length(replace(v_sql, v_values, ''))) <> length(v_values) THEN
    RAISE EXCEPTION 'Unexpected accept_quotation definition; no change applied';
  END IF;
  v_sql := replace(v_sql, v_declaration, v_declaration || E'\n  v_ot_code text;\n  v_ot_number integer;');
  v_sql := replace(v_sql, v_insert, $code$
  -- validated-token OT code allocation
  -- v_doc belongs to the locked, current, non-revoked token validated above.
  INSERT INTO public.doc_code_counters AS counter (empresa_id, doc_type, last_number)
  VALUES (v_doc.empresa_id, 'OT', 1)
  ON CONFLICT (empresa_id, doc_type)
  DO UPDATE SET last_number = counter.last_number + 1
  RETURNING last_number INTO v_ot_number;
  v_ot_code := 'OT-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-'
    || pg_catalog.lpad(v_ot_number::text, 4, '0');

  INSERT INTO public.work_orders
    (code, empresa_id, sales_document_id, client_id, currency, subtotal, vat_amount, total, status, notes)$code$);
  v_sql := replace(v_sql, v_values, E'  VALUES (\n    v_ot_code, v_doc.empresa_id, v_doc.id, v_doc.client_id, v_doc.currency,');
  EXECUTE v_sql;
END;
$proposal$;
