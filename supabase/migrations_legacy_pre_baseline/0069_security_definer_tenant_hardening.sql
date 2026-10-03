-- ==============================================================================
-- MIGRACIÓN 0069: HARDENING P0 DE AISLAMIENTO MULTI-TENANT, RPCs Y MONEDA
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDENING DE RPC: ejecutar_orden_pago_atomica
-- ------------------------------------------------------------------------------
-- Invariantes:
-- 1. La sesión debe pertenecer al tenant especificado (p_empresa_id = current_empresa_id()).
-- 2. La orden de pago debe pertenecer a p_empresa_id.
-- 3. TODAS las facturas asociadas a la orden deben pertenecer estrictamente a p_empresa_id.
--    Si existe discordancia en alguna factura, la transacción aborta (fail-closed).
-- 4. Si se provee p_cuenta_id, la cuenta financiera debe pertenecer estrictamente a p_empresa_id.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ejecutar_orden_pago_atomica(
  p_empresa_id uuid,
  p_op_id uuid,
  p_cuenta_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_empresa uuid;
  v_op public.payment_orders;
  v_rec record;
  v_invoice_ids uuid[];
  v_valid_invoices_count integer;
BEGIN
  -- 1. Verificación obligatoria de aislamiento multi-tenant del caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere sesión autenticada';
  END IF;

  v_current_empresa := public.current_empresa_id();
  IF v_current_empresa IS NULL OR v_current_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no pertenece a la empresa especificada (%)', p_empresa_id;
  END IF;

  -- 2. Bloquear y validar la orden de pago dentro del tenant
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

  -- 3. Obtener y validar las facturas asociadas
  SELECT array_agg(invoice_id) INTO v_invoice_ids
  FROM public.payment_order_invoices
  WHERE payment_order_id = p_op_id;

  IF v_invoice_ids IS NULL OR array_length(v_invoice_ids, 1) = 0 THEN
    RAISE EXCEPTION 'La orden de pago no tiene facturas vinculadas';
  END IF;

  -- Validar que TODAS las facturas vinculadas pertenezcan estrictamente al mismo tenant
  SELECT count(*) INTO v_valid_invoices_count
  FROM public.invoices
  WHERE id = ANY(v_invoice_ids)
    AND empresa_id = p_empresa_id;

  IF v_valid_invoices_count <> array_length(v_invoice_ids, 1) THEN
    RAISE EXCEPTION 'Integridad tenant violada: la orden de pago contiene facturas que no pertenecen a la empresa %', p_empresa_id;
  END IF;

  -- 4. Validar cuenta de tesorería si fue provista
  IF p_cuenta_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cuentas_financieras
      WHERE id = p_cuenta_id AND empresa_id = p_empresa_id
    ) THEN
      RAISE EXCEPTION 'Cuenta financiera % no encontrada para la empresa %', p_cuenta_id, p_empresa_id;
    END IF;
  END IF;

  -- 5. Marcar la orden como EJECUTADA
  UPDATE public.payment_orders
  SET status = 'EJECUTADA',
      executed_at = now(),
      cuenta_id = p_cuenta_id
  WHERE id = p_op_id AND empresa_id = p_empresa_id;

  -- 6. Marcar todas las facturas como PAGADO
  UPDATE public.invoices
  SET status = 'PAGADO',
      updated_at = now()
  WHERE id = ANY(v_invoice_ids)
    AND empresa_id = p_empresa_id;

  -- 7. Registrar egresos de tesorería atómicamente si hay cuenta asignada
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

-- ------------------------------------------------------------------------------
-- 2. HARDENING DE RPC: registrar_cobro_atomico
-- ------------------------------------------------------------------------------
-- Invariantes:
-- 1. La sesión debe pertenecer al tenant especificado (p_empresa_id = current_empresa_id()).
-- 2. El documento de venta debe pertenecer a p_empresa_id.
-- 3. Si se provee p_cuenta_id, la cuenta financiera debe pertenecer estrictamente a p_empresa_id.
-- ------------------------------------------------------------------------------

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_empresa uuid;
  v_doc public.sales_documents;
  v_receipt_id uuid;
