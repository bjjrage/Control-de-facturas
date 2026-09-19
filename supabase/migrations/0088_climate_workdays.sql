-- ============================================================================
-- 0088_climate_workdays.sql
-- Jornadas afectadas por lluvia, evidencia climática y trazabilidad contractual.
--
-- La meteorología, la evidencia y la decisión operativa son entidades distintas:
-- un proveedor puede proponer una jornada, pero nunca reemplaza una decisión
-- confirmada por el residente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuración climática contractual por obra
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS precipitation_threshold_mm numeric(8,2) NOT NULL DEFAULT 15
    CHECK (precipitation_threshold_mm >= 0),
  ADD COLUMN IF NOT EXISTS weather_tracking_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weather_station_id text,
  ADD COLUMN IF NOT EXISTS weather_station_name text,
  ADD COLUMN IF NOT EXISTS weather_source text NOT NULL DEFAULT 'open-meteo';

-- ---------------------------------------------------------------------------
-- 2. Fenómeno meteorológico normalizado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.climate_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                 uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id                 uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_date                 date NOT NULL,
  source                     text NOT NULL,
  external_station_id        text,
  external_station_name      text,
  external_precipitation_mm  numeric(8,2),
  local_precipitation_mm     numeric(8,2),
  contract_threshold_mm      numeric(8,2),
  threshold_exceeded         boolean NOT NULL DEFAULT false,
  raw_source_payload         jsonb,
  status                     text NOT NULL DEFAULT 'OBSERVED'
    CHECK (status IN ('OBSERVED', 'PROPOSED', 'CONFIRMED', 'OVERRIDDEN')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_climate_events_empresa_project_date
  ON public.climate_events(empresa_id, project_id, event_date DESC);

-- ---------------------------------------------------------------------------
-- 3. Clasificación efectiva de cada jornada
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_workday_status (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                 uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id                 uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_date                  date NOT NULL,
  classification              text NOT NULL
    CHECK (classification IN ('WORKABLE', 'NON_WORKABLE_RAIN', 'NON_WORKABLE_RAIN_EFFECT', 'NON_WORKABLE_OTHER')),
  climate_event_id           uuid REFERENCES public.climate_events(id) ON DELETE RESTRICT,
  parent_workday_status_id   uuid REFERENCES public.project_workday_status(id) ON DELETE RESTRICT,
  reason_code                text
    CHECK (reason_code IS NULL OR reason_code IN (
      'TERRAIN_SATURATED', 'ACCESS_BLOCKED', 'FLOODED_EXCAVATION',
      'UNSAFE_CONDITIONS', 'MATERIAL_IMPACT', 'OTHER'
    )),
  notes                      text,
  source                     text NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('AUTOMATIC', 'MANUAL', 'RESIDENT', 'SYSTEM')),
  decision_status            text NOT NULL DEFAULT 'CONFIRMED'
    CHECK (decision_status IN ('PROPOSED', 'CONFIRMED')),
  proposed_automatically     boolean NOT NULL DEFAULT false,
  confirmed_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, work_date),
  CHECK (classification <> 'NON_WORKABLE_RAIN_EFFECT' OR parent_workday_status_id IS NOT NULL),
  CHECK (decision_status <> 'CONFIRMED' OR confirmed_at IS NOT NULL OR source = 'SYSTEM')
);

