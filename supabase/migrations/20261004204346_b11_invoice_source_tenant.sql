-- B11: enforce tenant identity of supplier invoice/payment sources for future writes.
-- NOT VALID preserves historical rows; no backfill, deletion or money mutation.
BEGIN;
ALTER TABLE public.providers ADD CONSTRAINT b11_providers_tenant_identity UNIQUE(empresa_id,id);
ALTER TABLE public.attachments ADD CONSTRAINT b11_attachments_tenant_identity UNIQUE(empresa_id,id);
ALTER TABLE public.invoices ADD CONSTRAINT b11_invoice_provider_tenant
 FOREIGN KEY(empresa_id,provider_id) REFERENCES public.providers(empresa_id,id) NOT VALID;
ALTER TABLE public.invoices ADD CONSTRAINT b11_invoice_attachment_tenant
 FOREIGN KEY(empresa_id,attachment_id) REFERENCES public.attachments(empresa_id,id) NOT VALID;
ALTER TABLE public.payment_orders ADD CONSTRAINT b11_op_provider_tenant
 FOREIGN KEY(empresa_id,provider_id) REFERENCES public.providers(empresa_id,id) NOT VALID;
-- Payment approval remains a prerequisite at the canonical RPC boundary.
CREATE OR REPLACE FUNCTION public.ejecutar_orden_pago_atomica(p_empresa_id uuid, p_op_id uuid, p_cuenta_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_op public.payment_orders;
  v_account_currency public.currency_code;
  v_invoice_currency public.currency_code;
  v_invoice_count integer;
  v_link_count integer;
  v_total numeric;
  v_locked_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para ejecutar orden de pago';
  END IF;

  SELECT * INTO v_op FROM public.payment_orders po
  WHERE po.id = p_op_id AND po.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden de pago no encontrada'; END IF;
  IF v_op.status <> 'EMITIDA' THEN
    RAISE EXCEPTION 'La orden de pago ya fue ejecutada o anulada';
  END IF;

  SELECT count(*) INTO v_link_count FROM public.payment_order_invoices poi
  WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id;
  IF v_link_count = 0 THEN RAISE EXCEPTION 'La orden de pago no tiene facturas vinculadas'; END IF;

  -- Stable lock ordering prevents invoice/payment races and deadlocks.
  FOR v_locked_id IN
    SELECT i.id
    FROM public.payment_order_invoices poi
    JOIN public.invoices i ON i.id = poi.invoice_id
    WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    NULL;
  END LOOP;

  SELECT count(*), coalesce(sum(i.total), 0)
    INTO v_invoice_count, v_total
  FROM public.payment_order_invoices poi
  JOIN public.invoices i ON i.id = poi.invoice_id
  WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
    AND i.empresa_id = p_empresa_id AND i.provider_id = v_op.provider_id
    AND i.status = 'APTO_PARA_PAGO';
  IF v_invoice_count <> v_link_count THEN
    RAISE EXCEPTION 'La OP contiene facturas ajenas, pagadas, anuladas o de otro proveedor';
  END IF;

  SELECT i.currency INTO v_invoice_currency
  FROM public.payment_order_invoices poi
  JOIN public.invoices i ON i.id = poi.invoice_id
  WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
  ORDER BY i.id LIMIT 1;
  IF EXISTS (
    SELECT 1 FROM public.payment_order_invoices poi
    JOIN public.invoices i ON i.id = poi.invoice_id
    WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
      AND i.currency IS DISTINCT FROM v_invoice_currency
  ) THEN
    RAISE EXCEPTION 'Una OP no puede agrupar facturas de monedas distintas';
  END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT c.moneda INTO v_account_currency
    FROM public.cuentas_financieras c
    WHERE c.id = p_cuenta_id AND c.empresa_id = p_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta financiera no encontrada para la empresa'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_order_invoices poi
      JOIN public.invoices i ON i.id = poi.invoice_id
      WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
        AND (i.empresa_id IS DISTINCT FROM p_empresa_id
          OR i.currency IS DISTINCT FROM v_account_currency)
    ) THEN
      RAISE EXCEPTION 'La moneda de la cuenta no coincide con todas las facturas de la OP';
    END IF;
  END IF;

  UPDATE public.payment_orders po
  SET status = 'EJECUTADA', executed_at = pg_catalog.now(), cuenta_id = p_cuenta_id
  WHERE po.id = p_op_id AND po.empresa_id = p_empresa_id AND po.status = 'EMITIDA';
  IF NOT FOUND THEN RAISE EXCEPTION 'La OP cambió de estado durante la ejecución'; END IF;

  UPDATE public.invoices i
  SET status = 'PAGADO', updated_at = pg_catalog.now()
  WHERE i.id IN (
    SELECT poi.invoice_id FROM public.payment_order_invoices poi
    WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
  ) AND i.empresa_id = p_empresa_id;

  IF p_cuenta_id IS NOT NULL AND v_total > 0 THEN
    PERFORM public.registrar_movimiento_tesoreria(
      p_empresa_id := p_empresa_id,
      p_cuenta_id := p_cuenta_id,
      p_monto := -v_total,
      p_tipo := 'PAGO',
      p_fecha := CURRENT_DATE,
      p_motivo := 'Pago OP ' || v_op.code,
      p_payment_order_id := p_op_id,
      p_created_by := p_created_by,
      p_permitir_negativo := true
    );
  END IF;
END;
$function$
;
-- Balance and account creation are authoritative RPC/ledger effects; metadata edits stay available.
REVOKE INSERT,UPDATE,DELETE ON public.cuentas_financieras FROM PUBLIC,anon,authenticated;
GRANT UPDATE(nombre,tipo,banco,numero_cuenta,activo,updated_at) ON public.cuentas_financieras TO authenticated;
COMMIT;
