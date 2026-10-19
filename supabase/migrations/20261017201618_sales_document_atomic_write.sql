-- Persist the sales header and its complete item set in one database transaction.
-- SECURITY INVOKER keeps the existing table RLS policies in force.
CREATE FUNCTION public.save_sales_document_atomico(
  p_empresa_id uuid,
  p_document_id uuid,
  p_client_id uuid,
  p_doc_type text,
  p_issue_date date,
  p_due_date date,
  p_currency text,
  p_notes text,
  p_source_document_id uuid,
  p_created_by uuid,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_doc public.sales_documents;
  v_document_id uuid;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_vat_rate integer;
BEGIN
  IF auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para guardar venta';
  END IF;
  IF p_doc_type NOT IN ('PROFORMA','REMISION','FACTURA','NOTA_CREDITO') THEN
    RAISE EXCEPTION 'Tipo de venta no permitido';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) = 0
     OR pg_catalog.jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'La venta necesita al menos un ítem';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients
                 WHERE id = p_client_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'Cliente no disponible para esta empresa';
  END IF;

  IF p_document_id IS NULL THEN
    INSERT INTO public.sales_documents (
      empresa_id, client_id, doc_type, issue_date, due_date, currency,
      notes, source_document_id, created_by
    ) VALUES (
      p_empresa_id, p_client_id, p_doc_type::public.sales_doc_type,
      COALESCE(p_issue_date, CURRENT_DATE), p_due_date,
      p_currency::public.currency_code, p_notes, p_source_document_id, p_created_by
    ) RETURNING id INTO v_document_id;
  ELSE
    SELECT * INTO v_doc FROM public.sales_documents
    WHERE id = p_document_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Documento de venta no encontrado'; END IF;
    IF v_doc.status <> 'BORRADOR' THEN
      RAISE EXCEPTION 'Solo se puede editar un borrador';
    END IF;
    IF p_source_document_id IS DISTINCT FROM v_doc.source_document_id THEN
      RAISE EXCEPTION 'El documento de origen es inmutable';
    END IF;
    IF v_doc.doc_type = 'PROFORMA' AND v_doc.acceptance_status IN ('ACCEPTED','REJECTED','EXPIRED') THEN
      RAISE EXCEPTION 'La cotización no está disponible para edición';
    END IF;
    UPDATE public.sales_documents SET
      client_id = p_client_id,
      doc_type = p_doc_type::public.sales_doc_type,
      issue_date = COALESCE(p_issue_date, v_doc.issue_date),
      due_date = p_due_date,
      currency = p_currency::public.currency_code,
      notes = p_notes
    WHERE id = p_document_id AND empresa_id = p_empresa_id;
    DELETE FROM public.sales_document_items
    WHERE sales_document_id = p_document_id AND empresa_id = p_empresa_id;
    v_document_id := p_document_id;
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Ítem de venta inválido';
    END IF;
    v_description := pg_catalog.btrim(v_item->>'description');
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_vat_rate := (v_item->>'vat_rate')::integer;
    IF v_description IS NULL OR v_description = ''
       OR v_quantity IS NULL OR v_quantity::text IN ('NaN','Infinity','-Infinity')
       OR v_quantity <= 0 OR v_quantity <> pg_catalog.round(v_quantity, 4)
       OR v_unit_price IS NULL
       OR v_unit_price::text IN ('NaN','Infinity','-Infinity')
       OR v_unit_price < 0 OR v_unit_price <> pg_catalog.round(v_unit_price, 4)
       OR v_vat_rate IS NULL OR v_vat_rate NOT IN (0,5,10) THEN
      RAISE EXCEPTION 'Línea de venta inválida';
    END IF;
    INSERT INTO public.sales_document_items (
      empresa_id, sales_document_id, description, quantity,
      unit_price, vat_rate, line_total
    ) VALUES (
      p_empresa_id, v_document_id, v_description, v_quantity,
      v_unit_price, v_vat_rate,
      pg_catalog.round(v_quantity * v_unit_price, 2)
    );
  END LOOP;
  RETURN v_document_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_sales_document_atomico(uuid,uuid,uuid,text,date,date,text,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_sales_document_atomico(uuid,uuid,uuid,text,date,date,text,text,uuid,uuid,jsonb)
  TO authenticated;