BEGIN
  -- 1. Verificación obligatoria de aislamiento multi-tenant del caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere sesión autenticada';
  END IF;

  v_current_empresa := public.current_empresa_id();
  IF v_current_empresa IS NULL OR v_current_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no pertenece a la empresa especificada (%)', p_empresa_id;
  END IF;

  -- 2. Validar y bloquear documento de venta dentro del tenant
  SELECT * INTO v_doc
  FROM public.sales_documents
  WHERE id = p_sales_document_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento de venta no encontrado para la empresa %', p_empresa_id;
  END IF;

  IF v_doc.status IN ('BORRADOR', 'ANULADA') THEN
    RAISE EXCEPTION 'No se puede cobrar un documento en estado %', v_doc.status;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a cero';
  END IF;

  -- 3. Validar cuenta de tesorería si fue provista
  IF p_cuenta_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cuentas_financieras
      WHERE id = p_cuenta_id AND empresa_id = p_empresa_id
    ) THEN
      RAISE EXCEPTION 'Cuenta financiera % no encontrada para la empresa %', p_cuenta_id, p_empresa_id;
    END IF;
  END IF;

  -- 4. Insertar el recibo
  INSERT INTO public.sales_receipts (
    empresa_id, sales_document_id, amount, receipt_date, method, reference, notes, cuenta_id, created_by
  ) VALUES (
    p_empresa_id, p_sales_document_id, p_amount, coalesce(p_receipt_date, current_date),
    p_method::public.receipt_method, p_reference, p_notes, p_cuenta_id, p_created_by
  )
  RETURNING id INTO v_receipt_id;

  -- 5. Registrar el ingreso en tesorería atómicamente
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

