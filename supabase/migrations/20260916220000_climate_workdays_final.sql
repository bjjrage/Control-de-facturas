-- ============================================================================
-- 20260916220000_climate_workdays_final.sql
-- Climate Workdays: contrato climático, jornadas efectivas y evidencia.
-- Forward-only. No modifica migraciones históricas aplicadas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuración contractual por obra
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS precipitation_threshold_mm numeric(8,2) NOT NULL DEFAULT 15
    CHECK (precipitation_threshold_mm >= 0),
  ADD COLUMN IF NOT EXISTS weather_tracking_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weather_station_id text,
  ADD COLUMN IF NOT EXISTS weather_station_name text,
  ADD COLUMN IF NOT EXISTS weather_source text NOT NULL DEFAULT 'dmh-dinac';

-- ---------------------------------------------------------------------------
-- 2. Evento meteorológico normalizado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.climate_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                 uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id                 uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_date                 date NOT NULL,
  source                     text NOT NULL,
  external_station_id        text,
  external_station_name      text,
  external_station_latitude  numeric(9,6),
  external_station_longitude numeric(9,6),
  external_station_distance_km numeric(10,3),
  external_observed_at       timestamptz,
  external_precipitation_mm  numeric(8,2),
  local_precipitation_mm     numeric(8,2),
  contract_threshold_mm      numeric(8,2),
  external_threshold_exceeded boolean NOT NULL DEFAULT false,
  local_threshold_exceeded    boolean NOT NULL DEFAULT false,
  threshold_exceeded          boolean NOT NULL DEFAULT false,
  local_source                text NOT NULL DEFAULT 'LOCAL_RAIN_GAUGE',
  provider_fallback_reason    text,
  raw_source_payload          jsonb,
  status                     text NOT NULL DEFAULT 'OBSERVED'
    CHECK (status IN ('OBSERVED', 'PROPOSED', 'CONFIRMED', 'OVERRIDDEN')),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, event_date),
  CONSTRAINT climate_events_station_coordinates_valid CHECK (
    (external_station_latitude IS NULL AND external_station_longitude IS NULL)
    OR (external_station_latitude BETWEEN -90 AND 90
      AND external_station_longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT climate_events_station_distance_valid CHECK (
    external_station_distance_km IS NULL OR external_station_distance_km >= 0
  ),
  CONSTRAINT climate_events_local_source_valid CHECK (
    local_source IN ('LOCAL_RAIN_GAUGE', 'MANUAL')
  )
);

-- Additive completion for a partially initialized development database.
ALTER TABLE public.climate_events
  ADD COLUMN IF NOT EXISTS external_station_latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS external_station_longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS external_station_distance_km numeric(10,3),
  ADD COLUMN IF NOT EXISTS external_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_threshold_exceeded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS local_threshold_exceeded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS local_source text NOT NULL DEFAULT 'LOCAL_RAIN_GAUGE',
  ADD COLUMN IF NOT EXISTS provider_fallback_reason text;

-- Si una base de desarrollo ya tenía eventos del WIP, conserva la medición
-- local y recalcula la propuesta automática únicamente desde la fuente externa.
UPDATE public.climate_events
SET external_threshold_exceeded = (
      external_precipitation_mm IS NOT NULL
      AND contract_threshold_mm IS NOT NULL
      AND external_precipitation_mm >= contract_threshold_mm
    ),
    local_threshold_exceeded = (
      local_precipitation_mm IS NOT NULL
      AND contract_threshold_mm IS NOT NULL
      AND local_precipitation_mm >= contract_threshold_mm
    ),
    threshold_exceeded = (
      external_precipitation_mm IS NOT NULL
      AND contract_threshold_mm IS NOT NULL
      AND external_precipitation_mm >= contract_threshold_mm
    )
WHERE true;

CREATE INDEX IF NOT EXISTS idx_climate_events_empresa_project_date
  ON public.climate_events(empresa_id, project_id, event_date DESC);

-- ---------------------------------------------------------------------------
-- 3. Estado efectivo de la jornada
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
  CONSTRAINT project_workday_effect_has_parent CHECK (
    classification <> 'NON_WORKABLE_RAIN_EFFECT' OR parent_workday_status_id IS NOT NULL
  ),
  CONSTRAINT project_workday_effect_confirmed CHECK (
    classification <> 'NON_WORKABLE_RAIN_EFFECT' OR decision_status = 'CONFIRMED'
  ),
  CONSTRAINT project_workday_confirmed_has_timestamp CHECK (
    decision_status <> 'CONFIRMED' OR confirmed_at IS NOT NULL OR source = 'SYSTEM'
  )
);

