CREATE FUNCTION private.execution_schedule_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d uuid; found_cycle boolean;
BEGIN
 IF (NEW.start_date IS NULL) IS DISTINCT FROM (NEW.end_date IS NULL) OR NEW.end_date<NEW.start_date THEN RAISE EXCEPTION 'Schedule requires an ordered complete date range'; END IF;
 IF NEW.project_id IS NULL OR nullif(trim(NEW.depends_on),'') IS NULL THEN RETURN NEW; END IF;
 -- Serialize dependency edits per project, so opposite concurrent edges cannot create a cycle.
 PERFORM pg_advisory_xact_lock(hashtextextended('execution-schedule:'||NEW.project_id::text,0));
 FOR d IN SELECT trim(value)::uuid FROM unnest(string_to_array(NEW.depends_on,',')) value LOOP
  IF d=NEW.id OR NOT EXISTS(SELECT 1 FROM public.budget_items WHERE id=d AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Predecessor outside project or self dependency'; END IF;
  WITH RECURSIVE edges AS (
   SELECT d AS id,ARRAY[d] AS path
   UNION ALL
   SELECT trim(v)::uuid,e.path||trim(v)::uuid FROM edges e JOIN public.budget_items b ON b.id=e.id
   CROSS JOIN LATERAL unnest(string_to_array(nullif(b.depends_on,''),',')) v
   WHERE b.project_id=NEW.project_id AND NOT trim(v)::uuid=ANY(e.path)
  ) SELECT EXISTS(SELECT 1 FROM edges WHERE id=NEW.id) INTO found_cycle;
  IF found_cycle THEN RAISE EXCEPTION 'Schedule dependency cycle'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_schedule_guard BEFORE INSERT OR UPDATE OF start_date,end_date,depends_on ON public.budget_items FOR EACH ROW EXECUTE FUNCTION private.execution_schedule_guard();
REVOKE ALL ON FUNCTION private.execution_schedule_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Protect a human decision even when an AI regroup read happened before it.
CREATE FUNCTION private.execution_bim_decision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g uuid; pid uuid;
BEGIN
 IF TG_TABLE_NAME='bim_element_groups' THEN
  g:=OLD.id; pid:=OLD.project_id;
  IF EXISTS(SELECT 1 FROM public.bim_group_matches WHERE group_id=g AND status IN ('CONFIRMED','REJECTED')) THEN RAISE EXCEPTION 'Human BIM group decision cannot be destroyed'; END IF;
 ELSIF TG_TABLE_NAME='bim_models' THEN
  pid:=OLD.project_id;
  IF EXISTS(SELECT 1 FROM public.bim_elements e JOIN public.bim_budget_matches m ON m.bim_element_id=e.id WHERE e.bim_model_id=OLD.id AND m.status='CONFIRMADO') OR EXISTS(SELECT 1 FROM public.bim_element_groups g JOIN public.bim_group_matches m ON m.group_id=g.id WHERE g.bim_model_id=OLD.id AND m.status IN ('CONFIRMED','REJECTED')) THEN RAISE EXCEPTION 'Confirmed BIM provenance cannot be deleted'; END IF;
 ELSE
  SELECT project_id INTO pid FROM public.bim_element_groups WHERE id=NEW.group_id FOR UPDATE;
 END IF;
 IF pid IS NOT NULL AND auth.uid() IS NOT NULL THEN PERFORM private.execution_actor(pid,true); END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER execution_bim_group_delete_guard BEFORE DELETE ON public.bim_element_groups FOR EACH ROW EXECUTE FUNCTION private.execution_bim_decision_guard();
CREATE TRIGGER execution_bim_model_delete_guard BEFORE DELETE ON public.bim_models FOR EACH ROW EXECUTE FUNCTION private.execution_bim_decision_guard();
CREATE TRIGGER execution_bim_group_decision_lock BEFORE INSERT OR UPDATE ON public.bim_group_matches FOR EACH ROW EXECUTE FUNCTION private.execution_bim_decision_guard();
REVOKE ALL ON FUNCTION private.execution_bim_decision_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Non-factual quantities must not be smuggled through an existing element update.
CREATE FUNCTION private.execution_bim_quantity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.quantity_value IS NOT NULL AND (NEW.quantity_value<0 OR NEW.quantity_value>=1e16 OR NEW.quantity_source NOT IN ('IFC_QTO','IFC_PROPERTY') OR NEW.quantity_source IS NULL OR trim(coalesce(NEW.quantity_unit,''))='') THEN RAISE EXCEPTION 'Measured IFC quantity requires source/unit'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.bim_budget_matches WHERE bim_element_id=OLD.id AND status='CONFIRMADO') AND (NEW.quantity_value IS DISTINCT FROM OLD.quantity_value OR NEW.quantity_unit IS DISTINCT FROM OLD.quantity_unit OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.tender_id IS DISTINCT FROM OLD.tender_id) THEN RAISE EXCEPTION 'Confirmed BIM quantity provenance immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_bim_quantity_guard BEFORE INSERT OR UPDATE ON public.bim_elements FOR EACH ROW EXECUTE FUNCTION private.execution_bim_quantity_guard();
REVOKE ALL ON FUNCTION private.execution_bim_quantity_guard() FROM PUBLIC,anon,authenticated,service_role;
