-- #19: serialize emissions sharing one accepted proforma before checking its cap.
CREATE FUNCTION private.guard_sales_emission_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_parent public.sales_documents%ROWTYPE;
  v_quote public.sales_documents%ROWTYPE;
  v_acceptance public.sales_quotation_acceptances%ROWTYPE;
  v_source uuid := NEW.source_document_id;
  v_seen uuid[] := ARRAY[NEW.id];
  v_total numeric;
  v_invalid_lines boolean;
BEGIN
  IF NEW.status <> 'EMITIDA' OR OLD.status = 'EMITIDA'
     OR NEW.doc_type NOT IN ('REMISION', 'FACTURA') OR v_source IS NULL THEN
    RETURN NEW;
  END IF;

  WHILE v_source IS NOT NULL LOOP
    IF v_source = ANY(v_seen) THEN RAISE EXCEPTION 'Cadena de origen circular'; END IF;
    v_seen := array_append(v_seen, v_source);
    SELECT * INTO v_parent FROM public.sales_documents
      WHERE id = v_source AND empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Falta el documento de origen de esta empresa'; END IF;
    IF v_parent.doc_type = 'PROFORMA' THEN
      -- All competing emissions take this same lock. Read the peers only after it is held.
      SELECT * INTO v_quote FROM public.sales_documents
        WHERE id = v_parent.id AND empresa_id = NEW.empresa_id FOR UPDATE;
      EXIT;
    END IF;
    v_source := v_parent.source_document_id;
  END LOOP;
  IF v_quote.id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_acceptance FROM public.sales_quotation_acceptances a
    WHERE a.sales_document_id = v_quote.id AND a.empresa_id = NEW.empresa_id
      AND a.quotation_version = v_quote.quotation_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Falta la aceptación vigente de la proforma'; END IF;

  WITH RECURSIVE descendants AS (
    SELECT d.id, d.doc_type, d.status, d.total FROM public.sales_documents d
      WHERE d.source_document_id = v_quote.id AND d.empresa_id = NEW.empresa_id
    UNION
    SELECT d.id, d.doc_type, d.status, d.total FROM public.sales_documents d
      JOIN descendants p ON d.source_document_id = p.id
      WHERE d.empresa_id = NEW.empresa_id
  ), issued AS (
    SELECT id, total FROM descendants
      WHERE id <> NEW.id AND doc_type = NEW.doc_type
        AND status IN ('EMITIDA', 'COBRADA_PARCIAL', 'COBRADA')
    UNION ALL SELECT NEW.id, NEW.total
  ), accepted_lines AS (
    SELECT lower(regexp_replace(btrim(x->>'description'), '\s+', ' ', 'g')) AS description,
      (x->>'vat_rate')::int AS vat_rate,
      sum((x->>'quantity')::numeric) AS quantity,
      max((x->>'unit_price')::numeric) AS max_price
    FROM jsonb_array_elements(v_acceptance.items_snapshot) x
    GROUP BY 1, 2
  ), used_lines AS (
    SELECT lower(regexp_replace(btrim(i.description), '\s+', ' ', 'g')) AS description,
      i.vat_rate, sum(i.quantity) AS quantity, max(i.unit_price) AS max_price
    FROM public.sales_document_items i JOIN issued d ON d.id = i.sales_document_id
    WHERE i.empresa_id = NEW.empresa_id GROUP BY 1, 2
  )
  SELECT (SELECT sum(total) FROM issued),
    NOT EXISTS (SELECT 1 FROM used_lines) OR EXISTS (
      SELECT 1 FROM used_lines u LEFT JOIN accepted_lines a
        ON a.description = u.description AND a.vat_rate = u.vat_rate
      WHERE a.description IS NULL OR u.quantity > a.quantity + 0.0001
         OR u.max_price > a.max_price + 0.01
    ) INTO v_total, v_invalid_lines;

  IF v_total > v_acceptance.total_snapshot + 0.01 OR v_invalid_lines THEN
    RAISE EXCEPTION 'La remisión o factura supera o altera los ítems de la proforma aceptada y su OT';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_sales_emission_cap
  BEFORE UPDATE OF status ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION private.guard_sales_emission_cap();
REVOKE ALL ON FUNCTION private.guard_sales_emission_cap() FROM PUBLIC, anon, authenticated;
