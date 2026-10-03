-- Batch07: common boundaries for execution planning, never contractual baseline mutation.
CREATE FUNCTION private.execution_actor(p_project_id uuid,p_bim boolean DEFAULT false) RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor();
BEGIN
 IF p.role NOT IN ('admin','administracion') OR NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project_id AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'Execution project denied' USING ERRCODE='42501'; END IF;
 IF p_bim AND NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=p.empresa_id AND plan='caterpillar') AND NOT p.is_super_admin THEN RAISE EXCEPTION 'BIM plan denied' USING ERRCODE='42501'; END IF;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION private.execution_actor(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Tighten the PROJECT branch of the shared actor without duplicating the tender engine.
CREATE OR REPLACE FUNCTION private.workspace_actor(c jsonb) RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); owner_id uuid:=(c->>'id')::uuid;
BEGIN
 IF c->>'kind'='TENDER' THEN
  PERFORM 1 FROM public.licitaciones WHERE id=owner_id AND empresa_id=p.empresa_id AND moneda='PYG' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tender context denied'; END IF;
  IF EXISTS(SELECT 1 FROM public.licitacion_ofertas WHERE licitacion_id=owner_id AND estado<>'BORRADOR') THEN RAISE EXCEPTION 'PREBID is frozen'; END IF;
 ELSIF c->>'kind'='PROJECT' THEN p:=private.execution_actor(owner_id);
 ELSE RAISE EXCEPTION 'Invalid workspace context'; END IF;
 RETURN p;
END $$;

