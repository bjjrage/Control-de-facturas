-- ============================================================================
-- 0083_weekly_plans_hardening_and_canonical_oc.sql
-- 1. Multi-frente: Eliminar restricción UNIQUE(plan_id, budget_item_id) y
--    reemplazarla con índice único sobre (plan_id, budget_item_id, coalesce(front_label, ''))
-- 2. Identidad canónica de producto en OC:
--    Agregar authorized_order_items.producto_id REFERENCES productos(id)
-- 3. Requisito explícito de materiales en budget_items:
--    Agregar material_requirement TEXT CHECK (material_requirement IN ('REQUIRES_BOM', 'NO_MATERIAL', 'UNKNOWN'))
-- 4. Función atómica RPC save_weekly_plan_atomic(...)
-- ============================================================================

-- 1. Multi-frente en project_weekly_plan_items
ALTER TABLE public.project_weekly_plan_items
  DROP CONSTRAINT IF EXISTS project_weekly_plan_items_plan_id_budget_item_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_plan_items_multi_front
  ON public.project_weekly_plan_items(plan_id, budget_item_id, (coalesce(trim(front_label), '')));

-- 2. Identidad canónica de producto en authorized_order_items
ALTER TABLE public.authorized_order_items
  ADD COLUMN IF NOT EXISTS producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_authorized_order_items_producto
  ON public.authorized_order_items(producto_id);

-- 3. Requisito de BOM explícito en budget_items
ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS material_requirement TEXT DEFAULT 'UNKNOWN'
  CHECK (material_requirement IN ('REQUIRES_BOM', 'NO_MATERIAL', 'UNKNOWN'));

CREATE INDEX IF NOT EXISTS idx_budget_items_mat_req
  ON public.budget_items(project_id, material_requirement);

-- 4. Función RPC atómica para persistencia del Plan Semanal
CREATE OR REPLACE FUNCTION public.save_weekly_plan_atomic(
  p_plan_id UUID,
  p_project_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_status TEXT,
  p_notes TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID;
  v_plan_id UUID;
  v_item JSONB;
  v_budget_item_id UUID;
  v_front_label TEXT;
  v_input_mode TEXT;
  v_input_value NUMERIC;
  v_unit TEXT;
  v_exists BOOLEAN;
BEGIN
  -- Validar empresa_id del invocador o del proyecto (fallback para llamadas directas/service)
  v_empresa_id := coalesce(public.current_empresa_id(), (SELECT empresa_id FROM public.projects WHERE id = p_project_id));
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar la empresa del usuario autenticado.';
  END IF;

  -- Validar pertenencia del proyecto a la empresa
  SELECT EXISTS(
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND empresa_id = v_empresa_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Proyecto % no encontrado o no pertenece a la empresa.', p_project_id;
  END IF;

  -- Validar fechas
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'La fecha de fin (%) no puede ser anterior a la de inicio (%).', p_end_date, p_start_date;
  END IF;

  -- Validar o crear plan
  IF p_plan_id IS NOT NULL THEN
    SELECT id INTO v_plan_id
    FROM public.project_weekly_plans
    WHERE id = p_plan_id AND empresa_id = v_empresa_id;

    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan semanal % no encontrado o sin permisos.', p_plan_id;
    END IF;

    UPDATE public.project_weekly_plans
    SET start_date = p_start_date,
        end_date = p_end_date,
        status = p_status,
        notes = p_notes,
        updated_at = now()
    WHERE id = v_plan_id;
  ELSE
    INSERT INTO public.project_weekly_plans (
      empresa_id,
      project_id,
      start_date,
      end_date,
      status,
      notes,
      created_by
    ) VALUES (
      v_empresa_id,
      p_project_id,
      p_start_date,
      p_end_date,
      p_status,
      p_notes,
      auth.uid()
    ) RETURNING id INTO v_plan_id;
  END IF;

  -- Eliminar items actuales del plan dentro de la misma transacción
  DELETE FROM public.project_weekly_plan_items
  WHERE plan_id = v_plan_id;

  -- Insertar items del jsonb p_items
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_budget_item_id := (v_item->>'budget_item_id')::UUID;
      v_front_label := NULLIF(trim(v_item->>'front_label'), '');
      v_input_mode := v_item->>'input_mode';
      v_input_value := (v_item->>'input_value')::NUMERIC;
      v_unit := coalesce(v_item->>'unit', 'unid');

      -- Validar que el budget_item pertenece a este proyecto
      IF NOT EXISTS (
        SELECT 1 FROM public.budget_items
        WHERE id = v_budget_item_id AND project_id = p_project_id
      ) THEN
        RAISE EXCEPTION 'La partida % no pertenece al proyecto %.', v_budget_item_id, p_project_id;
      END IF;

      -- Validar input_mode
      IF v_input_mode NOT IN ('QUANTITY', 'CONTRACT_PERCENTAGE_POINTS') THEN
        RAISE EXCEPTION 'Modo de entrada inválido: %', v_input_mode;
      END IF;

      -- Validar input_value
      IF v_input_value < 0 THEN
        RAISE EXCEPTION 'El valor de meta no puede ser negativo: %', v_input_value;
      END IF;

      IF v_input_value > 0 THEN
        INSERT INTO public.project_weekly_plan_items (
          plan_id,
          budget_item_id,
          front_label,
          input_mode,
          input_value,
          target_quantity,
          unit
        ) VALUES (
          v_plan_id,
          v_budget_item_id,
          v_front_label,
          v_input_mode,
          v_input_value,
          v_input_value,
          v_unit
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'plan_id', v_plan_id,
    'status', 'SUCCESS'
  );
END;
$$;
