-- =============================================================================
-- 0059_gate0_security_and_integrity_hardening.sql
--
-- GATE 0: Hardening de Seguridad, Multi-Tenancy e Integridad Monetaria
--
-- 1. Corrige leaks multi-tenant en payment_orders y payment_order_invoices (0025).
--    Las políticas originales no filtraban por empresa_id.
-- 2. Agrega triggers BEFORE INSERT para asignar y validar empresa_id en payment_orders
--    y payment_order_invoices (prevención de vinculación cross-tenant de facturas).
-- 3. Corrige leaks multi-tenant en Supabase Storage (quote-pdfs, invoice-files,
--    rfq-attachments de 0005_storage.sql y 0015_invoice_jobs.sql).
-- 4. Introduce funciones RPC atómicas para ejecución de órdenes de pago
--    y cobros, garantizando integridad del ledger de tesorería y evitando
--    desincronizaciones entre el estado documental y los saldos bancarios.
-- 5. Bloquea el borrado de facturas pagadas o vinculadas a OPs ejecutadas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Hardening RLS en payment_orders y payment_order_invoices
-- ---------------------------------------------------------------------------

-- Eliminar políticas no scopeadas de 0025 y 0032
DROP POLICY IF EXISTS payment_orders_select ON public.payment_orders;
DROP POLICY IF EXISTS payment_orders_insert ON public.payment_orders;
DROP POLICY IF EXISTS payment_orders_update ON public.payment_orders;
DROP POLICY IF EXISTS payment_orders_delete ON public.payment_orders;

DROP POLICY IF EXISTS payment_order_invoices_select ON public.payment_order_invoices;
DROP POLICY IF EXISTS payment_order_invoices_insert ON public.payment_order_invoices;
DROP POLICY IF EXISTS payment_order_invoices_delete ON public.payment_order_invoices;

-- Recrear con filtro estricto de empresa_id = public.current_empresa_id() y rol
CREATE POLICY payment_orders_select ON public.payment_orders
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

CREATE POLICY payment_orders_insert ON public.payment_orders
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

CREATE POLICY payment_orders_update ON public.payment_orders
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  ) WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

CREATE POLICY payment_orders_delete ON public.payment_orders
  FOR DELETE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

CREATE POLICY payment_order_invoices_select ON public.payment_order_invoices
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

CREATE POLICY payment_order_invoices_insert ON public.payment_order_invoices
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

CREATE POLICY payment_order_invoices_delete ON public.payment_order_invoices
  FOR DELETE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

-- Triggers de empresa_id para payment_orders
CREATE OR REPLACE FUNCTION public.set_payment_orders_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.empresa_id IS NULL THEN
    new.empresa_id := public.current_empresa_id();
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_orders_empresa ON public.payment_orders;
CREATE TRIGGER trg_payment_orders_empresa
  BEFORE INSERT ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_payment_orders_empresa();

-- Trigger de integridad tenant para payment_order_invoices:
-- Valida que la factura y la OP pertenezcan estrictamente a la misma empresa.
CREATE OR REPLACE FUNCTION public.set_payment_order_invoices_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op_empresa uuid;
  v_inv_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_op_empresa FROM public.payment_orders WHERE id = new.payment_order_id;
  SELECT empresa_id INTO v_inv_empresa FROM public.invoices WHERE id = new.invoice_id;

  IF new.empresa_id IS NULL THEN
    new.empresa_id := coalesce(v_op_empresa, public.current_empresa_id());
  END IF;

  IF v_op_empresa IS DISTINCT FROM new.empresa_id THEN
    RAISE EXCEPTION 'payment_order % does not belong to empresa %', new.payment_order_id, new.empresa_id;
  END IF;

  IF v_inv_empresa IS DISTINCT FROM new.empresa_id THEN
    RAISE EXCEPTION 'invoice % does not belong to empresa %', new.invoice_id, new.empresa_id;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_order_invoices_empresa ON public.payment_order_invoices;
