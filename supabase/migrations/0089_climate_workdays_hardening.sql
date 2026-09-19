-- 0089_climate_workdays_hardening.sql
-- Endurecimiento de la trazabilidad climática y fuente primaria DMH/DINAC.
-- El feed oficial consumido por el adaptador es:
-- https://www.meteorologia.gov.py/emas/data.json

ALTER TABLE public.projects
  ALTER COLUMN weather_source SET DEFAULT 'dmh-dinac';

ALTER TABLE public.climate_events
  ADD COLUMN IF NOT EXISTS external_station_latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS external_station_longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS external_station_distance_km numeric(10,3),
  ADD COLUMN IF NOT EXISTS external_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_threshold_exceeded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS local_threshold_exceeded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS local_source text NOT NULL DEFAULT 'LOCAL_RAIN_GAUGE',
  ADD COLUMN IF NOT EXISTS provider_fallback_reason text;

-- Antes de esta migración threshold_exceeded podía haber sido calculado usando
-- MAX(externa, local). Se corrige la semántica histórica: la propuesta
-- automática solo representa la fuente externa; la lectura local conserva su
-- propio booleano y nunca reemplaza ni gana contra la externa.
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'climate_events_station_coordinates_valid') THEN
    ALTER TABLE public.climate_events
      ADD CONSTRAINT climate_events_station_coordinates_valid CHECK (
        (external_station_latitude IS NULL AND external_station_longitude IS NULL)
        OR (external_station_latitude BETWEEN -90 AND 90 AND external_station_longitude BETWEEN -180 AND 180)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'climate_events_station_distance_valid') THEN
    ALTER TABLE public.climate_events
      ADD CONSTRAINT climate_events_station_distance_valid CHECK (external_station_distance_km IS NULL OR external_station_distance_km >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'climate_events_local_source_valid') THEN
    ALTER TABLE public.climate_events
      ADD CONSTRAINT climate_events_local_source_valid CHECK (local_source IN ('LOCAL_RAIN_GAUGE', 'MANUAL'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_climate_evidence_project_storage_path
  ON public.climate_evidence(project_id, storage_path)
  WHERE storage_path IS NOT NULL;

-- Una jornada de efecto solo puede apuntar a una lluvia confirmada anterior,
-- del mismo proyecto y con evento climático causal. La FK y la fecha estricta
-- impiden huérfanos y ciclos; la validación del trigger impide degradar luego
-- la jornada causal sin resolver los efectos que dependen de ella.
CREATE OR REPLACE FUNCTION public.validate_project_workday_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
    SELECT 1 FROM public.project_workday_status
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
    SELECT project_id, work_date, classification, decision_status, climate_event_id
      INTO v_parent_project, v_parent_date, v_parent_classification, v_parent_decision_status, v_parent_event
      FROM public.project_workday_status
      WHERE id = NEW.parent_workday_status_id;
    IF v_parent_project IS DISTINCT FROM NEW.project_id
      OR v_parent_date IS NULL
      OR v_parent_date >= NEW.work_date
      OR v_parent_classification IS DISTINCT FROM 'NON_WORKABLE_RAIN'
      OR v_parent_decision_status IS DISTINCT FROM 'CONFIRMED'
      OR v_parent_event IS NULL THEN
      RAISE EXCEPTION 'La jornada causal debe ser una lluvia confirmada anterior del mismo proyecto.';
    END IF;
  END IF;

  NEW.empresa_id := v_empresa_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_workday_status_tenant ON public.project_workday_status;
CREATE TRIGGER trg_project_workday_status_tenant
  BEFORE INSERT OR UPDATE ON public.project_workday_status
  FOR EACH ROW EXECUTE FUNCTION public.validate_project_workday_tenant();

CREATE OR REPLACE FUNCTION public.prevent_climate_event_relation_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.project_workday_status WHERE climate_event_id = OLD.id)
    AND (OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.event_date IS DISTINCT FROM NEW.event_date) THEN
    RAISE EXCEPTION 'El evento climático no puede reasignarse mientras tenga una jornada vinculada.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_climate_event_relation_mutation ON public.climate_events;
CREATE TRIGGER trg_climate_event_relation_mutation
  BEFORE UPDATE ON public.climate_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_climate_event_relation_mutation();

-- La evidencia es append-only: se permite completar metadata no causal, pero
-- no cambiar tenant, proyecto, vínculo, tipo o referencia física. Tampoco se
-- permite DELETE, para que la historia contractual no desaparezca sin rastro.
CREATE OR REPLACE FUNCTION public.prevent_climate_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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

DROP TRIGGER IF EXISTS trg_climate_evidence_mutation ON public.climate_evidence;
CREATE TRIGGER trg_climate_evidence_mutation
  BEFORE UPDATE OR DELETE ON public.climate_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_climate_evidence_mutation();

DROP POLICY IF EXISTS climate_evidence_delete ON public.climate_evidence;
REVOKE DELETE ON TABLE public.climate_evidence FROM authenticated;

-- execution-photos se comparte con fotos de avance. Solo se bloquea el
-- subárbol reservado para evidencia climática; las fotos operativas siguen
-- usando su política de borrado existente.
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