CREATE INDEX IF NOT EXISTS idx_project_workday_status_empresa_project_date
  ON public.project_workday_status(empresa_id, project_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_project_workday_status_climate_event
  ON public.project_workday_status(climate_event_id);
CREATE INDEX IF NOT EXISTS idx_project_workday_status_parent
  ON public.project_workday_status(parent_workday_status_id);

-- ---------------------------------------------------------------------------
-- 4. Evidencia climática ligada a un evento o jornada
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
  CONSTRAINT climate_evidence_has_parent CHECK (
    climate_event_id IS NOT NULL OR workday_status_id IS NOT NULL
  ),
  CONSTRAINT climate_evidence_physical_reference CHECK (
    evidence_type IN ('RESIDENT_NOTE', 'WEATHER_SOURCE') OR storage_path IS NOT NULL
  ),
  CONSTRAINT climate_evidence_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_climate_evidence_empresa_project_created
  ON public.climate_evidence(empresa_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_climate_evidence_event
  ON public.climate_evidence(climate_event_id);
CREATE INDEX IF NOT EXISTS idx_climate_evidence_workday
  ON public.climate_evidence(workday_status_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_climate_evidence_project_storage_path
  ON public.climate_evidence(project_id, storage_path)
  WHERE storage_path IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Integridad de tenant, causalidad y append-only de evidencia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_climate_event_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  SELECT empresa_id INTO v_empresa_id
  FROM public.projects
  WHERE id = NEW.project_id;

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
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_event_project uuid;
  v_parent_project uuid;
  v_parent_date date;
  v_parent_classification text;
  v_parent_decision_status text;
  v_parent_event uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM public.project_workday_status
    WHERE parent_workday_status_id = OLD.id
      AND (
        OLD.project_id IS DISTINCT FROM NEW.project_id
        OR OLD.work_date IS DISTINCT FROM NEW.work_date
        OR OLD.classification IS DISTINCT FROM NEW.classification
        OR OLD.decision_status IS DISTINCT FROM NEW.decision_status
        OR OLD.climate_event_id IS DISTINCT FROM NEW.climate_event_id
      )
  ) THEN
    RAISE EXCEPTION 'La jornada causal no puede cambiar mientras tenga efectos vinculados.';
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.projects
  WHERE id = NEW.project_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Proyecto % no encontrado.', NEW.project_id;
  END IF;
  IF NEW.empresa_id IS NOT NULL AND NEW.empresa_id IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'La jornada no pertenece a la empresa del proyecto.';
  END IF;

  IF NEW.climate_event_id IS NOT NULL THEN
    SELECT project_id INTO v_event_project
    FROM public.climate_events
    WHERE id = NEW.climate_event_id;
    IF v_event_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'El evento climático no pertenece al proyecto de la jornada.';
    END IF;
  END IF;

  IF NEW.parent_workday_status_id IS NOT NULL THEN
    SELECT project_id, work_date, classification, decision_status, climate_event_id
      INTO v_parent_project, v_parent_date, v_parent_classification,
           v_parent_decision_status, v_parent_event
    FROM public.project_workday_status
    WHERE id = NEW.parent_workday_status_id;

    IF v_parent_project IS DISTINCT FROM NEW.project_id
      OR v_parent_date IS NULL
      OR v_parent_date >= NEW.work_date
      OR v_parent_classification IS DISTINCT FROM 'NON_WORKABLE_RAIN'
      OR v_parent_decision_status IS DISTINCT FROM 'CONFIRMED'
      OR v_parent_event IS NULL
      OR NEW.climate_event_id IS DISTINCT FROM v_parent_event THEN
      RAISE EXCEPTION 'La jornada causal debe ser una lluvia confirmada anterior del mismo proyecto.';
    END IF;
  END IF;

  NEW.empresa_id := v_empresa_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_climate_evidence_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_event_project uuid;
  v_workday_project uuid;
BEGIN
  IF NEW.climate_event_id IS NULL AND NEW.workday_status_id IS NULL THEN
    RAISE EXCEPTION 'La evidencia debe vincularse a un evento o a una jornada.';
  END IF;

  SELECT empresa_id INTO v_empresa_id
  FROM public.projects
  WHERE id = NEW.project_id;
  IF v_empresa_id IS NULL OR (NEW.empresa_id IS NOT NULL AND NEW.empresa_id IS DISTINCT FROM v_empresa_id) THEN
    RAISE EXCEPTION 'La evidencia no pertenece a la empresa del proyecto.';
  END IF;

  IF NEW.climate_event_id IS NOT NULL THEN
    SELECT project_id INTO v_event_project
    FROM public.climate_events
    WHERE id = NEW.climate_event_id;
    IF v_event_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'El evento de la evidencia no pertenece al proyecto.';
    END IF;
  END IF;
  IF NEW.workday_status_id IS NOT NULL THEN
    SELECT project_id INTO v_workday_project
    FROM public.project_workday_status
    WHERE id = NEW.workday_status_id;
    IF v_workday_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'La jornada de la evidencia no pertenece al proyecto.';
    END IF;
  END IF;

  NEW.empresa_id := v_empresa_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_climate_event_relation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.project_workday_status
    WHERE climate_event_id = OLD.id
  ) AND (
    OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.event_date IS DISTINCT FROM NEW.event_date
  ) THEN
    RAISE EXCEPTION 'El evento climático no puede reasignarse mientras tenga una jornada vinculada.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_climate_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La evidencia climática es inmutable y no admite eliminación física.';
  END IF;
  IF OLD.empresa_id IS DISTINCT FROM NEW.empresa_id
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.climate_event_id IS DISTINCT FROM NEW.climate_event_id
    OR OLD.workday_status_id IS DISTINCT FROM NEW.workday_status_id
    OR OLD.evidence_type IS DISTINCT FROM NEW.evidence_type
    OR OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket
    OR OLD.storage_path IS DISTINCT FROM NEW.storage_path THEN
    RAISE EXCEPTION 'La evidencia climática no puede reasignarse ni cambiar su referencia física.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_climate_events_tenant ON public.climate_events;
CREATE TRIGGER trg_climate_events_tenant
  BEFORE INSERT OR UPDATE ON public.climate_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_climate_event_tenant();

DROP TRIGGER IF EXISTS trg_climate_events_relation_mutation ON public.climate_events;
CREATE TRIGGER trg_climate_events_relation_mutation
  BEFORE UPDATE ON public.climate_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_climate_event_relation_mutation();

DROP TRIGGER IF EXISTS trg_climate_events_updated_at ON public.climate_events;
CREATE TRIGGER trg_climate_events_updated_at
  BEFORE UPDATE ON public.climate_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_project_workday_status_tenant ON public.project_workday_status;
CREATE TRIGGER trg_project_workday_status_tenant
  BEFORE INSERT OR UPDATE ON public.project_workday_status
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_workday_tenant();

DROP TRIGGER IF EXISTS trg_project_workday_status_updated_at ON public.project_workday_status;
CREATE TRIGGER trg_project_workday_status_updated_at
  BEFORE UPDATE ON public.project_workday_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_climate_evidence_tenant ON public.climate_evidence;
CREATE TRIGGER trg_climate_evidence_tenant
  BEFORE INSERT OR UPDATE ON public.climate_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_climate_evidence_tenant();

DROP TRIGGER IF EXISTS trg_climate_evidence_mutation ON public.climate_evidence;
CREATE TRIGGER trg_climate_evidence_mutation
  BEFORE UPDATE OR DELETE ON public.climate_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_climate_evidence_mutation();

-- ---------------------------------------------------------------------------
-- 6. RLS y privilegios explícitos
-- ---------------------------------------------------------------------------
ALTER TABLE public.climate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_workday_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.climate_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS climate_events_select ON public.climate_events;
DROP POLICY IF EXISTS climate_events_insert ON public.climate_events;
DROP POLICY IF EXISTS climate_events_update ON public.climate_events;
DROP POLICY IF EXISTS climate_events_delete ON public.climate_events;
CREATE POLICY climate_events_select ON public.climate_events
  FOR SELECT TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY climate_events_insert ON public.climate_events
  FOR INSERT TO authenticated WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY climate_events_update ON public.climate_events
  FOR UPDATE TO authenticated
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY climate_events_delete ON public.climate_events
  FOR DELETE TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['admin']::public.user_role[])
  );