-- ------------------------------------------------------------------------------
-- 3. HARDENING DE RPC: convertir_licitacion_a_proyecto_atomico
-- ------------------------------------------------------------------------------
-- Eliminación del bypass 'auth.uid() IS NULL'. Se exige estrictamente sesión
-- autenticada cuyo tenant coincida con p_empresa_id.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.convertir_licitacion_a_proyecto_atomico(
  p_empresa_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_client TEXT,
  p_comitente TEXT,
  p_contract_number TEXT,
  p_contract_amount NUMERIC,
  p_budget_total NUMERIC,
  p_plazo_dias INTEGER,
  p_anticipo_pct NUMERIC,
  p_retencion_pct NUMERIC,
  p_start_date DATE,
  p_end_date DATE,
  p_tender_id TEXT,
  p_bid_analysis_run_id UUID,
  p_created_by UUID,
  p_budget_items JSONB,
  p_nombre_deposito TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_empresa UUID;
  v_project_id UUID;
  v_existing_code TEXT;
  v_existing_tender_id TEXT;
  v_existing_deposito_proj UUID;
  v_item JSONB;
  v_sort_order INT := 1;
  v_lic_decision TEXT;
  v_lic_empresa UUID;
  v_lic_proj UUID;
  v_lic_db_id UUID;
  v_lic_proc_id UUID;
  v_run_empresa UUID;
  v_item_qty NUMERIC;
  v_item_price NUMERIC;
  v_item_desc TEXT;
  v_item_unit TEXT;
  v_calculated_budget_total NUMERIC(18,2) := 0;
BEGIN
  -- 8.1 Seguridad Multi-Tenant Estricta: Obligatorio caller autenticado y coincidencia de tenant
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere sesión autenticada';
  END IF;

  v_current_empresa := public.current_empresa_id();
  IF v_current_empresa IS NULL OR v_current_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario autenticado no pertenece a la empresa especificada (%)', p_empresa_id;
  END IF;

  -- 8.2 Validación de Items de Presupuesto: estrictamente no vacío
  IF p_budget_items IS NULL OR jsonb_array_length(p_budget_items) = 0 THEN
    RAISE EXCEPTION 'No se puede convertir licitacion a proyecto sin items de presupuesto';
  END IF;

  -- 8.3 Verificación de la Licitación de origen
  IF p_tender_id IS NOT NULL AND trim(p_tender_id) <> '' THEN
    SELECT id, empresa_id, decision, project_id, process_id
    INTO v_lic_db_id, v_lic_empresa, v_lic_decision, v_lic_proj, v_lic_proc_id
    FROM public.licitaciones
    WHERE (id::TEXT = p_tender_id OR dncp_nro = p_tender_id)
      AND empresa_id = p_empresa_id;

    IF v_lic_empresa IS NULL THEN
      RAISE EXCEPTION 'Licitación % no encontrada para la empresa %', p_tender_id, p_empresa_id;
    END IF;

    IF COALESCE(v_lic_decision, '') <> 'GANADA' THEN
      RAISE EXCEPTION 'Integridad contractual violada: la licitación % no tiene decisión GANADA (estado actual: %)', p_tender_id, COALESCE(v_lic_decision, 'SIN_DECISION');
    END IF;

    -- Si la licitación ya tiene obra vinculada por FK
    IF v_lic_proj IS NOT NULL THEN
      SELECT id, code INTO v_project_id, v_existing_code
      FROM public.projects
      WHERE id = v_lic_proj AND empresa_id = p_empresa_id;

      IF v_project_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'already_existed', true,
          'project_id', v_project_id,
          'project_code', v_existing_code
        );
      END IF;
    END IF;
  END IF;

  -- 8.4 Verificación de corrida de análisis comercial (si fue provista)
  IF p_bid_analysis_run_id IS NOT NULL THEN
    SELECT empresa_id INTO v_run_empresa
    FROM public.bid_analysis_runs
    WHERE id = p_bid_analysis_run_id;

    IF v_run_empresa IS NULL OR v_run_empresa <> p_empresa_id THEN
      RAISE EXCEPTION 'La corrida de análisis % no pertenece a la empresa %', p_bid_analysis_run_id, p_empresa_id;
    END IF;
  END IF;

  -- 8.5 Idempotencia y Prevención de Colisiones por Código de Obra
  SELECT id, code, tender_id INTO v_project_id, v_existing_code, v_existing_tender_id
  FROM public.projects
  WHERE empresa_id = p_empresa_id AND code = p_code;

  IF v_project_id IS NOT NULL THEN
    IF v_existing_tender_id IS NOT NULL AND p_tender_id IS NOT NULL AND v_existing_tender_id <> p_tender_id THEN
      RAISE EXCEPTION 'Conflicto de integridad: ya existe un proyecto con código % asignado a otra licitación (%)', p_code, v_existing_tender_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'already_existed', true,
      'project_id', v_project_id,
      'project_code', v_existing_code
    );
  END IF;

  -- 8.6 Validación estricta y cálculo de total de budget_items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_budget_items)
  LOOP
    v_item_desc := trim(COALESCE(v_item->>'description', ''));
    v_item_unit := trim(COALESCE(v_item->>'unit', ''));
    v_item_qty := (v_item->>'quantity')::NUMERIC;
    v_item_price := (v_item->>'unit_price')::NUMERIC;

    IF v_item_desc = '' THEN
      RAISE EXCEPTION 'Ítem de presupuesto inválido: descripción no puede ser vacía';
    END IF;

    IF v_item_unit = '' THEN
      RAISE EXCEPTION 'Ítem de presupuesto % sin unidad de medida verificable', v_item_desc;
    END IF;

    IF v_item_qty IS NULL OR v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Ítem de presupuesto % tiene cantidad no válida (%)', v_item_desc, v_item_qty;
    END IF;

    IF v_item_price IS NULL OR v_item_price <= 0 THEN
      RAISE EXCEPTION 'Ítem de presupuesto % tiene precio unitario no válido (%)', v_item_desc, v_item_price;
    END IF;

    v_calculated_budget_total := v_calculated_budget_total + ROUND(v_item_qty * v_item_price, 2);
  END LOOP;

  -- 8.7 Inserción Atómica del Proyecto en public.projects
  INSERT INTO public.projects (
    empresa_id,
    name,
    code,
    client,
    comitente,
    contract_number,
    contract_amount,
    budget_total,
    plazo_dias,
    anticipo_pct,
    retencion_pct,
    start_date,
    end_date,
    status,
    tender_id,
    bid_analysis_run_id,
    created_by
  ) VALUES (
    p_empresa_id,
    p_name,
    p_code,
    p_client,
    p_comitente,
    p_contract_number,
    p_contract_amount,
    COALESCE(p_budget_total, v_calculated_budget_total),
    p_plazo_dias,
    p_anticipo_pct,
    p_retencion_pct,
    p_start_date,
    p_end_date,
    'ACTIVO',
    p_tender_id,
    p_bid_analysis_run_id,
    p_created_by
  )
  RETURNING id INTO v_project_id;

  -- 8.8 Inserción Atómica de Ítems de Presupuesto (budget_items)
  v_sort_order := 1;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_budget_items)
  LOOP
    v_item_qty := (v_item->>'quantity')::NUMERIC;
    v_item_price := (v_item->>'unit_price')::NUMERIC;

    INSERT INTO public.budget_items (
      project_id,
      code,
      description,
      unit,
      quantity,
      unit_price,
      sort_order
    ) VALUES (
      v_project_id,
      COALESCE(v_item->>'code', 'ITM-' || LPAD(v_sort_order::TEXT, 3, '0')),
      trim(v_item->>'description'),
      trim(v_item->>'unit'),
      v_item_qty,
      v_item_price,
      COALESCE((v_item->>'sort_order')::INT, v_sort_order)
    );
    v_sort_order := v_sort_order + 1;
  END LOOP;

  -- 8.9 Creación de Depósito de Obra (Pañol de Proyecto)
  IF p_nombre_deposito IS NOT NULL AND trim(p_nombre_deposito) <> '' THEN
    SELECT id INTO v_existing_deposito_proj
    FROM public.depositos
    WHERE empresa_id = p_empresa_id AND project_id = v_project_id
    LIMIT 1;

    IF v_existing_deposito_proj IS NULL THEN
      INSERT INTO public.depositos (
        empresa_id,
        nombre,
        es_principal,
        project_id,
        activo
      ) VALUES (
        p_empresa_id,
        p_nombre_deposito,
        false,
        v_project_id,
        true
      );
    END IF;
  END IF;

  -- 8.10 Actualizar Enlace Relacional Canónico en public.licitaciones
  IF p_tender_id IS NOT NULL AND trim(p_tender_id) <> '' THEN
    UPDATE public.licitaciones
    SET 
      project_id = v_project_id,
      raw_json = jsonb_set(
        COALESCE(raw_json, '{}'::JSONB),
        '{obra_vinculada}',
        jsonb_build_object(
          'project_id', v_project_id,
          'project_code', p_code,
          'converted_at', timezone('utc'::TEXT, now())
        )
      ),
      updated_at = timezone('utc'::TEXT, now())
    WHERE (id::TEXT = p_tender_id OR dncp_nro = p_tender_id)
      AND empresa_id = p_empresa_id;

    -- También actualizar seguimiento si existe
    IF v_lic_proc_id IS NOT NULL THEN
      UPDATE public.empresa_licitacion_seguimiento
      SET project_id = v_project_id, updated_at = now()
      WHERE empresa_id = p_empresa_id AND process_id = v_lic_proc_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_existed', false,
    'project_id', v_project_id,
    'project_code', p_code
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. REPARACIÓN SEMÁNTICA Y TRAZABILIDAD DE MONEDA: cost_observations
-- ------------------------------------------------------------------------------
-- Invariante: Un valor monetario no puede cambiar de moneda sin conversión real.
-- 1. Añadir columnas de preservación de evidencia original si no existen.
-- 2. Identificar registros donde moneda <> 'PYG' sin tipo de cambio verificado
--    o marcados como REVISION_REQUERIDA y desacoplar el precio unitario computado.
-- ------------------------------------------------------------------------------