CREATE TRIGGER trg_payment_order_invoices_empresa
  BEFORE INSERT ON public.payment_order_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_payment_order_invoices_empresa();

-- ---------------------------------------------------------------------------
-- 2. Hardening RLS en Storage (quote-pdfs, invoice-files, rfq-attachments)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "internal read quote-pdfs" ON storage.objects;
DROP POLICY IF EXISTS "internal read invoice-files" ON storage.objects;
DROP POLICY IF EXISTS "internal write invoice-files" ON storage.objects;
DROP POLICY IF EXISTS "internal read rfq-attachments" ON storage.objects;

-- quote-pdfs: comercial y admin leen solo PDFs de cotizaciones de su empresa
CREATE POLICY "internal read quote-pdfs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'quote-pdfs'
    AND public.is_internal_role(ARRAY['comercial','admin']::public.user_role[])
    AND (
      EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.path = name AND a.empresa_id = public.current_empresa_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.rfqs r
        WHERE r.id::text = (storage.foldername(name))[1]
          AND r.empresa_id = public.current_empresa_id()
      )
    )
  );

-- invoice-files lectura: administracion y admin leen solo facturas de su empresa
CREATE POLICY "internal read invoice-files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'invoice-files'
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    AND (
      (storage.foldername(name))[1] = public.current_empresa_id()::text
      OR EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.path = name AND a.empresa_id = public.current_empresa_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.invoice_jobs j
        WHERE j.storage_path = name AND j.empresa_id = public.current_empresa_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.providers pr
        WHERE pr.id::text = (storage.foldername(name))[1]
          AND pr.empresa_id = public.current_empresa_id()
      )
    )
  );

-- invoice-files escritura directa: administracion y admin solo pueden escribir bajo su empresa_id o su proveedor
CREATE POLICY "internal write invoice-files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'invoice-files'
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    AND (
      (storage.foldername(name))[1] = public.current_empresa_id()::text
      OR EXISTS (
        SELECT 1 FROM public.providers pr
        WHERE pr.id::text = (storage.foldername(name))[1]
          AND pr.empresa_id = public.current_empresa_id()
      )
    )
  );

