-- PROPOSED ONLY. Validate both parent and child company without backfill.
BEGIN;
CREATE FUNCTION private.guard_sales_item_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE parent_empresa uuid;
BEGIN
 SELECT d.empresa_id INTO parent_empresa FROM public.sales_documents d WHERE d.id=NEW.sales_document_id FOR KEY SHARE;
 IF NOT FOUND OR parent_empresa IS DISTINCT FROM NEW.empresa_id THEN
   RAISE EXCEPTION 'El ítem y el documento de venta deben pertenecer a la misma empresa';
 END IF;
 RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION private.guard_sales_item_tenant() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_sales_item_tenant BEFORE INSERT OR UPDATE ON public.sales_document_items
FOR EACH ROW EXECUTE FUNCTION private.guard_sales_item_tenant();
CREATE OR REPLACE FUNCTION "public"."recompute_sales_document"("p_doc" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_total numeric(14,2);
  v_neto numeric(14,2);
  v_vat numeric(14,2);
  v_cobrado numeric(14,2);
  v_status public.sales_doc_status;
BEGIN
  IF p_doc IS NULL THEN RETURN; END IF;
  PERFORM private.b11_require_financial_actor((SELECT empresa_id FROM public.sales_documents WHERE id=p_doc FOR UPDATE));

  SELECT
    coalesce(sum(i.line_total), 0),
    coalesce(sum(CASE WHEN i.vat_rate = 0 THEN i.line_total
      ELSE pg_catalog.round(i.line_total / (1 + i.vat_rate / 100.0), 2) END), 0),
    coalesce(sum(CASE WHEN i.vat_rate = 0 THEN 0
      ELSE i.line_total - pg_catalog.round(i.line_total / (1 + i.vat_rate / 100.0), 2) END), 0)
  INTO v_total, v_neto, v_vat
  FROM public.sales_document_items i
  WHERE i.sales_document_id = p_doc AND i.empresa_id=(SELECT empresa_id FROM public.sales_documents WHERE id=p_doc);

  SELECT coalesce(sum(r.amount), 0) INTO v_cobrado
  FROM public.sales_receipts r
  WHERE r.sales_document_id = p_doc AND r.reversed_at IS NULL AND r.empresa_id=(SELECT empresa_id FROM public.sales_documents WHERE id=p_doc);

  SELECT d.status INTO v_status FROM public.sales_documents d WHERE d.id = p_doc;

  UPDATE public.sales_documents d SET
    subtotal = v_neto,
    vat_amount = v_vat,
    total = v_total,
    cobrado_amount = v_cobrado,
    status = CASE
      WHEN v_status IN ('BORRADOR', 'ANULADA') THEN v_status
      WHEN v_cobrado <= 0 THEN 'EMITIDA'::public.sales_doc_status
      WHEN v_cobrado >= v_total THEN 'COBRADA'::public.sales_doc_status
      ELSE 'COBRADA_PARCIAL'::public.sales_doc_status
    END
  WHERE d.id = p_doc;
END;
$$;


COMMIT;