ALTER TABLE public.cost_observations
  ADD COLUMN IF NOT EXISTS moneda_original TEXT,
  ADD COLUMN IF NOT EXISTS precio_unitario_original NUMERIC(18, 4);

-- Ajustar constraint de precio_unitario para admitir NULL exclusivamente en filas
-- en REVISION_REQUERIDA donde no es posible computar un valor en PYG seguro
ALTER TABLE public.cost_observations
  ALTER COLUMN precio_unitario DROP NOT NULL;

ALTER TABLE public.cost_observations
  DROP CONSTRAINT IF EXISTS cost_observations_precio_unitario_check;

ALTER TABLE public.cost_observations
  ADD CONSTRAINT cost_observations_precio_unitario_check
  CHECK (
    (estado_evidencia = 'REVISION_REQUERIDA' AND precio_unitario IS NULL)
    OR
    (precio_unitario IS NOT NULL AND precio_unitario >= 0)
  );

-- Reparar semánticamente filas ambiguas catalogadas como REVISION_REQUERIDA:
-- 1. Si la observación proviene de una factura identificable en public.invoices (fuente = 'FACTURA'),
--    reconstruir determinísticamente la moneda real a partir de invoice.currency.
-- 2. Si proviene de orden de compra identificable en public.authorized_orders (fuente = 'ORDEN_COMPRA'),
--    reconstruir determinísticamente desde authorized_orders.currency.
-- 3. Si no existe vínculo inequívoco a un documento persistido, la moneda original es IRRECUPERABLE:
--    moneda_original := NULL (UNKNOWN != DEFAULT: NUNCA inventar 'USD' u otra moneda).
-- 4. En todos los casos ambiguos sin tasa de cambio, preservar precio_unitario_original con el valor numérico
--    y forzar precio_unitario = NULL para que JAMÁS se presente ni compute como PYG.

