CREATE FUNCTION private.execution_observation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; owner uuid; entry_project uuid;
BEGIN
 IF auth.uid() IS NOT NULL THEN p:=private.execution_actor(NEW.project_id); END IF;
 IF TG_TABLE_NAME='execution_entries' THEN
  SELECT project_id INTO owner FROM public.budget_items WHERE id=NEW.budget_item_id;
  IF owner IS DISTINCT FROM NEW.project_id OR EXISTS(SELECT 1 FROM public.budget_items WHERE parent_id=NEW.budget_item_id) THEN RAISE EXCEPTION 'Execution requires a leaf item in the same project'; END IF;
  IF NEW.quantity_executed IS NULL OR NEW.quantity_executed<0 OR NEW.quantity_executed>=1e16 OR NEW.entry_date>current_date OR EXISTS(SELECT 1 FROM public.projects WHERE id=NEW.project_id AND start_date IS NOT NULL AND NEW.entry_date<start_date) THEN RAISE EXCEPTION 'Invalid actual execution observation'; END IF;
  IF TG_OP='UPDATE' AND (OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.budget_item_id IS DISTINCT FROM NEW.budget_item_id) THEN RAISE EXCEPTION 'Execution provenance immutable'; END IF;
  IF auth.uid() IS NOT NULL THEN NEW.recorded_by:=p.id; END IF;
  IF EXISTS(SELECT 1 FROM unnest(NEW.photo_paths) path WHERE path NOT LIKE NEW.project_id::text||'/'||NEW.id::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='execution-photos' AND name=path)) THEN RAISE EXCEPTION 'Execution photo provenance missing'; END IF;
 ELSIF TG_TABLE_NAME='execution_entry_photos' THEN
  SELECT project_id INTO entry_project FROM public.execution_entries WHERE id=NEW.entry_id;
  IF entry_project IS DISTINCT FROM NEW.project_id OR NEW.storage_path NOT LIKE NEW.project_id::text||'/'||NEW.entry_id::text||'/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='execution-photos' AND name=NEW.storage_path) THEN RAISE EXCEPTION 'Execution photo context mismatch'; END IF;
 ELSE
  IF NEW.external_precipitation_mm IS NOT NULL AND (NEW.external_precipitation_mm<0 OR NEW.external_precipitation_mm>=1e6) OR NEW.local_precipitation_mm IS NOT NULL AND (NEW.local_precipitation_mm<0 OR NEW.local_precipitation_mm>=1e6) THEN RAISE EXCEPTION 'Invalid precipitation measurement'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_actual_context_guard BEFORE INSERT OR UPDATE ON public.execution_entries FOR EACH ROW EXECUTE FUNCTION private.execution_observation_guard();
CREATE TRIGGER execution_photo_context_guard BEFORE INSERT OR UPDATE ON public.execution_entry_photos FOR EACH ROW EXECUTE FUNCTION private.execution_observation_guard();
CREATE TRIGGER execution_precipitation_guard BEFORE INSERT OR UPDATE ON public.climate_events FOR EACH ROW EXECUTE FUNCTION private.execution_observation_guard();
REVOKE ALL ON FUNCTION private.execution_observation_guard() FROM PUBLIC,anon,authenticated,service_role;
