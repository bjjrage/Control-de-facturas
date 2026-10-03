CREATE FUNCTION private.execution_climate_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.decision_status='CONFIRMED' THEN RAISE EXCEPTION 'Confirmed workday history cannot be deleted; use explicit correction'; END IF;
  RETURN OLD;
 END IF;
 IF auth.uid() IS NOT NULL THEN
  PERFORM private.execution_actor(NEW.project_id);
  NEW.uploaded_by:=auth.uid();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_workday_history_guard BEFORE DELETE ON public.project_workday_status FOR EACH ROW EXECUTE FUNCTION private.execution_climate_history_guard();
CREATE TRIGGER execution_evidence_actor_guard BEFORE INSERT ON public.climate_evidence FOR EACH ROW EXECUTE FUNCTION private.execution_climate_history_guard();
REVOKE ALL ON FUNCTION private.execution_climate_history_guard() FROM PUBLIC,anon,authenticated,service_role;