-- Paso A: Preservar precio_unitario_original y desacoplar precio_unitario en PYG
UPDATE public.cost_observations
SET
  precio_unitario_original = COALESCE(precio_unitario_original, precio_unitario),
  precio_unitario = NULL
WHERE estado_evidencia = 'REVISION_REQUERIDA'
  AND (tipo_cambio IS NULL OR tipo_cambio <= 0);

-- Paso B: Reconstruir moneda_original únicamente donde existe evidencia inequívoca en facturas DEL MISMO TENANT
UPDATE public.cost_observations co
SET moneda_original = i.currency
FROM public.invoices i
WHERE co.fuente = 'FACTURA'
  AND co.documento_id IS NOT NULL
  AND co.documento_id ~ '^[0-9a-fA-F-]{36}$'
  AND i.id = co.documento_id::uuid
  AND i.empresa_id = co.empresa_id
  AND co.moneda_original IS NULL;

-- Paso C: Reconstruir moneda_original únicamente donde existe evidencia inequívoca en órdenes de compra DEL MISMO TENANT
UPDATE public.cost_observations co
SET moneda_original = o.currency
FROM public.authorized_orders o
WHERE co.fuente = 'ORDEN_COMPRA'
  AND co.documento_id IS NOT NULL
  AND co.documento_id ~ '^[0-9a-fA-F-]{36}$'
  AND o.id = co.documento_id::uuid
  AND o.empresa_id = co.empresa_id
  AND co.moneda_original IS NULL;

-- Filas sin evidencia inequívoca del mismo tenant permanecen con moneda_original = NULL (UNKNOWN).
-- No se aplica ningún fallback sintético tipo 'USD' o 'PYG', y jamás se cruza metadata entre empresas.

-- Revocar accesos anónimos a las funciones modificadas por defensa en profundidad
REVOKE ALL ON FUNCTION public.ejecutar_orden_pago_atomica(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ejecutar_orden_pago_atomica(uuid, uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ejecutar_orden_pago_atomica(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ejecutar_orden_pago_atomica(uuid, uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.registrar_cobro_atomico(uuid, uuid, numeric, text, date, text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_cobro_atomico(uuid, uuid, numeric, text, date, text, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_atomico(uuid, uuid, numeric, text, date, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_atomico(uuid, uuid, numeric, text, date, text, text, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.convertir_licitacion_a_proyecto_atomico FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convertir_licitacion_a_proyecto_atomico FROM anon;
GRANT EXECUTE ON FUNCTION public.convertir_licitacion_a_proyecto_atomico TO authenticated;
GRANT EXECUTE ON FUNCTION public.convertir_licitacion_a_proyecto_atomico TO service_role;
