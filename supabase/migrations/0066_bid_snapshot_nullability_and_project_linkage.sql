-- ==============================================================================
-- MIGRACIÓN 0066: BID SNAPSHOT NULLABILITY, PROJECT LINKAGE & ATOMIC RPC
-- ==============================================================================

-- 1. BID SNAPSHOT DB NULLABILITY
-- Permitir valores NULL para métricas que permanecen desconocidas / uncalibrated
-- bajo el invariante canónico UNKNOWN != DEFAULT.
ALTER TABLE public.bid_analysis_runs
  ALTER COLUMN precio_oferta_recomendado_pyg DROP NOT NULL,
  ALTER COLUMN margen_neto_estimado_pct DROP NOT NULL,
  ALTER COLUMN probabilidad_ganar_pct DROP NOT NULL;

-- 2. TENDER -> PROJECT LINKAGE COLUMNS
-- Preservar comitente, contrato, vinculación a licitación y corrida de análisis en projects.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tender_id text,
  ADD COLUMN IF NOT EXISTS bid_analysis_run_id uuid REFERENCES public.bid_analysis_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS contract_amount numeric(18, 2),
  ADD COLUMN IF NOT EXISTS comitente text,
  ADD COLUMN IF NOT EXISTS plazo_dias integer,
  ADD COLUMN IF NOT EXISTS anticipo_pct numeric(5, 2),
  ADD COLUMN IF NOT EXISTS retencion_pct numeric(5, 2);

CREATE INDEX IF NOT EXISTS idx_projects_tender_id ON public.projects(empresa_id, tender_id);
CREATE INDEX IF NOT EXISTS idx_projects_bid_analysis_run_id ON public.projects(bid_analysis_run_id);

-- 3. ATOMIC TENDER -> PROJECT TRANSITION RPC
-- Garantiza atomicidad total: proyecto + budget_items + pañol + vinculación de licitación.
-- Si cualquier paso falla, Postgres revierte la transacción completa.
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
  v_existing_deposito_proj UUID;
  v_item JSONB;
  v_sort_order INT := 1;
  v_lic_decision TEXT;
  v_lic_empresa UUID;
  v_run_empresa UUID;
  v_item_qty NUMERIC;
  v_item_price NUMERIC;
  v_item_desc TEXT;
  v_item_unit TEXT;
