-- B11 external audit: financial provenance freezes with approval/settlement.
-- Invoker triggers preserve RLS; no role/service exception can rewrite settled links.
BEGIN;

CREATE FUNCTION private.b11_guard_invoice_order_relationship() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_old_invoice uuid; v_new_invoice uuid;
  v_old_order uuid; v_new_order uuid;
  v_row record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_invoice := OLD.invoice_id; v_old_order := OLD.authorized_order_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_invoice := NEW.invoice_id; v_new_order := NEW.authorized_order_id;
  END IF;
  -- Approval locks the invoice first, then its order. Inspect OLD and NEW on repoint.
  FOR v_row IN SELECT i.id,i.status FROM public.invoices i
    WHERE i.id=ANY(ARRAY[v_old_invoice,v_new_invoice]) ORDER BY i.id FOR UPDATE
  LOOP
    IF v_row.status::text IN ('APTO_PARA_PAGO','PAGADO') THEN
      RAISE EXCEPTION 'No se puede modificar el vínculo OC de una factura apta para pago o pagada.' USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOR v_row IN SELECT o.id,o.status FROM public.authorized_orders o
    WHERE o.id=ANY(ARRAY[v_old_order,v_new_order]) ORDER BY o.id FOR UPDATE
  LOOP
    IF v_row.status::text IN ('APTO_PARA_PAGO','PAGADO') THEN
      RAISE EXCEPTION 'No se pueden modificar los vínculos de una OC apta para pago o pagada.' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.b11_guard_invoice_order_relationship() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER b11_invoice_order_relationship BEFORE INSERT OR UPDATE OR DELETE
ON public.invoice_order_matches FOR EACH ROW EXECUTE FUNCTION private.b11_guard_invoice_order_relationship();

CREATE FUNCTION private.b11_guard_op_invoice_relationship() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_old_op uuid; v_new_op uuid;
  v_old_invoice uuid; v_new_invoice uuid;
  v_row record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_op := OLD.payment_order_id; v_old_invoice := OLD.invoice_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_op := NEW.payment_order_id; v_new_invoice := NEW.invoice_id;
  END IF;
  -- Same hierarchy as ejecutar_orden_pago_atomica: OP, then invoices by ID.
  -- Even an empty OP is locked, so a concurrent INSERT cannot escape execution.
  FOR v_row IN SELECT p.id,p.status FROM public.payment_orders p
    WHERE p.id=ANY(ARRAY[v_old_op,v_new_op]) ORDER BY p.id FOR UPDATE
  LOOP
    IF v_row.status::text='EJECUTADA' THEN
      RAISE EXCEPTION 'No se pueden modificar las facturas de una OP ejecutada.' USING ERRCODE='55000';
    END IF;
  END LOOP;
  FOR v_row IN SELECT i.id,i.status FROM public.invoices i
    WHERE i.id=ANY(ARRAY[v_old_invoice,v_new_invoice]) ORDER BY i.id FOR UPDATE
  LOOP
    IF v_row.status::text='PAGADO' THEN
      RAISE EXCEPTION 'No se puede modificar el vínculo OP de una factura pagada.' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.b11_guard_op_invoice_relationship() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER b11_op_invoice_relationship BEFORE INSERT OR UPDATE OR DELETE
ON public.payment_order_invoices FOR EACH ROW EXECUTE FUNCTION private.b11_guard_op_invoice_relationship();

-- An invoice FK cascades on DELETE; guard the parent before it becomes invisible
-- to the child trigger. Normal unpaid parent deletion/cascades remain possible.
CREATE FUNCTION private.b11_guard_settled_invoice_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.status::text IN ('APTO_PARA_PAGO','PAGADO') THEN
    RAISE EXCEPTION 'No se puede eliminar una factura apta para pago o pagada.' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.b11_guard_settled_invoice_delete() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER b11_settled_invoice_delete BEFORE DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION private.b11_guard_settled_invoice_delete();
COMMIT;
