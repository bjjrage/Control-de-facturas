-- B10: preserve factual provenance, without changing RLS or financial facts.
ALTER TABLE public.sales_documents
  DROP CONSTRAINT sales_documents_source_document_id_fkey,
  ADD CONSTRAINT sales_documents_source_document_id_fkey
    FOREIGN KEY (source_document_id) REFERENCES public.sales_documents(id) ON DELETE RESTRICT;

CREATE FUNCTION public.guard_sales_provenance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  child public.sales_documents%ROWTYPE;
  parent public.sales_documents%ROWTYPE;
  seen uuid[];
  valid_snapshot boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.source_document_id IS NOT NULL AND
       NEW.source_document_id IS DISTINCT FROM OLD.source_document_id THEN
      RAISE EXCEPTION 'El documento de origen es inmutable: no se puede cambiar ni borrar.';
    END IF;
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
      RAISE EXCEPTION 'La empresa del documento es inmutable.';
    END IF;
    IF NEW.status = 'ANULADA' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS (
      WITH RECURSIVE descendants AS (
        SELECT id, status FROM public.sales_documents WHERE source_document_id = OLD.id AND empresa_id = OLD.empresa_id
        UNION
        SELECT d.id, d.status FROM public.sales_documents d JOIN descendants p ON d.source_document_id = p.id
        WHERE d.empresa_id = OLD.empresa_id
      ) SELECT 1 FROM descendants WHERE status <> 'ANULADA'
    ) THEN
      RAISE EXCEPTION 'Anula primero los documentos derivados activos, desde el ultimo hacia el origen.';
    END IF;
    IF (NEW.client_id, NEW.currency, NEW.doc_type) IS DISTINCT FROM (OLD.client_id, OLD.currency, OLD.doc_type)
       AND EXISTS (SELECT 1 FROM public.sales_documents WHERE source_document_id = OLD.id AND empresa_id = OLD.empresa_id) THEN
      RAISE EXCEPTION 'No se puede cambiar tipo, cliente o moneda de un origen con documentos derivados.';
    END IF;
  END IF;

  child := NEW;
  seen := ARRAY[NEW.id];
  WHILE child.source_document_id IS NOT NULL LOOP
    IF child.source_document_id = ANY(seen) THEN RAISE EXCEPTION 'Cadena de origen circular.'; END IF;
    seen := array_append(seen, child.source_document_id);
    -- SHARE conflicts with parent UPDATE/DELETE; protects issuance/creation against invalidation races.
    SELECT * INTO parent FROM public.sales_documents
      WHERE id = child.source_document_id AND empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Falta el documento de origen de esta empresa.'; END IF;
    IF parent.client_id IS DISTINCT FROM child.client_id OR parent.currency IS DISTINCT FROM child.currency
      OR NOT ((child.doc_type = 'REMISION' AND parent.doc_type = 'PROFORMA')
        OR (child.doc_type = 'FACTURA' AND parent.doc_type IN ('PROFORMA', 'REMISION'))
        OR (child.doc_type = 'NOTA_CREDITO' AND parent.doc_type = 'FACTURA')) THEN
      RAISE EXCEPTION 'Tipo, cliente o moneda incompatibles con el origen.';
    END IF;
    -- Annulment remains possible for explicit human cleanup of invalid drafts.
    IF NEW.status <> 'ANULADA' AND parent.status = 'ANULADA' THEN
      RAISE EXCEPTION 'No se puede usar un origen anulado.';
    END IF;
    IF NEW.status = 'EMITIDA' AND child.doc_type = 'NOTA_CREDITO'
      AND parent.status NOT IN ('EMITIDA', 'COBRADA_PARCIAL', 'COBRADA') THEN
      RAISE EXCEPTION 'La nota de credito requiere una factura emitida.';
    END IF;
    IF parent.doc_type = 'PROFORMA' THEN
      IF NEW.status = 'EMITIDA' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.sales_quotation_acceptances a
          JOIN public.work_orders w ON w.id = a.work_order_id AND w.sales_document_id = parent.id
          WHERE a.sales_document_id = parent.id AND a.empresa_id = NEW.empresa_id AND w.empresa_id = NEW.empresa_id
            AND parent.acceptance_status = 'ACCEPTED' AND a.quotation_version = parent.quotation_version
            AND a.client_id = parent.client_id AND w.client_id = parent.client_id
            AND a.currency_snapshot = parent.currency AND w.currency = parent.currency
            AND (a.subtotal_snapshot, a.vat_snapshot, a.total_snapshot) = (parent.subtotal, parent.vat_amount, parent.total)
            AND (a.subtotal_snapshot, a.vat_snapshot, a.total_snapshot) = (w.subtotal, w.vat_amount, w.total)
            AND jsonb_array_length(a.items_snapshot) > 0
            AND (SELECT jsonb_agg(jsonb_build_array(x->>'description', (x->>'quantity')::numeric,
                 (x->>'unit_price')::numeric, (x->>'vat_rate')::numeric, (x->>'line_total')::numeric)
                 ORDER BY x->>'description', (x->>'quantity')::numeric, (x->>'unit_price')::numeric,
                   (x->>'vat_rate')::numeric, (x->>'line_total')::numeric) FROM jsonb_array_elements(a.items_snapshot) x)
              = (SELECT jsonb_agg(jsonb_build_array(i.description, i.quantity, i.unit_price, i.vat_rate, i.line_total)
                 ORDER BY i.description, i.quantity, i.unit_price, i.vat_rate, i.line_total)
                 FROM public.work_order_items i WHERE i.work_order_id = w.id AND i.empresa_id = NEW.empresa_id)
        ) INTO valid_snapshot;
        IF NOT valid_snapshot THEN RAISE EXCEPTION 'La version aceptada, OT o snapshot de la proforma no es valido.'; END IF;
      END IF;
      RETURN NEW;
    END IF;
    child := parent;
  END LOOP;
  IF NEW.source_document_id IS NOT NULL AND NEW.status = 'EMITIDA' AND child.doc_type = 'REMISION' THEN
    RAISE EXCEPTION 'La remision de origen no tiene proforma aceptada y OT.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_sales_provenance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_sales_provenance_guard
  BEFORE INSERT OR UPDATE ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_provenance();