BEGIN
  -- 3.1 Seguridad e Invariante Multi-Tenant:
  -- Requiere ejecución autenticada o contexto de servicio verificado.
  -- Nunca confiar ciegamente en p_empresa_id provisto en el payload.
  IF auth.uid() IS NOT NULL THEN
    v_current_empresa := public.current_empresa_id();
    IF v_current_empresa IS NULL OR v_current_empresa <> p_empresa_id THEN
      RAISE EXCEPTION 'Acceso denegado: el usuario autenticado no pertenece a la empresa especificada (%)', p_empresa_id;
    END IF;
  END IF;

  -- 3.2 Verificación estricta de la Licitación de origen:
  -- La licitación debe pertenecer al tenant y encontrarse en estado 'GANADA'.
  IF p_tender_id IS NOT NULL AND trim(p_tender_id) <> '' THEN
    SELECT empresa_id, decision INTO v_lic_empresa, v_lic_decision
    FROM public.licitaciones
    WHERE (id::text = p_tender_id OR dncp_nro = p_tender_id)
      AND empresa_id = p_empresa_id;

    IF v_lic_empresa IS NULL THEN
      RAISE EXCEPTION 'Licitación % no encontrada para la empresa %', p_tender_id, p_empresa_id;
    END IF;

    IF COALESCE(v_lic_decision, '') <> 'GANADA' THEN
      RAISE EXCEPTION 'Integridad contractual violada: la licitación % no tiene decisión GANADA (estado actual: %)', p_tender_id, COALESCE(v_lic_decision, 'SIN_DECISION');
    END IF;
  END IF;

  -- 3.3 Verificación de corrida de análisis comercial (si fue provista):
  IF p_bid_analysis_run_id IS NOT NULL THEN
    SELECT empresa_id INTO v_run_empresa
    FROM public.bid_analysis_runs
    WHERE id = p_bid_analysis_run_id;

    IF v_run_empresa IS NULL OR v_run_empresa <> p_empresa_id THEN
      RAISE EXCEPTION 'La corrida de análisis % no pertenece a la empresa %', p_bid_analysis_run_id, p_empresa_id;
    END IF;
  END IF;

  -- 3.4 Idempotencia: Verificar si ya existe obra con este código para esta empresa
  SELECT id, code INTO v_project_id, v_existing_code
  FROM public.projects
  WHERE empresa_id = p_empresa_id AND code = p_code;

  IF v_project_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_existed', true,
      'project_id', v_project_id,
      'project_code', v_existing_code
    );
  END IF;

  -- 3.5 Insertar Proyecto
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
    tender_id,
    bid_analysis_run_id,
    status,
    created_by
  ) VALUES (
    p_empresa_id,
    p_name,
    p_code,
    p_client,
    p_comitente,
    p_contract_number,
    p_contract_amount,
    p_budget_total,
    p_plazo_dias,
    p_anticipo_pct,
    p_retencion_pct,
    p_start_date,
    p_end_date,
    p_tender_id,
    p_bid_analysis_run_id,
    'ACTIVO',
    COALESCE(p_created_by, auth.uid())
  ) RETURNING id INTO v_project_id;

  -- 3.6 Insertar Budget Items de forma atómica y estricta (P0 Invariante Económico):
  -- Prohibido inventar quantity=1, unit='UN' o unit_price=0. Ítems inválidos disparan rollback.
  IF p_budget_items IS NOT NULL AND jsonb_array_length(p_budget_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_budget_items) LOOP
      v_item_desc := trim(COALESCE(v_item->>'description', ''));
      v_item_unit := trim(COALESCE(v_item->>'unit', ''));
      v_item_qty := (v_item->>'quantity')::numeric;
      v_item_price := (v_item->>'unit_price')::numeric;

      IF v_item_desc = '' THEN
        RAISE EXCEPTION 'Ítem #% inválido: la descripción no puede estar vacía', v_sort_order;
      END IF;

      IF v_item_unit = '' THEN
        RAISE EXCEPTION 'Ítem "%" inválido: la unidad de medida es obligatoria y no puede inventarse', v_item_desc;
      END IF;

      IF v_item_qty IS NULL OR v_item_qty <= 0 THEN
        RAISE EXCEPTION 'Ítem "%" inválido: cantidad (%) debe ser estrictamente mayor a cero', v_item_desc, v_item_qty;
      END IF;

      IF v_item_price IS NULL OR v_item_price < 0 THEN
        RAISE EXCEPTION 'Ítem "%" inválido: precio unitario (%) no puede ser nulo ni negativo', v_item_desc, v_item_price;
      END IF;

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
        COALESCE(v_item->>'code', 'ITM-' || LPAD(v_sort_order::text, 3, '0')),
        v_item_desc,
        v_item_unit,
        v_item_qty,
        v_item_price,
        COALESCE((v_item->>'sort_order')::integer, v_sort_order)
      );
      v_sort_order := v_sort_order + 1;
    END LOOP;
  END IF;

  -- 3.7 Crear Depósito / Pañol de Obra vinculado:
  -- Si ya existe un depósito con ese nombre, verificar que pertenezca exactamente a este proyecto.
  IF p_nombre_deposito IS NOT NULL AND trim(p_nombre_deposito) <> '' THEN
    SELECT project_id INTO v_existing_deposito_proj
    FROM public.depositos
    WHERE empresa_id = p_empresa_id AND nombre = p_nombre_deposito;

    IF v_existing_deposito_proj IS NOT NULL AND v_existing_deposito_proj <> v_project_id THEN
      RAISE EXCEPTION 'Conflicto de pañol: el depósito "%" ya existe y pertenece a otra obra (%)', p_nombre_deposito, v_existing_deposito_proj;
    ELSIF v_existing_deposito_proj IS NULL THEN
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

  -- 3.8 Vincular proceso licitatorio en tabla licitaciones si existe:
  -- SIN EXCEPTION WHEN OTHERS THEN NULL. Si la actualización falla, abortar y revertir toda la transacción.
  IF p_tender_id IS NOT NULL AND trim(p_tender_id) <> '' THEN
    UPDATE public.licitaciones
    SET raw_json = jsonb_set(
      COALESCE(raw_json, '{}'::jsonb),
      '{obra_vinculada}',
      jsonb_build_object(
        'project_id', v_project_id,
        'project_code', p_code,
        'converted_at', timezone('utc'::text, now())
      )
    ),
    updated_at = timezone('utc'::text, now())
    WHERE (id::text = p_tender_id OR dncp_nro = p_tender_id)
      AND empresa_id = p_empresa_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_existed', false,
    'project_id', v_project_id,
    'project_code', p_code
  );
END;
$$;

-- Permisos de ejecución mínimos y seguros
REVOKE ALL ON FUNCTION public.convertir_licitacion_a_proyecto_atomico FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convertir_licitacion_a_proyecto_atomico FROM anon;
GRANT EXECUTE ON FUNCTION public.convertir_licitacion_a_proyecto_atomico TO authenticated;
GRANT EXECUTE ON FUNCTION public.convertir_licitacion_a_proyecto_atomico TO service_role;

COMMENT ON FUNCTION public.convertir_licitacion_a_proyecto_atomico IS 'Transición atómica, idempotente y multi-tenant aislada de Licitación Adjudicada a Proyecto en el ERP (Gate 19)';
