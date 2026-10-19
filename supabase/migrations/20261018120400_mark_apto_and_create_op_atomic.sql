-- #2: the payable transition and payment order must commit or roll back together.
CREATE FUNCTION public.mark_apto_y_crear_op_atomica(
  p_empresa_id uuid, p_invoice_id uuid, p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_provider_id uuid;
  v_op_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para crear la orden de pago';
  END IF;
  SELECT i.provider_id INTO v_provider_id
  FROM public.invoices i
  WHERE i.id = p_invoice_id AND i.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND OR v_provider_id IS NULL THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;

  PERFORM public.mark_invoice_apto_para_pago(p_invoice_id);

  INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
  VALUES (p_empresa_id, public.next_op_code(), v_provider_id, 'EMITIDA', p_created_by)
  RETURNING id INTO v_op_id;
  INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
  VALUES (p_empresa_id, v_op_id, p_invoice_id);
  RETURN v_op_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_apto_y_crear_op_atomica(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_apto_y_crear_op_atomica(uuid,uuid,uuid) TO authenticated;
