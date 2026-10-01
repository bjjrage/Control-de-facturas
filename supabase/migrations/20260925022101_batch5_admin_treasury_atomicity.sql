-- Batch 5: close administrative cashflow gaps and make treasury writes atomic.
-- No remote database is modified by this migration; it is a forward-only contract.

-- A receipt is never physically deleted after posting. Reversal is represented
-- by a treasury contra-entry and a marker on the original receipt.
ALTER TABLE public.sales_receipts
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_movement_id uuid REFERENCES public.movimientos_tesoreria(id) ON DELETE RESTRICT;

ALTER TABLE public.movimientos_tesoreria
  ADD COLUMN IF NOT EXISTS reversal_of_movement_id uuid REFERENCES public.movimientos_tesoreria(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_tesoreria_reversal_of
  ON public.movimientos_tesoreria(reversal_of_movement_id)
  WHERE reversal_of_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_receipts_active_doc
  ON public.sales_receipts(empresa_id, sales_document_id, receipt_date)
  WHERE reversed_at IS NULL;

-- The database, not a convention in the UI, enforces append-only ledger rows.
CREATE OR REPLACE FUNCTION public.prevent_treasury_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de tesorería son append-only; registre un contra-movimiento'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_treasury_ledger_append_only ON public.movimientos_tesoreria;
CREATE TRIGGER trg_treasury_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.movimientos_tesoreria
  FOR EACH ROW EXECUTE FUNCTION public.prevent_treasury_ledger_mutation();

DROP POLICY IF EXISTS "update mov_tesoreria" ON public.movimientos_tesoreria;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.movimientos_tesoreria FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.movimientos_tesoreria TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.transferencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transferencias TO authenticated;
REVOKE ALL ON FUNCTION public.prevent_treasury_ledger_mutation() FROM PUBLIC, anon, authenticated;

-- The materialized account balance is changed only by a ledger INSERT trigger.
CREATE OR REPLACE FUNCTION public.fn_mov_tesoreria_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.cuentas_financieras
  SET saldo = saldo + NEW.monto,
      updated_at = pg_catalog.now()
  WHERE id = NEW.cuenta_id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta financiera no encontrada para el tenant del movimiento';
  END IF;
  RETURN NEW;
END;
$$;

-- Receipts and movements are only mutated together through their atomic RPCs.
DROP POLICY IF EXISTS sales_receipts_rw ON public.sales_receipts;
CREATE POLICY sales_receipts_select ON public.sales_receipts FOR SELECT
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.sales_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sales_receipts TO authenticated;

-- Internal helper called by the receipt trigger only; reversed receipts no
-- longer contribute to collected amount or document state.
CREATE OR REPLACE FUNCTION public.recompute_sales_document(p_doc uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total numeric(14,2);
  v_neto numeric(14,2);
  v_vat numeric(14,2);
  v_cobrado numeric(14,2);
  v_status public.sales_doc_status;
BEGIN
  IF p_doc IS NULL THEN RETURN; END IF;

  SELECT
    coalesce(sum(i.line_total), 0),
    coalesce(sum(CASE WHEN i.vat_rate = 0 THEN i.line_total
      ELSE pg_catalog.round(i.line_total / (1 + i.vat_rate / 100.0), 2) END), 0),
    coalesce(sum(CASE WHEN i.vat_rate = 0 THEN 0
      ELSE i.line_total - pg_catalog.round(i.line_total / (1 + i.vat_rate / 100.0), 2) END), 0)
  INTO v_total, v_neto, v_vat
  FROM public.sales_document_items i
  WHERE i.sales_document_id = p_doc;

  SELECT coalesce(sum(r.amount), 0) INTO v_cobrado
  FROM public.sales_receipts r
  WHERE r.sales_document_id = p_doc AND r.reversed_at IS NULL;

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

CREATE OR REPLACE FUNCTION public.trg_recompute_sales_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.recompute_sales_document(
    coalesce(NEW.sales_document_id, OLD.sales_document_id));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_sales_document(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_recompute_sales_doc() FROM PUBLIC, anon, authenticated;

-- Preserve per-company counters while closing the old SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION public.next_doc_code(p_empresa_id uuid, p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL
     OR p_empresa_id IS DISTINCT FROM public.current_empresa_id() THEN
    RAISE EXCEPTION 'Access denied for document code generation';
  END IF;
  IF p_doc_type IS NULL OR p_doc_type NOT IN ('RFQ','OC','OP','OT') THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  INSERT INTO public.doc_code_counters AS counter (empresa_id, doc_type, last_number)
  VALUES (p_empresa_id, p_doc_type, 1)
  ON CONFLICT (empresa_id, doc_type)
  DO UPDATE SET last_number = counter.last_number + 1
  RETURNING last_number INTO v_n;

  RETURN p_doc_type || '-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-'
    || pg_catalog.lpad(v_n::text, 4, '0');
END;
$$;

-- A single movement writer validates tenant, actor, reference ownership and
-- document/account currency before inserting the immutable ledger entry.
CREATE OR REPLACE FUNCTION public.registrar_movimiento_tesoreria(
  p_empresa_id uuid,
  p_cuenta_id uuid,
  p_monto numeric,
  p_tipo text,
  p_fecha date DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_payment_order_id uuid DEFAULT NULL,
  p_sales_receipt_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_permitir_negativo boolean DEFAULT false
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_saldo numeric;
  v_moneda public.currency_code;
  v_ref_moneda public.currency_code;
  v_ref_cuenta uuid;
  v_ref_monto numeric;
  v_op_status text;
  v_op_cuenta uuid;
  v_link_count integer;
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar movimiento de tesorería';
  END IF;
  IF p_monto IS NULL OR p_monto = 0 THEN
    RAISE EXCEPTION 'El monto no puede ser cero';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('INGRESO','EGRESO','AJUSTE','PAGO','COBRO') THEN
    RAISE EXCEPTION 'Tipo de movimiento no permitido';
  END IF;
  IF p_tipo IN ('INGRESO','EGRESO','AJUSTE')
     AND pg_catalog.btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'El movimiento requiere tipo y motivo';
  END IF;
  IF (p_tipo = 'INGRESO' AND p_monto <= 0)
     OR (p_tipo IN ('EGRESO','PAGO') AND p_monto >= 0)
     OR (p_tipo = 'COBRO' AND p_monto <= 0) THEN
    RAISE EXCEPTION 'El signo del monto no coincide con el tipo de movimiento';
  END IF;

  SELECT c.saldo, c.moneda INTO v_saldo, v_moneda
  FROM public.cuentas_financieras c
  WHERE c.id = p_cuenta_id AND c.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta financiera no encontrada'; END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La obra no pertenece a la empresa';
  END IF;

  IF p_payment_order_id IS NOT NULL THEN
    IF p_tipo <> 'PAGO' THEN
      RAISE EXCEPTION 'Orden de pago inválida para este movimiento';
    END IF;
    SELECT po.status, po.cuenta_id INTO v_op_status, v_op_cuenta
    FROM public.payment_orders po
    WHERE po.id = p_payment_order_id AND po.empresa_id = p_empresa_id
    FOR UPDATE;
    IF NOT FOUND OR v_op_status <> 'EJECUTADA' OR v_op_cuenta IS DISTINCT FROM p_cuenta_id THEN
      RAISE EXCEPTION 'La OP no está ejecutada con esta cuenta de tesorería';
    END IF;
    SELECT count(*) INTO v_link_count FROM public.payment_order_invoices poi
    WHERE poi.payment_order_id = p_payment_order_id AND poi.empresa_id = p_empresa_id;
    IF v_link_count = 0 OR EXISTS (
      SELECT 1
      FROM public.payment_order_invoices poi
      LEFT JOIN public.invoices i ON i.id = poi.invoice_id
      WHERE poi.payment_order_id = p_payment_order_id
        AND (poi.empresa_id IS DISTINCT FROM p_empresa_id
          OR i.id IS NULL OR i.empresa_id IS DISTINCT FROM p_empresa_id
          OR i.currency IS DISTINCT FROM v_moneda)
    ) THEN
      RAISE EXCEPTION 'La cuenta debe coincidir con la moneda de todas las facturas de la OP';
    END IF;
    SELECT coalesce(sum(i.total), 0) INTO v_ref_monto
    FROM public.payment_order_invoices poi
    JOIN public.invoices i ON i.id = poi.invoice_id
    WHERE poi.payment_order_id = p_payment_order_id AND poi.empresa_id = p_empresa_id
      AND i.empresa_id = p_empresa_id;
    IF p_monto <> -v_ref_monto THEN
      RAISE EXCEPTION 'El movimiento no coincide con el total de la OP';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.movimientos_tesoreria m
      WHERE m.payment_order_id = p_payment_order_id AND m.tipo = 'PAGO'
    ) THEN
      RAISE EXCEPTION 'La OP ya tiene un movimiento de pago en tesorería';
    END IF;
  ELSIF p_tipo = 'PAGO' THEN
    RAISE EXCEPTION 'Un movimiento PAGO requiere una OP de origen';
  END IF;

  IF p_sales_receipt_id IS NOT NULL THEN
    IF p_tipo <> 'COBRO' THEN RAISE EXCEPTION 'Referencia de cobro inválida'; END IF;
    SELECT d.currency, r.cuenta_id, r.amount
      INTO v_ref_moneda, v_ref_cuenta, v_ref_monto
    FROM public.sales_receipts r
    JOIN public.sales_documents d ON d.id = r.sales_document_id
    WHERE r.id = p_sales_receipt_id AND r.empresa_id = p_empresa_id
      AND d.empresa_id = p_empresa_id AND r.reversed_at IS NULL
    FOR UPDATE OF r;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cobro no encontrado para la empresa'; END IF;
    IF v_ref_moneda IS DISTINCT FROM v_moneda
       OR v_ref_cuenta IS DISTINCT FROM p_cuenta_id
       OR v_ref_monto IS DISTINCT FROM p_monto THEN
      RAISE EXCEPTION 'La cuenta, moneda o monto no coincide con el cobro';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.movimientos_tesoreria m
      WHERE m.sales_receipt_id = p_sales_receipt_id AND m.tipo = 'COBRO'
    ) THEN
      RAISE EXCEPTION 'El cobro ya tiene un movimiento en tesorería';
    END IF;
  ELSIF p_tipo = 'COBRO' THEN
    RAISE EXCEPTION 'Un movimiento COBRO requiere su recibo de origen';
  END IF;

  IF p_monto < 0 AND NOT coalesce(p_permitir_negativo, false)
     AND v_saldo + p_monto < 0 THEN
    RAISE EXCEPTION 'Saldo insuficiente: disponible %, requerido %', v_saldo, pg_catalog.abs(p_monto);
  END IF;

  INSERT INTO public.movimientos_tesoreria (
    empresa_id, cuenta_id, fecha, monto, tipo, motivo,
    payment_order_id, sales_receipt_id, project_id, created_by
  ) VALUES (
    p_empresa_id, p_cuenta_id, coalesce(p_fecha, CURRENT_DATE), p_monto, p_tipo,
    nullif(pg_catalog.btrim(p_motivo), ''), p_payment_order_id, p_sales_receipt_id,
    p_project_id, p_created_by
  );
  RETURN v_saldo + p_monto;
END;
$$;

-- Transfer both legs under deterministic locks and explicit currency semantics.
CREATE OR REPLACE FUNCTION public.registrar_transferencia(
  p_empresa_id uuid,
  p_cuenta_origen_id uuid,
  p_cuenta_destino_id uuid,
  p_monto_origen numeric,
  p_monto_destino numeric DEFAULT NULL,
  p_fecha date DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transfer_id uuid;
  v_saldo_origen numeric;
  v_moneda_origen public.currency_code;
  v_moneda_destino public.currency_code;
  v_monto_destino numeric := coalesce(p_monto_destino, p_monto_origen);
  v_lock_row record;
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar transferencia';
  END IF;
  IF p_cuenta_origen_id IS NULL OR p_cuenta_destino_id IS NULL
     OR p_cuenta_origen_id = p_cuenta_destino_id
     OR p_monto_origen IS NULL OR p_monto_origen <= 0
     OR v_monto_destino IS NULL OR v_monto_destino <= 0 THEN
    RAISE EXCEPTION 'Cuentas y montos de transferencia inválidos';
  END IF;

  FOR v_lock_row IN
    SELECT c.id FROM public.cuentas_financieras c
    WHERE c.empresa_id = p_empresa_id
      AND c.id IN (p_cuenta_origen_id, p_cuenta_destino_id)
    ORDER BY c.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT saldo, moneda INTO v_saldo_origen, v_moneda_origen
  FROM public.cuentas_financieras
  WHERE id = p_cuenta_origen_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta origen no encontrada'; END IF;

  SELECT moneda INTO v_moneda_destino
  FROM public.cuentas_financieras
  WHERE id = p_cuenta_destino_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta destino no encontrada'; END IF;

  IF v_moneda_origen = v_moneda_destino AND v_monto_destino <> p_monto_origen THEN
    RAISE EXCEPTION 'Entre cuentas de la misma moneda, los montos deben coincidir';
  END IF;
  IF v_moneda_origen <> v_moneda_destino AND p_monto_destino IS NULL THEN
    RAISE EXCEPTION 'La transferencia entre monedas requiere monto de destino explícito';
  END IF;
  IF v_saldo_origen < p_monto_origen THEN
    RAISE EXCEPTION 'Saldo insuficiente en la cuenta origen: disponible %, requerido %',
      v_saldo_origen, p_monto_origen;
  END IF;

  INSERT INTO public.transferencias (
    empresa_id, cuenta_origen_id, cuenta_destino_id, monto_origen, monto_destino,
    tipo_cambio, fecha, motivo, created_by
  ) VALUES (
    p_empresa_id, p_cuenta_origen_id, p_cuenta_destino_id, p_monto_origen, v_monto_destino,
    CASE WHEN v_moneda_origen = v_moneda_destino THEN 1
      ELSE pg_catalog.round(v_monto_destino / p_monto_origen, 6) END,
    coalesce(p_fecha, CURRENT_DATE), nullif(pg_catalog.btrim(p_motivo), ''), p_created_by
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.movimientos_tesoreria (
    empresa_id, cuenta_id, fecha, monto, tipo, motivo, transferencia_id, created_by
  ) VALUES
    (p_empresa_id, p_cuenta_origen_id, coalesce(p_fecha, CURRENT_DATE), -p_monto_origen,
      'TRANSFERENCIA_OUT', nullif(pg_catalog.btrim(p_motivo), ''), v_transfer_id, p_created_by),
    (p_empresa_id, p_cuenta_destino_id, coalesce(p_fecha, CURRENT_DATE), v_monto_destino,
      'TRANSFERENCIA_IN', nullif(pg_catalog.btrim(p_motivo), ''), v_transfer_id, p_created_by);

  RETURN v_transfer_id;
END;
$$;

-- Account creation and opening balance share one database transaction.
CREATE OR REPLACE FUNCTION public.crear_cuenta_financiera_atomica(
  p_empresa_id uuid,
  p_nombre text,
  p_tipo text,
  p_banco text,
  p_numero_cuenta text,
  p_moneda public.currency_code,
  p_saldo_inicial numeric,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cuenta_id uuid;
  v_opening numeric := coalesce(p_saldo_inicial, 0);
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para crear cuenta financiera';
  END IF;
  IF pg_catalog.btrim(coalesce(p_nombre, '')) = '' OR p_tipo NOT IN ('BANCO','CAJA','TARJETA','OTRO')
     OR p_moneda IS NULL THEN
    RAISE EXCEPTION 'Datos de cuenta financiera inválidos';
  END IF;

  INSERT INTO public.cuentas_financieras (
    empresa_id, nombre, tipo, banco, numero_cuenta, moneda, created_by
  ) VALUES (
    p_empresa_id, pg_catalog.btrim(p_nombre), p_tipo,
    nullif(pg_catalog.btrim(p_banco), ''), nullif(pg_catalog.btrim(p_numero_cuenta), ''),
    p_moneda, p_created_by
  ) RETURNING id INTO v_cuenta_id;

  IF v_opening <> 0 THEN
    INSERT INTO public.movimientos_tesoreria (
      empresa_id, cuenta_id, fecha, monto, tipo, motivo, created_by
    ) VALUES (
      p_empresa_id, v_cuenta_id, CURRENT_DATE, v_opening,
      'SALDO_INICIAL', 'Saldo inicial de la cuenta', p_created_by
    );
  END IF;
  RETURN v_cuenta_id;
END;
$$;

-- Read-only reconciliation RPC is tenant-scoped and unavailable to anon/PUBLIC.
CREATE OR REPLACE FUNCTION public.verificar_saldos_tesoreria(p_empresa_id uuid)
RETURNS TABLE (
  cuenta_id uuid, nombre text, saldo_materializado numeric, saldo_libro numeric, diferencia numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.id, c.nombre, c.saldo,
    coalesce(sum(m.monto), 0) AS saldo_libro,
    c.saldo - coalesce(sum(m.monto), 0) AS diferencia
  FROM public.cuentas_financieras c
  LEFT JOIN public.movimientos_tesoreria m ON m.cuenta_id = c.id AND m.empresa_id = c.empresa_id
  WHERE c.empresa_id = p_empresa_id
    AND p_empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  GROUP BY c.id, c.nombre, c.saldo
  HAVING c.saldo - coalesce(sum(m.monto), 0) <> 0;
$$;

CREATE OR REPLACE FUNCTION public.next_op_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.current_empresa_id() IS NULL
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para generar código de OP';
  END IF;
  RETURN public.next_doc_code(public.current_empresa_id(), 'OP');
END;
$$;

-- Payment execution validates every linked invoice and the selected account
-- currency before any status or ledger write. The whole call is one transaction.
CREATE OR REPLACE FUNCTION public.ejecutar_orden_pago_atomica(
  p_empresa_id uuid,
  p_op_id uuid,
  p_cuenta_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    AND i.status <> 'PAGADO';
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
$$;

-- Cobro insert + optional treasury ledger movement are one atomic operation.
CREATE OR REPLACE FUNCTION public.registrar_cobro_atomico(
  p_empresa_id uuid,
  p_sales_document_id uuid,
  p_amount numeric,
  p_method text,
  p_receipt_date date DEFAULT CURRENT_DATE,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_cuenta_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc public.sales_documents;
  v_account_currency public.currency_code;
  v_receipt_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar cobro';
  END IF;
  SELECT * INTO v_doc FROM public.sales_documents d
  WHERE d.id = p_sales_document_id AND d.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento de venta no encontrado'; END IF;
  IF v_doc.status NOT IN ('EMITIDA','COBRADA_PARCIAL') THEN
    RAISE EXCEPTION 'Solo se registran cobros en documentos emitidos';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount - (v_doc.total - v_doc.cobrado_amount) > 0.01 THEN
    RAISE EXCEPTION 'El monto de cobro es inválido o supera el saldo del documento';
  END IF;
  IF p_created_by IS NULL THEN RAISE EXCEPTION 'El actor del cobro es obligatorio'; END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT c.moneda INTO v_account_currency FROM public.cuentas_financieras c
    WHERE c.id = p_cuenta_id AND c.empresa_id = p_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta financiera no encontrada para la empresa'; END IF;
    IF v_account_currency IS DISTINCT FROM v_doc.currency THEN
      RAISE EXCEPTION 'La moneda de la cuenta no coincide con la del documento';
    END IF;
  END IF;

  INSERT INTO public.sales_receipts (
    empresa_id, sales_document_id, amount, receipt_date, method, reference,
    notes, cuenta_id, created_by
  ) VALUES (
    p_empresa_id, p_sales_document_id, p_amount, coalesce(p_receipt_date, CURRENT_DATE),
    p_method::public.receipt_method, p_reference, p_notes, p_cuenta_id, p_created_by
  ) RETURNING id INTO v_receipt_id;

  IF p_cuenta_id IS NOT NULL THEN
    PERFORM public.registrar_movimiento_tesoreria(
      p_empresa_id := p_empresa_id,
      p_cuenta_id := p_cuenta_id,
      p_monto := p_amount,
      p_tipo := 'COBRO',
      p_fecha := coalesce(p_receipt_date, CURRENT_DATE),
      p_motivo := 'Cobro comprobante ' || v_doc.code,
      p_sales_receipt_id := v_receipt_id,
      p_created_by := p_created_by,
      p_permitir_negativo := true
    );
  END IF;
  RETURN v_receipt_id;
END;
$$;

-- Reversing a receipt is idempotent and atomically appends contra-entries,
-- marks the source receipt, and recalculates the document balance/status.
CREATE OR REPLACE FUNCTION public.revertir_cobro_atomico(
  p_empresa_id uuid,
  p_sales_receipt_id uuid,
  p_reversal_reason text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc_id uuid;
  v_receipt public.sales_receipts;
  v_original record;
  v_reversal_id uuid;
  v_first_reversal_id uuid;
  v_reversed_any boolean := false;
  v_reason text := pg_catalog.btrim(coalesce(p_reversal_reason, ''));
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para revertir cobro';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'El motivo de reversa es obligatorio'; END IF;

  SELECT r.sales_document_id INTO v_doc_id
  FROM public.sales_receipts r
  WHERE r.id = p_sales_receipt_id AND r.empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobro no encontrado para la empresa'; END IF;

  PERFORM 1 FROM public.sales_documents d
  WHERE d.id = v_doc_id AND d.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento de venta no encontrado para la empresa'; END IF;

  SELECT * INTO v_receipt FROM public.sales_receipts r
  WHERE r.id = p_sales_receipt_id AND r.sales_document_id = v_doc_id
    AND r.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cobro no encontrado para la empresa'; END IF;
  IF v_receipt.reversed_at IS NOT NULL THEN RETURN v_receipt.id; END IF;

  FOR v_original IN
    SELECT m.id, m.cuenta_id, m.monto, m.empresa_id, c.moneda, d.currency AS document_currency
    FROM public.movimientos_tesoreria m
    JOIN public.cuentas_financieras c ON c.id = m.cuenta_id AND c.empresa_id = m.empresa_id
    JOIN public.sales_documents d ON d.id = v_doc_id AND d.empresa_id = p_empresa_id
    WHERE m.sales_receipt_id = p_sales_receipt_id AND m.empresa_id = p_empresa_id
      AND m.tipo = 'COBRO'
    ORDER BY m.id
    FOR UPDATE OF m, c
  LOOP
    IF v_original.moneda IS DISTINCT FROM v_original.document_currency THEN
      RAISE EXCEPTION 'La cuenta del movimiento original no coincide con la moneda del documento';
    END IF;
    INSERT INTO public.movimientos_tesoreria (
      empresa_id, cuenta_id, fecha, monto, tipo, motivo,
      sales_receipt_id, reversal_of_movement_id, created_by
    ) VALUES (
      p_empresa_id, v_original.cuenta_id, CURRENT_DATE, -v_original.monto, 'AJUSTE',
      'Reversa de cobro: ' || v_reason, p_sales_receipt_id, v_original.id, p_created_by
    ) RETURNING id INTO v_reversal_id;
    IF v_first_reversal_id IS NULL THEN v_first_reversal_id := v_reversal_id; END IF;
    v_reversed_any := true;
  END LOOP;

  IF v_receipt.cuenta_id IS NOT NULL AND NOT v_reversed_any THEN
    RAISE EXCEPTION 'El cobro tiene cuenta asignada pero no se encontró su movimiento de tesorería';
  END IF;

  UPDATE public.sales_receipts r
  SET reversed_at = pg_catalog.now(),
      reversed_by = p_created_by,
      reversal_reason = v_reason,
      reversal_movement_id = v_first_reversal_id
  WHERE r.id = p_sales_receipt_id AND r.empresa_id = p_empresa_id AND r.reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cobro cambió durante la reversa'; END IF;
  RETURN p_sales_receipt_id;
END;
$$;

-- RFQ selection, authorized-order creation and RFQ state transition are one
-- idempotent transaction. A retry for the already-selected offer returns the
-- existing order; a competing selection fails closed.
CREATE OR REPLACE FUNCTION public.select_and_authorize_offer_atomically(
  p_empresa_id uuid,
  p_actor_id uuid,
  p_rfq_id uuid,
  p_rfq_provider_id uuid,
  p_quote_version_id uuid,
  p_selection_reason public.selection_reason DEFAULT NULL,
  p_selection_reason_detail text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rfq public.rfqs;
  v_rp record;
  v_quote public.quote_versions;
  v_order_id uuid;
  v_lowest_competing_price numeric;
  v_is_cheapest boolean;
BEGIN
  IF auth.uid() IS NULL
     OR p_actor_id IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['comercial','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para autorizar oferta';
  END IF;

  SELECT * INTO v_rfq FROM public.rfqs r
  WHERE r.id = p_rfq_id AND r.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;

  SELECT rp.id, rp.rfq_id, rp.provider_id, p.name AS provider_name
    INTO v_rp
  FROM public.rfq_providers rp
  JOIN public.providers p ON p.id = rp.provider_id AND p.empresa_id = p_empresa_id
  WHERE rp.id = p_rfq_provider_id AND rp.rfq_id = p_rfq_id
    AND rp.empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado en esta solicitud'; END IF;

  SELECT qv.* INTO v_quote
  FROM public.quote_versions qv
  JOIN public.quotes q ON q.id = qv.quote_id AND q.empresa_id = p_empresa_id
  WHERE qv.id = p_quote_version_id AND qv.empresa_id = p_empresa_id
    AND q.rfq_provider_id = p_rfq_provider_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada para este proveedor y solicitud'; END IF;
  IF v_quote.version_number <> (
    SELECT max(qv_latest.version_number)
    FROM public.quote_versions qv_latest
    WHERE qv_latest.quote_id = v_quote.quote_id AND qv_latest.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Solo se puede autorizar la última versión de la cotización';
  END IF;

  IF v_rfq.status = 'AUTORIZADO' THEN
    SELECT ao.id INTO v_order_id
    FROM public.authorized_orders ao
    WHERE ao.rfq_id = p_rfq_id AND ao.empresa_id = p_empresa_id
      AND ao.created_from = 'rfq'
      AND ao.provider_id = v_rp.provider_id
      AND ao.quote_version_id = p_quote_version_id
    ORDER BY ao.created_at DESC
    LIMIT 1;
    IF v_order_id IS NOT NULL AND v_rfq.selected_rfq_provider_id = p_rfq_provider_id THEN
      RETURN v_order_id;
    END IF;
    RAISE EXCEPTION 'La solicitud ya tiene otra oferta autorizada';
  END IF;
  IF v_rfq.status NOT IN ('COTIZANDO','OFERTAS_RECIBIDAS') THEN
    RAISE EXCEPTION 'La solicitud está cerrada o no admite autorización';
  END IF;

  SELECT min(qv_comp.total_price) INTO v_lowest_competing_price
  FROM public.rfq_providers rp_comp
  JOIN public.quotes q_comp ON q_comp.rfq_provider_id = rp_comp.id
    AND q_comp.empresa_id = p_empresa_id
  JOIN public.quote_versions qv_comp ON qv_comp.quote_id = q_comp.id
    AND qv_comp.empresa_id = p_empresa_id
    AND qv_comp.version_number = (
      SELECT max(qv_latest.version_number)
      FROM public.quote_versions qv_latest
      WHERE qv_latest.quote_id = q_comp.id AND qv_latest.empresa_id = p_empresa_id
    )
  WHERE rp_comp.rfq_id = p_rfq_id AND rp_comp.empresa_id = p_empresa_id
    AND rp_comp.id <> p_rfq_provider_id
    AND qv_comp.currency = v_quote.currency;

  v_is_cheapest := v_lowest_competing_price IS NULL
    OR v_quote.total_price <= v_lowest_competing_price;
  IF NOT v_is_cheapest AND p_selection_reason IS NULL THEN
    RAISE EXCEPTION 'La oferta no es la más económica: se requiere motivo de selección';
  END IF;

  INSERT INTO public.authorized_orders (
    empresa_id, rfq_id, provider_id, quote_version_id, created_from,
    provider_name, client_name, product, quantity, unit, unit_price,
    total_price, currency, vat_included, authorized_by, is_cheapest,
    selection_reason, selection_reason_detail, project_id
  ) VALUES (
    p_empresa_id, v_rfq.id, v_rp.provider_id, v_quote.id, 'rfq',
    v_rp.provider_name, v_rfq.client_name, v_rfq.product, v_rfq.quantity, v_rfq.unit,
    v_quote.unit_price, v_quote.total_price, v_quote.currency, v_quote.vat_included,
    p_actor_id, v_is_cheapest,
    CASE WHEN v_is_cheapest THEN NULL ELSE p_selection_reason END,
    CASE WHEN v_is_cheapest THEN NULL ELSE nullif(pg_catalog.btrim(p_selection_reason_detail), '') END,
    v_rfq.project_id
  ) RETURNING id INTO v_order_id;

  UPDATE public.rfqs r
  SET status = 'AUTORIZADO', selected_rfq_provider_id = p_rfq_provider_id,
      updated_at = pg_catalog.now()
  WHERE r.id = p_rfq_id AND r.empresa_id = p_empresa_id
    AND r.status IN ('COTIZANDO','OFERTAS_RECIBIDAS');
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud cambió durante la autorización'; END IF;
  RETURN v_order_id;
END;
$$;

-- Only RPCs may create accounts/opening movements or mutate either ledger.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cuentas_financieras FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cuentas_financieras TO authenticated;
GRANT UPDATE (nombre, tipo, banco, numero_cuenta, activo, updated_at)
  ON TABLE public.cuentas_financieras TO authenticated;
DROP POLICY IF EXISTS "update cuentas_fin" ON public.cuentas_financieras;
CREATE POLICY cuentas_fin_update_admin ON public.cuentas_financieras FOR UPDATE
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

-- Revoke PostgreSQL's default PUBLIC EXECUTE on all exposed security-definer
-- routines, then grant only to authenticated application callers.
REVOKE ALL ON FUNCTION public.registrar_movimiento_tesoreria(uuid, uuid, numeric, text, date, text, uuid, uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_movimiento_tesoreria(uuid, uuid, numeric, text, date, text, uuid, uuid, uuid, uuid, boolean)
  TO authenticated;

REVOKE ALL ON FUNCTION public.registrar_transferencia(uuid, uuid, uuid, numeric, numeric, date, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_transferencia(uuid, uuid, uuid, numeric, numeric, date, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.crear_cuenta_financiera_atomica(uuid, text, text, text, text, public.currency_code, numeric, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_cuenta_financiera_atomica(uuid, text, text, text, text, public.currency_code, numeric, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.verificar_saldos_tesoreria(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verificar_saldos_tesoreria(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.next_op_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_op_code() TO authenticated;
REVOKE ALL ON FUNCTION public.next_doc_code(uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.ejecutar_orden_pago_atomica(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ejecutar_orden_pago_atomica(uuid, uuid, uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.registrar_cobro_atomico(uuid, uuid, numeric, text, date, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_atomico(uuid, uuid, numeric, text, date, text, text, uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.revertir_cobro_atomico(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_cobro_atomico(uuid, uuid, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.select_and_authorize_offer_atomically(uuid, uuid, uuid, uuid, uuid, public.selection_reason, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_and_authorize_offer_atomically(uuid, uuid, uuid, uuid, uuid, public.selection_reason, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.fn_mov_tesoreria_saldo() FROM PUBLIC, anon, authenticated;
