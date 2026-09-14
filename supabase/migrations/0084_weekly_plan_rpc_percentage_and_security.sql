-- ============================================================================
-- 0084_weekly_plan_rpc_percentage_and_security.sql
-- 1. Vincular corrida/plan con snapshot meteorológico:
--    Agregar weather_snapshot_batch_id a project_weekly_plans
-- 2. Corregir save_weekly_plan_atomic:
--    - Cálculo real de target_quantity en modo CONTRACT_PERCENTAGE_POINTS
--      (contractual_quantity * input_value / 100)
--    - Capping por remaining_quantity (contractual - ejecutado histórico)
--    - Deducción secuencial entre múltiples frentes de la misma partida
--    - Fail-closed tenant isolation vía public.current_empresa_id() estricto
--    - Parámetro opcional p_weather_snapshot_batch_id UUID
-- 3. Privilegios de ejecución mínimos y fail-closed:
--    - REVOKE EXECUTE FROM PUBLIC, anon
--    - GRANT EXECUTE TO authenticated, service_role
-- ============================================================================

-- 1. Agregar weather_snapshot_batch_id a project_weekly_plans
ALTER TABLE public.project_weekly_plans
  ADD COLUMN IF NOT EXISTS weather_snapshot_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_weekly_plans_weather_batch
  ON public.project_weekly_plans(weather_snapshot_batch_id);

-- 2. Eliminar firma anterior de save_weekly_plan_atomic con 7 parámetros para evitar sobrecargas ambiguas
DROP FUNCTION IF EXISTS public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB);

-- 3. Crear save_weekly_plan_atomic con la lógica completa y estricta
CREATE OR REPLACE FUNCTION public.save_weekly_plan_atomic(
  p_plan_id UUID,
  p_project_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_status TEXT,
  p_notes TEXT,
  p_items JSONB,
  p_weather_snapshot_batch_id UUID DEFAULT NULL
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
  v_nominal_qty NUMERIC;
  v_target_qty NUMERIC;
  v_remaining_qty NUMERIC;
  v_unit TEXT;
  v_exists BOOLEAN;
  v_contractual_qty NUMERIC;
  v_executed_qty NUMERIC;
BEGIN
  -- Validar empresa_id del invocador: FAIL-CLOSED estricto (no fallback a SELECT empresa_id FROM projects)
  v_empresa_id := public.current_empresa_id();
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere usuario autenticado con empresa asignada.';
  END IF;

  -- Validar pertenencia del proyecto a la empresa del usuario
  SELECT EXISTS(
    SELECT 1 FROM public.projects
    WHERE id = p_project_id AND empresa_id = v_empresa_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Proyecto % no encontrado o no pertenece a la empresa.', p_project_id;
  END IF;

  -- Validar rango de fechas
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'La fecha de fin (%) no puede ser anterior a la de inicio (%).', p_end_date, p_start_date;
  END IF;

  -- Validar o crear cabecera del plan
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
        weather_snapshot_batch_id = coalesce(p_weather_snapshot_batch_id, weather_snapshot_batch_id),
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
      weather_snapshot_batch_id,
      created_by
    ) VALUES (
      v_empresa_id,
      p_project_id,
      p_start_date,
      p_end_date,
      p_status,
      p_notes,
      p_weather_snapshot_batch_id,
      auth.uid()
    ) RETURNING id INTO v_plan_id;
  END IF;

  -- Tabla temporal para trackear saldo contractual remanente por partida durante el loop de frentes
  CREATE TEMP TABLE tmp_item_budget_tracking (
    budget_item_id UUID PRIMARY KEY,
    contractual_qty NUMERIC,
    executed_qty NUMERIC,
    remaining_qty NUMERIC
  ) ON COMMIT DROP;

  -- Pre-cargar partidas referenciadas en el payload para controlar capping multi-frente
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    INSERT INTO tmp_item_budget_tracking (budget_item_id, contractual_qty, executed_qty, remaining_qty)
    SELECT
      b.id,
      coalesce(b.quantity, 0),
      coalesce(sum(ee.quantity_executed), 0),
      greatest(0, coalesce(b.quantity, 0) - coalesce(sum(ee.quantity_executed), 0))
    FROM (
      SELECT DISTINCT (elem->>'budget_item_id')::UUID AS b_id
      FROM jsonb_array_elements(p_items) elem
      WHERE (elem->>'budget_item_id') IS NOT NULL
    ) raw_ids
    JOIN public.budget_items b ON b.id = raw_ids.b_id AND b.project_id = p_project_id
    LEFT JOIN public.execution_entries ee ON ee.budget_item_id = b.id AND ee.project_id = p_project_id
    GROUP BY b.id, b.quantity
    ON CONFLICT (budget_item_id) DO NOTHING;
  END IF;

  -- Eliminar items actuales del plan dentro de la misma transacción
  DELETE FROM public.project_weekly_plan_items
  WHERE plan_id = v_plan_id;

  -- Insertar items validados y calcular target_quantity contractual
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_budget_item_id := (v_item->>'budget_item_id')::UUID;
      v_front_label := NULLIF(trim(v_item->>'front_label'), '');
      v_input_mode := v_item->>'input_mode';
      v_input_value := (v_item->>'input_value')::NUMERIC;
      v_unit := coalesce(v_item->>'unit', 'unid');

      -- Validar que la partida pertenece a este proyecto
      IF NOT EXISTS (
        SELECT 1 FROM tmp_item_budget_tracking
        WHERE budget_item_id = v_budget_item_id
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
        SELECT contractual_qty, remaining_qty
        INTO v_contractual_qty, v_remaining_qty
        FROM tmp_item_budget_tracking
        WHERE budget_item_id = v_budget_item_id;

        -- Conversión semántica de target_quantity
        IF v_input_mode = 'CONTRACT_PERCENTAGE_POINTS' THEN
          v_nominal_qty := v_contractual_qty * (v_input_value / 100.0);
        ELSE
          v_nominal_qty := v_input_value;
        END IF;

        -- Capping por remanente disponible (para frentes acumulados)
        v_target_qty := greatest(0, least(v_nominal_qty, v_remaining_qty));

        -- Reducir el saldo remanente disponible para siguientes frentes de la misma partida
        UPDATE tmp_item_budget_tracking
        SET remaining_qty = greatest(0, remaining_qty - v_target_qty)
        WHERE budget_item_id = v_budget_item_id;

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
          v_target_qty,
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

-- 4. Configuración estricta de privilegios de ejecución (Principle of Least Privilege)
REVOKE ALL ON FUNCTION public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID) TO authenticated, service_role;
