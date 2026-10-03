-- ============================================================================
-- 0085_weather_forecast_batches_and_snapshot_immutability.sql
-- 1. Crear tabla public.project_weather_forecast_batches
--    Representa cada consulta meteorológica (ej. llamada a Open-Meteo para 7 días).
-- 2. Modificar public.project_weather_forecast_snapshots:
--    - Agregar batch_id UUID NOT NULL REFERENCES public.project_weather_forecast_batches(id) ON DELETE CASCADE
--    - Eliminar restricción destructiva UNIQUE(project_id, forecast_date)
--    - Agregar restricción inmutable UNIQUE(batch_id, forecast_date)
--    - Agregar índices para performance y auditoría
-- 3. Asegurar FK en project_weekly_plans:
--    - FOREIGN KEY (weather_snapshot_batch_id) REFERENCES public.project_weather_forecast_batches(id) ON DELETE SET NULL
-- 4. Habilitar RLS en public.project_weather_forecast_batches
-- ============================================================================

-- 1. Crear tabla de batches meteorológicos
CREATE TABLE IF NOT EXISTS public.project_weather_forecast_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'open-meteo',
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    forecast_days INTEGER NOT NULL DEFAULT 7,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_batches_project_created
  ON public.project_weather_forecast_batches(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_weather_batches_empresa
  ON public.project_weather_forecast_batches(empresa_id);

-- RLS en project_weather_forecast_batches
ALTER TABLE public.project_weather_forecast_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weather_forecast_batches_empresa_isolation" ON public.project_weather_forecast_batches;
CREATE POLICY "weather_forecast_batches_empresa_isolation"
  ON public.project_weather_forecast_batches
  FOR ALL
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());

-- 2. Actualizar project_weather_forecast_snapshots
-- Eliminar restricción única destructiva (project_id, forecast_date)
ALTER TABLE public.project_weather_forecast_snapshots
  DROP CONSTRAINT IF EXISTS project_weather_forecast_snapshots_project_id_forecast_date_key;

-- Agregar columna batch_id
ALTER TABLE public.project_weather_forecast_snapshots
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.project_weather_forecast_batches(id) ON DELETE CASCADE;

-- Si existían snapshots huérfanos previos, asociarles un batch legacy para mantener consistencia
DO $$
DECLARE
  v_rec RECORD;
  v_legacy_batch_id UUID;
BEGIN
  FOR v_rec IN (
    SELECT DISTINCT empresa_id, project_id
    FROM public.project_weather_forecast_snapshots
    WHERE batch_id IS NULL
  ) LOOP
    INSERT INTO public.project_weather_forecast_batches (
      empresa_id, project_id, source, fetched_at
    ) VALUES (
      v_rec.empresa_id, v_rec.project_id, 'open-meteo-legacy', now()
    ) RETURNING id INTO v_legacy_batch_id;

    UPDATE public.project_weather_forecast_snapshots
    SET batch_id = v_legacy_batch_id
    WHERE project_id = v_rec.project_id AND batch_id IS NULL;
  END LOOP;
END;
$$;

-- Restricción UNIQUE inmutable por batch y fecha
CREATE UNIQUE INDEX IF NOT EXISTS idx_weather_snapshots_batch_date
  ON public.project_weather_forecast_snapshots(batch_id, forecast_date);

CREATE INDEX IF NOT EXISTS idx_weather_snapshots_batch
  ON public.project_weather_forecast_snapshots(batch_id);

CREATE INDEX IF NOT EXISTS idx_weather_snapshots_proj_created
  ON public.project_weather_forecast_snapshots(project_id, created_at DESC);

-- 3. Vincular formalmente project_weekly_plans.weather_snapshot_batch_id con FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_weekly_plans_weather_batch'
  ) THEN
    -- Limpiar valores huérfanos que no coincidan con un batch existente antes de crear FK
    UPDATE public.project_weekly_plans
    SET weather_snapshot_batch_id = NULL
    WHERE weather_snapshot_batch_id IS NOT NULL
      AND weather_snapshot_batch_id NOT IN (SELECT id FROM public.project_weather_forecast_batches);

    ALTER TABLE public.project_weekly_plans
      ADD CONSTRAINT fk_weekly_plans_weather_batch
      FOREIGN KEY (weather_snapshot_batch_id)
      REFERENCES public.project_weather_forecast_batches(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- 4. Actualizar save_weekly_plan_atomic para que maneje de forma segura tmp_item_budget_tracking
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
  -- Validar empresa_id del invocador: FAIL-CLOSED estricto (no fallback)
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

  -- Asegurar limpieza de tabla temporal en llamadas repetidas dentro de la misma transacción
  DROP TABLE IF EXISTS tmp_item_budget_tracking;
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

REVOKE ALL ON FUNCTION public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_weekly_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID) TO authenticated, service_role;

