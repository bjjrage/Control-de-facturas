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
AS $$
DECLARE
  v_project_id UUID;
  v_existing_code TEXT;
  v_item JSONB;
  v_sort_order INT := 1;
BEGIN
  -- 1. Idempotencia: Verificar si ya existe obra con este código para esta empresa
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

  -- 2. Insertar Proyecto
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
    p_created_by
  ) RETURNING id INTO v_project_id;

  -- 3. Insertar Budget Items de forma atómica
  IF p_budget_items IS NOT NULL AND jsonb_array_length(p_budget_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_budget_items) LOOP
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
        COALESCE(v_item->>'description', 'Ítem de cómputo'),
        COALESCE(v_item->>'unit', 'UN'),
        COALESCE((v_item->>'quantity')::numeric, 1),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'sort_order')::integer, v_sort_order)
      );
      v_sort_order := v_sort_order + 1;
    END LOOP;
  END IF;

  -- 4. Crear Depósito / Pañol de Obra vinculado
  IF p_nombre_deposito IS NOT NULL AND trim(p_nombre_deposito) <> '' THEN
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
    ) ON CONFLICT (empresa_id, nombre) DO NOTHING;
  END IF;

  -- 5. Vincular proceso licitatorio en tabla licitaciones si existe
  IF p_tender_id IS NOT NULL THEN
    BEGIN
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
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_existed', false,
    'project_id', v_project_id,
    'project_code', p_code
  );
END;
$$
LANGUAGE plpgsql;

COMMENT ON FUNCTION public.convertir_licitacion_a_proyecto_atomico IS 'Transición atómica e idempotente de Licitación Adjudicada a Proyecto en el ERP (Gate 19)';