DROP POLICY IF EXISTS project_workday_status_select ON public.project_workday_status;
DROP POLICY IF EXISTS project_workday_status_insert ON public.project_workday_status;
DROP POLICY IF EXISTS project_workday_status_update ON public.project_workday_status;
DROP POLICY IF EXISTS project_workday_status_delete ON public.project_workday_status;
CREATE POLICY project_workday_status_select ON public.project_workday_status
  FOR SELECT TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY project_workday_status_insert ON public.project_workday_status
  FOR INSERT TO authenticated WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY project_workday_status_update ON public.project_workday_status
  FOR UPDATE TO authenticated
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY project_workday_status_delete ON public.project_workday_status
  FOR DELETE TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['admin']::public.user_role[])
  );

DROP POLICY IF EXISTS climate_evidence_select ON public.climate_evidence;
DROP POLICY IF EXISTS climate_evidence_insert ON public.climate_evidence;
DROP POLICY IF EXISTS climate_evidence_update ON public.climate_evidence;
DROP POLICY IF EXISTS climate_evidence_delete ON public.climate_evidence;
CREATE POLICY climate_evidence_select ON public.climate_evidence
  FOR SELECT TO authenticated USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY climate_evidence_insert ON public.climate_evidence
  FOR INSERT TO authenticated WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