CREATE INDEX IF NOT EXISTS idx_project_workday_status_empresa_project_date
  ON public.project_workday_status(empresa_id, project_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_workday_status_climate_event
  ON public.project_workday_status(climate_event_id);
CREATE INDEX IF NOT EXISTS idx_project_workday_status_parent
  ON public.project_workday_status(parent_workday_status_id);

-- ---------------------------------------------------------------------------
-- 4. Evidencia verificable, reutilizando Storage existente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.climate_evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  climate_event_id    uuid REFERENCES public.climate_events(id) ON DELETE RESTRICT,
  workday_status_id   uuid REFERENCES public.project_workday_status(id) ON DELETE RESTRICT,
  evidence_type       text NOT NULL CHECK (evidence_type IN (
    'RAIN_GAUGE_PHOTO', 'SITE_CONDITION_PHOTO', 'WEATHER_SOURCE',
    'RESIDENT_NOTE', 'OTHER'
  )),
  storage_bucket      text,
  storage_path        text,
  file_name           text,
  mime_type           text,
  size_bytes          bigint,
  captured_at         timestamptz,
  uploaded_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (climate_event_id IS NOT NULL OR workday_status_id IS NOT NULL),
  CHECK (storage_path IS NOT NULL OR evidence_type = 'RESIDENT_NOTE' OR jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_climate_evidence_empresa_project_created
  ON public.climate_evidence(empresa_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_climate_evidence_event
  ON public.climate_evidence(climate_event_id);
CREATE INDEX IF NOT EXISTS idx_climate_evidence_workday
  ON public.climate_evidence(workday_status_id);

-- ---------------------------------------------------------------------------
-- 5. Invariantes de tenant y relaciones entre entidades
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_climate_event_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM public.projects WHERE id = NEW.project_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Proyecto % no encontrado.', NEW.project_id;
  END IF;
  IF NEW.empresa_id IS NOT NULL AND NEW.empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'El evento climático no pertenece a la empresa del proyecto.';
  END IF;
  NEW.empresa_id := v_empresa_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_project_workday_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_empresa_id uuid;
  v_event_project uuid;
  v_parent_project uuid;
  v_parent_date date;
BEGIN
  SELECT empresa_id INTO v_empresa_id FROM public.projects WHERE id = NEW.project_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Proyecto % no encontrado.', NEW.project_id;
  END IF;
  IF NEW.empresa_id IS NOT NULL AND NEW.empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'La jornada no pertenece a la empresa del proyecto.';
  END IF;

  IF NEW.climate_event_id IS NOT NULL THEN
    SELECT project_id INTO v_event_project FROM public.climate_events WHERE id = NEW.climate_event_id;
    IF v_event_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'El evento climático no pertenece al proyecto de la jornada.';
    END IF;
  END IF;

  IF NEW.parent_workday_status_id IS NOT NULL THEN
    SELECT project_id, work_date
      INTO v_parent_project, v_parent_date
      FROM public.project_workday_status
      WHERE id = NEW.parent_workday_status_id;
    IF v_parent_project IS DISTINCT FROM NEW.project_id OR v_parent_date IS NULL THEN
      RAISE EXCEPTION 'La jornada causal no pertenece al mismo proyecto.';
    END IF;
    IF v_parent_date >= NEW.work_date THEN
      RAISE EXCEPTION 'La jornada causal debe ser anterior a la jornada afectada.';
    END IF;
  END IF;

  NEW.empresa_id := v_empresa_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_climate_evidence_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_empresa_id uuid;
  v_event_project uuid;
  v_workday_project uuid;
BEGIN
  IF NEW.climate_event_id IS NULL AND NEW.workday_status_id IS NULL THEN
    RAISE EXCEPTION 'La evidencia debe vincularse a un evento o a una jornada.';
  END IF;

  SELECT empresa_id INTO v_empresa_id FROM public.projects WHERE id = NEW.project_id;
  IF v_empresa_id IS NULL OR (NEW.empresa_id IS NOT NULL AND NEW.empresa_id IS DISTINCT FROM v_empresa_id) THEN
    RAISE EXCEPTION 'La evidencia no pertenece a la empresa del proyecto.';
  END IF;

  IF NEW.climate_event_id IS NOT NULL THEN
    SELECT project_id INTO v_event_project FROM public.climate_events WHERE id = NEW.climate_event_id;
    IF v_event_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'El evento de la evidencia no pertenece al proyecto.';
    END IF;
  END IF;
  IF NEW.workday_status_id IS NOT NULL THEN
    SELECT project_id INTO v_workday_project FROM public.project_workday_status WHERE id = NEW.workday_status_id;
    IF v_workday_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'La jornada de la evidencia no pertenece al proyecto.';
    END IF;
  END IF;

  NEW.empresa_id := v_empresa_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_climate_events_tenant ON public.climate_events;
CREATE TRIGGER trg_climate_events_tenant
  BEFORE INSERT OR UPDATE ON public.climate_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_climate_event_tenant();

DROP TRIGGER IF EXISTS trg_project_workday_status_tenant ON public.project_workday_status;
CREATE TRIGGER trg_project_workday_status_tenant
  BEFORE INSERT OR UPDATE ON public.project_workday_status
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_workday_tenant();

DROP TRIGGER IF EXISTS trg_climate_evidence_tenant ON public.climate_evidence;
CREATE TRIGGER trg_climate_evidence_tenant
  BEFORE INSERT OR UPDATE ON public.climate_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_climate_evidence_tenant();

DROP TRIGGER IF EXISTS trg_climate_events_updated_at ON public.climate_events;
CREATE TRIGGER trg_climate_events_updated_at
  BEFORE UPDATE ON public.climate_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_project_workday_status_updated_at ON public.project_workday_status;
CREATE TRIGGER trg_project_workday_status_updated_at
  BEFORE UPDATE ON public.project_workday_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS: fail-closed y scoped por empresa + proyecto
-- ---------------------------------------------------------------------------
ALTER TABLE public.climate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_workday_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.climate_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY climate_events_select ON public.climate_events
  FOR SELECT TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_events_insert ON public.climate_events
  FOR INSERT TO authenticated WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_events_update ON public.climate_events
  FOR UPDATE TO authenticated
  USING (empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_events_delete ON public.climate_events
  FOR DELETE TO authenticated USING (
    empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY project_workday_status_select ON public.project_workday_status
  FOR SELECT TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY project_workday_status_insert ON public.project_workday_status
  FOR INSERT TO authenticated WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY project_workday_status_update ON public.project_workday_status
  FOR UPDATE TO authenticated
  USING (empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY project_workday_status_delete ON public.project_workday_status
  FOR DELETE TO authenticated USING (
    empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY climate_evidence_select ON public.climate_evidence
  FOR SELECT TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_evidence_insert ON public.climate_evidence
  FOR INSERT TO authenticated WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_evidence_update ON public.climate_evidence
  FOR UPDATE TO authenticated
  USING (empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_evidence_delete ON public.climate_evidence
  FOR DELETE TO authenticated USING (
    empresa_id = public.current_empresa_id() AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

-- Forecast: métricas derivadas de jornadas climáticas, conservando las corridas
-- históricas y haciendo explícito el impacto climático en cada snapshot.
ALTER TABLE public.project_progress_forecast_runs
  ADD COLUMN IF NOT EXISTS calendar_days_elapsed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workable_days_elapsed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rain_lost_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rain_effect_lost_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_lost_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_available_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_schedule_variance numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weather_adjusted_variance numeric(10,2) NOT NULL DEFAULT 0;