-- rfq-attachments: usuarios internos leen solo adjuntos de sus RFQs
CREATE POLICY "internal read rfq-attachments" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'rfq-attachments'
    AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[])
    AND (
      EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.path = name AND a.empresa_id = public.current_empresa_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.rfqs r
        WHERE r.id::text = (storage.foldername(name))[1]
          AND r.empresa_id = public.current_empresa_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Atomicidad e Integridad de Ledger: Ejecución de Orden de Pago
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ejecutar_orden_pago_atomica(
  p_empresa_id uuid,
  p_op_id uuid,
  p_cuenta_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.payment_orders;
  v_rec record;
  v_invoice_ids uuid[];
BEGIN
  -- 1. Bloquear y validar la orden de pago
  SELECT * INTO v_op
  FROM public.payment_orders
  WHERE id = p_op_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de pago % no encontrada para la empresa %', p_op_id, p_empresa_id;
  END IF;

  IF v_op.status <> 'EMITIDA' THEN
    RAISE EXCEPTION 'La orden de pago ya fue ejecutada o anulada (estado actual: %)', v_op.status;
  END IF;

  -- 2. Obtener los IDs de facturas asociadas
  SELECT array_agg(invoice_id) INTO v_invoice_ids
  FROM public.payment_order_invoices
  WHERE payment_order_id = p_op_id;

  IF v_invoice_ids IS NULL OR array_length(v_invoice_ids, 1) = 0 THEN
    RAISE EXCEPTION 'La orden de pago no tiene facturas vinculadas';
  END IF;

  -- 3. Marcar la orden como EJECUTADA
  UPDATE public.payment_orders
  SET status = 'EJECUTADA',
      executed_at = now(),
      cuenta_id = p_cuenta_id
  WHERE id = p_op_id;

  -- 4. Marcar todas las facturas como PAGADO (scoped por empresa)
  UPDATE public.invoices
  SET status = 'PAGADO',
      updated_at = now()
  WHERE id = ANY(v_invoice_ids)
    AND empresa_id = p_empresa_id;

  -- 5. Si se especificó cuenta de tesorería, registrar el/los egresos correspondientes
  IF p_cuenta_id IS NOT NULL THEN
    FOR v_rec IN (
      SELECT i.currency, sum(i.total) AS total_monto
      FROM public.payment_order_invoices poi
      JOIN public.invoices i ON i.id = poi.invoice_id
      WHERE poi.payment_order_id = p_op_id
      GROUP BY i.currency
    ) LOOP
      IF v_rec.total_monto > 0 THEN
        PERFORM public.registrar_movimiento_tesoreria(
          p_empresa_id        := p_empresa_id,
          p_cuenta_id         := p_cuenta_id,
          p_monto             := -v_rec.total_monto,
          p_tipo              := 'PAGO',
          p_fecha             := current_date,
          p_motivo            := 'Pago OP ' || v_op.code,
          p_payment_order_id  := p_op_id,
          p_sales_receipt_id  := NULL,
          p_project_id        := NULL,
          p_created_by        := p_created_by,
          p_permitir_negativo := true
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Atomicidad e Integridad de Ledger: Registro de Cobro
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_cobro_atomico(
  p_empresa_id uuid,
  p_sales_document_id uuid,
  p_amount numeric,
  p_method text,
  p_receipt_date date DEFAULT current_date,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_cuenta_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.sales_documents;
  v_receipt_id uuid;
BEGIN
  -- Validar documento de venta
  SELECT * INTO v_doc
  FROM public.sales_documents
  WHERE id = p_sales_document_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento de venta no encontrado';
  END IF;

  IF v_doc.status IN ('BORRADOR', 'ANULADA') THEN
    RAISE EXCEPTION 'No se puede cobrar un documento en estado %', v_doc.status;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a cero';
  END IF;

  -- Insertar el recibo (el trigger trg_sales_receipts_recompute actualizará sales_documents.cobrado_amount)
  INSERT INTO public.sales_receipts (
    empresa_id, sales_document_id, amount, receipt_date, method, reference, notes, cuenta_id, created_by
  ) VALUES (
    p_empresa_id, p_sales_document_id, p_amount, coalesce(p_receipt_date, current_date),
    p_method::public.receipt_method, p_reference, p_notes, p_cuenta_id, p_created_by
  )
  RETURNING id INTO v_receipt_id;

  -- Si se especificó cuenta de tesorería, registrar el ingreso atómicamente
  IF p_cuenta_id IS NOT NULL THEN
    PERFORM public.registrar_movimiento_tesoreria(
      p_empresa_id        := p_empresa_id,
      p_cuenta_id         := p_cuenta_id,
      p_monto             := p_amount,
      p_tipo              := 'COBRO',
      p_fecha             := coalesce(p_receipt_date, current_date),
      p_motivo            := 'Cobro comprobante ' || v_doc.code,
      p_payment_order_id  := NULL,
      p_sales_receipt_id  := v_receipt_id,
      p_project_id        := NULL,
      p_created_by        := p_created_by,
      p_permitir_negativo := true
    );
  END IF;

  RETURN v_receipt_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Salvaguarda de Integridad Contable: No borrar facturas pagadas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_invoice_delete_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF old.status = 'PAGADO' THEN
    RAISE EXCEPTION 'No se puede eliminar la factura % porque ya fue pagada (integridad contable)', old.invoice_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_order_invoices poi
    JOIN public.payment_orders po ON po.id = poi.payment_order_id
    WHERE poi.invoice_id = old.id AND po.status = 'EJECUTADA'
  ) THEN
    RAISE EXCEPTION 'No se puede eliminar la factura % porque pertenece a una orden de pago ejecutada', old.invoice_number;
  END IF;

  RETURN old;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_delete_integrity ON public.invoices;
CREATE TRIGGER trg_invoice_delete_integrity
  BEFORE DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.check_invoice_delete_integrity();
