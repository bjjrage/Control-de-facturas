-- ============================================================================
-- 0086_weather_snapshots_append_only_and_restrict_fk.sql
-- 1. Enforce batch_id NOT NULL on project_weather_forecast_snapshots
-- 2. Modify FK project_weekly_plans.weather_snapshot_batch_id -> ON DELETE RESTRICT
-- 3. Strict Append-Only RLS on project_weather_forecast_batches and project_weather_forecast_snapshots
--    - authenticated: SELECT (own tenant), INSERT (own tenant)
--    - NO UPDATE, NO DELETE, NO TRUNCATE policies for authenticated or anon
-- ============================================================================

-- 1. Enforce batch_id NOT NULL on project_weather_forecast_snapshots
ALTER TABLE public.project_weather_forecast_snapshots
  ALTER COLUMN batch_id SET NOT NULL;

-- 2. Modify FK on project_weekly_plans: ON DELETE RESTRICT
ALTER TABLE public.project_weekly_plans
  DROP CONSTRAINT IF EXISTS fk_weekly_plans_weather_batch;

ALTER TABLE public.project_weekly_plans
  ADD CONSTRAINT fk_weekly_plans_weather_batch
  FOREIGN KEY (weather_snapshot_batch_id)
  REFERENCES public.project_weather_forecast_batches(id)
  ON DELETE RESTRICT;

-- 3. Strict Append-Only RLS on project_weather_forecast_batches
DROP POLICY IF EXISTS "weather_forecast_batches_empresa_isolation" ON public.project_weather_forecast_batches;
DROP POLICY IF EXISTS "weather_batches_select_own_empresa" ON public.project_weather_forecast_batches;
DROP POLICY IF EXISTS "weather_batches_insert_own_empresa" ON public.project_weather_forecast_batches;

CREATE POLICY "weather_batches_select_own_empresa"
  ON public.project_weather_forecast_batches
  FOR SELECT
  TO authenticated
  USING (empresa_id = public.current_empresa_id());

CREATE POLICY "weather_batches_insert_own_empresa"
  ON public.project_weather_forecast_batches
  FOR INSERT
  TO authenticated
  WITH CHECK (empresa_id = public.current_empresa_id());

-- 4. Strict Append-Only RLS on project_weather_forecast_snapshots
DROP POLICY IF EXISTS "weather_forecast_snapshots_empresa_isolation" ON public.project_weather_forecast_snapshots;
DROP POLICY IF EXISTS "weather_snapshots_select_own_empresa" ON public.project_weather_forecast_snapshots;
DROP POLICY IF EXISTS "weather_snapshots_insert_own_empresa" ON public.project_weather_forecast_snapshots;

CREATE POLICY "weather_snapshots_select_own_empresa"
  ON public.project_weather_forecast_snapshots
  FOR SELECT
  TO authenticated
  USING (empresa_id = public.current_empresa_id());

CREATE POLICY "weather_snapshots_insert_own_empresa"
  ON public.project_weather_forecast_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (empresa_id = public.current_empresa_id());
