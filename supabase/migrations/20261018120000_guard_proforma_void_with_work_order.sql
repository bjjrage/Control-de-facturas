-- #18: keep a proforma and its work order lifecycle consistent.
-- A row lock makes a concurrent OT cancellation or update serialize with the void.
CREATE FUNCTION private.guard_proforma_void_with_work_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_order_status text;
BEGIN
  IF NEW.status = 'ANULADA'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.doc_type = 'PROFORMA' THEN
    SELECT wo.status INTO v_order_status
    FROM public.work_orders wo
    WHERE wo.sales_document_id = OLD.id AND wo.empresa_id = OLD.empresa_id
    FOR UPDATE;
    IF FOUND AND v_order_status <> 'CANCELADA' THEN
      RAISE EXCEPTION 'No se puede anular la proforma con una OT activa';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_proforma_void_with_work_order
  BEFORE UPDATE OF status ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION private.guard_proforma_void_with_work_order();

REVOKE ALL ON FUNCTION private.guard_proforma_void_with_work_order() FROM PUBLIC;