CREATE FUNCTION public.execution_save_forecast(p_project_id uuid,p_run jsonb,p_items jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.execution_actor(p_project_id); r public.project_progress_forecast_runs;
 i public.project_progress_forecast_items; x jsonb; seen uuid[]:='{}';
BEGIN
 IF jsonb_typeof(p_run) IS DISTINCT FROM 'object' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>50000 THEN RAISE EXCEPTION 'Invalid forecast snapshot'; END IF;
 r:=jsonb_populate_record(NULL::public.project_progress_forecast_runs,p_run);
 r.id:=gen_random_uuid(); r.project_id:=p_project_id; r.empresa_id:=p.empresa_id; r.created_by:=p.id; r.created_at:=now();
 IF r.horizon_days IS NULL OR r.horizon_days NOT BETWEEN 7 AND 90 OR r.start_date IS NULL OR r.end_date IS DISTINCT FROM r.start_date+r.horizon_days-1 OR r.currency IS DISTINCT FROM 'PYG' OR r.days_in_horizon IS DISTINCT FROM r.horizon_days THEN RAISE EXCEPTION 'Invalid forecast date/currency contract'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(r)) a WHERE a.key IN ('total_projected_physical_value','total_material_consumption_value','total_additional_cash_required','workable_days_count','partially_blocked_days_count','fully_blocked_days_count','calendar_days_elapsed','workable_days_elapsed','rain_lost_days','rain_effect_lost_days','other_lost_days','effective_available_days','gross_schedule_variance','weather_adjusted_variance') AND (a.value='null'::jsonb OR (a.value#>>'{}')::numeric<0 OR (a.value#>>'{}')::numeric>=1e16)) THEN RAISE EXCEPTION 'Invalid forecast amounts/metrics'; END IF;
 INSERT INTO public.project_progress_forecast_runs SELECT r.*;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  i:=jsonb_populate_record(NULL::public.project_progress_forecast_items,x);
  i.id:=gen_random_uuid(); i.run_id:=r.id; i.created_at:=now();
  IF i.budget_item_id IS NULL OR i.budget_item_id=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.budget_items b WHERE b.id=i.budget_item_id AND b.project_id=p_project_id AND NOT EXISTS(SELECT 1 FROM public.budget_items child WHERE child.parent_id=b.id)) THEN RAISE EXCEPTION 'Forecast item context/leaf mismatch'; END IF;
  seen:=array_append(seen,i.budget_item_id);
  IF i.projected_quantity IS NULL OR i.remaining_quantity IS NULL OR i.projected_quantity<0 OR i.projected_quantity>i.remaining_quantity OR i.remaining_quantity>=1e16 OR i.workability_factor IS NULL OR i.workability_factor NOT BETWEEN 0 AND 1 OR i.base_velocity_per_day IS NULL OR i.base_velocity_per_day<0 OR i.base_velocity_per_day>=1e16 OR i.effective_velocity_per_day IS NULL OR i.effective_velocity_per_day<0 OR i.effective_velocity_per_day>=1e16 THEN RAISE EXCEPTION 'Invalid forecast quantity/factor'; END IF;
  INSERT INTO public.project_progress_forecast_items SELECT i.*;
 END LOOP;
 RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.execution_save_forecast(uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.execution_save_forecast(uuid,jsonb,jsonb) TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.project_progress_forecast_runs,public.project_progress_forecast_items FROM authenticated,anon;
CREATE FUNCTION private.execution_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Execution planning snapshots are immutable'; END $$;
CREATE TRIGGER execution_forecast_run_immutable BEFORE UPDATE OR DELETE ON public.project_progress_forecast_runs FOR EACH ROW EXECUTE FUNCTION private.execution_snapshot_immutable();
CREATE TRIGGER execution_forecast_item_immutable BEFORE UPDATE OR DELETE ON public.project_progress_forecast_items FOR EACH ROW EXECUTE FUNCTION private.execution_snapshot_immutable();
REVOKE ALL ON FUNCTION private.execution_snapshot_immutable() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.execution_confirm_bim_group(p_project_id uuid,p_group_id uuid,p_budget_id uuid,p_update_quantity boolean,p_expected_version timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.execution_actor(p_project_id,true); g public.bim_element_groups; b public.budget_items; ids uuid[]; total numeric;
BEGIN
 SELECT * INTO g FROM public.bim_element_groups WHERE id=p_group_id AND project_id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BIM group context denied'; END IF;
 SELECT * INTO b FROM public.budget_items WHERE id=p_budget_id AND project_id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BIM budget context denied'; END IF;
 IF b.updated_at IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='P0409'; END IF;
 SELECT array_agg(id ORDER BY id),sum(quantity_value) INTO ids,total FROM public.bim_elements WHERE group_id=g.id AND project_id=p_project_id;
 IF p_update_quantity THEN
  PERFORM public.workspace_apply_bim_quantity(jsonb_build_object('kind','PROJECT','id',p_project_id),b.id,ids,p_expected_version,round(total,4));
 END IF;
 IF EXISTS(SELECT 1 FROM public.bim_group_matches WHERE group_id=g.id AND status='CONFIRMED' AND budget_item_id IS DISTINCT FROM b.id) THEN RAISE EXCEPTION 'Group already confirmed elsewhere'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bim_group_matches WHERE group_id=g.id AND budget_item_id=b.id AND status='CONFIRMED') THEN
  UPDATE public.bim_group_matches SET status='REJECTED' WHERE group_id=g.id AND status IN ('SUGGESTED','REVIEW','REVIEW_REQUIRED');
  INSERT INTO public.bim_group_matches(group_id,budget_item_id,method,status,confirmed_by,confirmed_at) VALUES(g.id,b.id,'MANUAL','CONFIRMED',p.id,now());
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.execution_confirm_bim_group(uuid,uuid,uuid,boolean,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.execution_confirm_bim_group(uuid,uuid,uuid,boolean,timestamptz) TO authenticated;

CREATE FUNCTION private.execution_bim_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; gid uuid; ep uuid; et uuid; gp uuid; gt uuid;
BEGIN
 IF TG_TABLE_NAME='bim_elements' THEN
  pid:=NEW.project_id;
  IF NEW.group_id IS NOT NULL THEN
   SELECT project_id,tender_id INTO gp,gt FROM public.bim_element_groups WHERE id=NEW.group_id;
   IF gp IS DISTINCT FROM NEW.project_id OR gt IS DISTINCT FROM NEW.tender_id THEN RAISE EXCEPTION 'BIM group owner mismatch'; END IF;
  END IF;
 ELSE pid:=NEW.project_id;
 END IF;
 IF pid IS NOT NULL AND auth.uid() IS NOT NULL THEN PERFORM private.execution_actor(pid,true); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_bim_element_guard BEFORE INSERT OR UPDATE ON public.bim_elements FOR EACH ROW EXECUTE FUNCTION private.execution_bim_guard();
CREATE TRIGGER execution_bim_model_guard BEFORE INSERT OR UPDATE ON public.bim_models FOR EACH ROW EXECUTE FUNCTION private.execution_bim_guard();
CREATE TRIGGER execution_bim_group_guard BEFORE INSERT OR UPDATE ON public.bim_element_groups FOR EACH ROW EXECUTE FUNCTION private.execution_bim_guard();
REVOKE ALL ON FUNCTION private.execution_bim_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.execution_climate_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; day date;
BEGIN
 IF auth.uid() IS NOT NULL THEN p:=private.execution_actor(NEW.project_id); END IF;
 IF TG_TABLE_NAME='project_workday_status' THEN
  day:=NEW.work_date;
  IF NEW.decision_status='CONFIRMED' AND auth.uid() IS NULL THEN RAISE EXCEPTION 'Human confirmation required'; END IF;
  IF NEW.decision_status='CONFIRMED' THEN NEW.confirmed_by:=p.id; NEW.confirmed_at:=now(); END IF;
  IF TG_OP='UPDATE' AND OLD.decision_status='CONFIRMED' AND NEW.source IN ('SYSTEM','AUTOMATIC') THEN RAISE EXCEPTION 'Automation cannot overwrite a confirmed workday'; END IF;
 ELSE
  IF TG_TABLE_NAME='climate_events' THEN day:=NEW.event_date;
   IF TG_OP='UPDATE' AND OLD.status IN ('CONFIRMED','OVERRIDDEN') AND NEW.status NOT IN ('CONFIRMED','OVERRIDDEN') THEN NEW.status:=OLD.status; END IF;
  ELSE
   IF NEW.storage_path IS NOT NULL AND (NEW.storage_bucket IS DISTINCT FROM 'execution-photos' OR NEW.storage_path NOT LIKE NEW.project_id::text||'/climate/%' OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=NEW.storage_bucket AND name=NEW.storage_path)) THEN RAISE EXCEPTION 'Climate storage provenance missing'; END IF;
   IF NEW.climate_event_id IS NOT NULL AND NEW.workday_status_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_workday_status WHERE id=NEW.workday_status_id AND climate_event_id=NEW.climate_event_id) THEN RAISE EXCEPTION 'Climate evidence causal mismatch'; END IF;
  END IF;
 END IF;
 IF day IS NOT NULL AND (day>current_date OR EXISTS(SELECT 1 FROM public.projects WHERE id=NEW.project_id AND start_date IS NOT NULL AND day<start_date)) THEN RAISE EXCEPTION 'Workday observation outside execution period'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_climate_event_guard BEFORE INSERT OR UPDATE ON public.climate_events FOR EACH ROW EXECUTE FUNCTION private.execution_climate_guard();
CREATE TRIGGER execution_workday_guard BEFORE INSERT OR UPDATE ON public.project_workday_status FOR EACH ROW EXECUTE FUNCTION private.execution_climate_guard();
CREATE TRIGGER execution_climate_evidence_guard BEFORE INSERT ON public.climate_evidence FOR EACH ROW EXECUTE FUNCTION private.execution_climate_guard();
REVOKE ALL ON FUNCTION private.execution_climate_guard() FROM PUBLIC,anon,authenticated,service_role;
