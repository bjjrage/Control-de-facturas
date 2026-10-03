ALTER TABLE public.project_progress_forecast_runs ADD COLUMN input_snapshot jsonb NOT NULL DEFAULT '{}', ADD COLUMN input_snapshot_sha256 text;
CREATE FUNCTION private.execution_forecast_provenance() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(NEW.input_snapshot) IS DISTINCT FROM 'object' OR NEW.input_snapshot->>'mode' IS DISTINCT FROM 'PLANNING' OR NEW.input_snapshot->>'projectId' IS DISTINCT FROM NEW.project_id::text OR NEW.input_snapshot->>'startDate' IS DISTINCT FROM NEW.start_date::text OR (NEW.input_snapshot->>'horizonDays')::integer IS DISTINCT FROM NEW.horizon_days OR octet_length(NEW.input_snapshot::text)>8388608 THEN RAISE EXCEPTION 'Forecast planning input provenance required'; END IF;
 NEW.input_snapshot_sha256:=encode(extensions.digest(NEW.input_snapshot::text,'sha256'),'hex');
 RETURN NEW;
END $$;
CREATE TRIGGER execution_forecast_provenance BEFORE INSERT ON public.project_progress_forecast_runs FOR EACH ROW EXECUTE FUNCTION private.execution_forecast_provenance();
REVOKE ALL ON FUNCTION private.execution_forecast_provenance() FROM PUBLIC,anon,authenticated,service_role;