REVOKE ALL ON TABLE public.climate_events FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.project_workday_status FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.climate_evidence FROM anon, PUBLIC;
REVOKE ALL ON TABLE public.climate_events FROM authenticated;
REVOKE ALL ON TABLE public.project_workday_status FROM authenticated;
REVOKE ALL ON TABLE public.climate_evidence FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.climate_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_workday_status TO authenticated;
GRANT SELECT, INSERT ON TABLE public.climate_evidence TO authenticated;
GRANT ALL ON TABLE public.climate_events, public.project_workday_status, public.climate_evidence TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.climate_evidence FROM authenticated;

-- El bucket existente se mantiene; solamente se reserva el prefijo /climate.
DROP POLICY IF EXISTS exec_photos_delete ON storage.objects;
CREATE POLICY exec_photos_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'execution-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.projects
      WHERE empresa_id = public.current_empresa_id()
    )
    AND (storage.foldername(name))[2] IS DISTINCT FROM 'climate'
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );

-- ---------------------------------------------------------------------------
-- 7. Métricas climáticas persistidas junto al snapshot de forecast
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_progress_forecast_runs
  ADD COLUMN IF NOT EXISTS calendar_days_elapsed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workable_days_elapsed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rain_lost_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rain_effect_lost_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_lost_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_available_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_schedule_variance numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weather_adjusted_variance numeric(10,2) NOT NULL DEFAULT 0;
