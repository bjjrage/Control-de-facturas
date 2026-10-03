-- Real Preview exposed a missing UPDATE policy: regroup silently affected zero project elements.
CREATE POLICY execution_bim_elements_update ON public.bim_elements FOR UPDATE TO authenticated
 USING(project_id IN (SELECT id FROM public.projects WHERE empresa_id=public.current_empresa_id()) AND public.is_internal_role(ARRAY['admin','administracion']::public.user_role[]))
 WITH CHECK(project_id IN (SELECT id FROM public.projects WHERE empresa_id=public.current_empresa_id()) AND public.is_internal_role(ARRAY['admin','administracion']::public.user_role[]));

CREATE FUNCTION private.execution_bim_match_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; tid uuid; p public.profiles;
BEGIN
 IF TG_TABLE_NAME='bim_budget_matches' THEN SELECT project_id,tender_id INTO pid,tid FROM public.bim_elements WHERE id=NEW.bim_element_id FOR UPDATE;
 ELSE SELECT project_id,tender_id INTO pid,tid FROM public.bim_element_groups WHERE id=NEW.group_id FOR UPDATE;
 END IF;
 IF pid IS NOT NULL AND auth.uid() IS NOT NULL THEN
  p:=private.execution_actor(pid,true);
  IF NEW.status IN ('CONFIRMED','CONFIRMADO','REJECTED') THEN NEW.confirmed_by:=p.id; NEW.confirmed_at:=now(); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_bim_match_guard BEFORE INSERT OR UPDATE ON public.bim_budget_matches FOR EACH ROW EXECUTE FUNCTION private.execution_bim_match_guard();
CREATE TRIGGER execution_bim_group_match_guard BEFORE INSERT OR UPDATE ON public.bim_group_matches FOR EACH ROW EXECUTE FUNCTION private.execution_bim_match_guard();
REVOKE ALL ON FUNCTION private.execution_bim_match_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.execution_bim_owner_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.tender_id IS DISTINCT FROM OLD.tender_id THEN RAISE EXCEPTION 'BIM origin cannot be reparented'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_bim_model_owner BEFORE UPDATE ON public.bim_models FOR EACH ROW EXECUTE FUNCTION private.execution_bim_owner_immutable();
CREATE TRIGGER execution_bim_element_owner BEFORE UPDATE ON public.bim_elements FOR EACH ROW EXECUTE FUNCTION private.execution_bim_owner_immutable();
CREATE TRIGGER execution_bim_group_owner BEFORE UPDATE ON public.bim_element_groups FOR EACH ROW EXECUTE FUNCTION private.execution_bim_owner_immutable();
REVOKE ALL ON FUNCTION private.execution_bim_owner_immutable() FROM PUBLIC,anon,authenticated,service_role;
