CREATE FUNCTION public.execution_create_bim_partidas(p_project_id uuid,p_groups jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.execution_actor(p_project_id,true); x jsonb; g public.bim_element_groups; b uuid; n integer:=0; total numeric; next_sort integer;
BEGIN
 IF jsonb_typeof(p_groups) IS DISTINCT FROM 'array' OR jsonb_array_length(p_groups) NOT BETWEEN 1 AND 10000 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_groups))<>jsonb_array_length(p_groups) THEN RAISE EXCEPTION 'Choose unique BIM groups'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('execution-computo:'||p_project_id::text,0));
 SELECT coalesce(max(sort_order),0) INTO next_sort FROM public.budget_items WHERE project_id=p_project_id;
 FOR x IN SELECT value FROM jsonb_array_elements(p_groups) ORDER BY value->>'id' LOOP
  SELECT * INTO g FROM public.bim_element_groups WHERE id=(x->>'id')::uuid AND project_id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BIM group outside project'; END IF;
  IF EXISTS(SELECT 1 FROM public.bim_group_matches WHERE group_id=g.id AND status='CONFIRMED') THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.bim_group_matches WHERE group_id=g.id AND status='REJECTED') THEN RAISE EXCEPTION 'Human rejected group requires explicit review'; END IF;
  IF trim(coalesce(x->>'code',''))='' OR EXISTS(SELECT 1 FROM public.budget_items WHERE project_id=p_project_id AND code=x->>'code') THEN RAISE EXCEPTION 'Computo changed; reload codes' USING ERRCODE='P0409'; END IF;
  SELECT sum(quantity_value) INTO total FROM public.bim_elements WHERE group_id=g.id;
  next_sort:=next_sort+1;
  INSERT INTO public.budget_items(project_id,code,description,unit,quantity,unit_price,sort_order)
  VALUES(p_project_id,x->>'code',concat_ws(' — ',g.normalized_name,g.material),g.quantity_unit,NULL,NULL,next_sort) RETURNING id INTO b;
  PERFORM public.execution_confirm_bim_group(p_project_id,g.id,b,true,(SELECT updated_at FROM public.budget_items WHERE id=b));
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.execution_create_bim_partidas(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.execution_create_bim_partidas(uuid,jsonb) TO authenticated;
CREATE FUNCTION private.execution_bim_membership_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.group_id IS DISTINCT FROM OLD.group_id AND OLD.group_id IS NOT NULL THEN
  PERFORM 1 FROM public.bim_element_groups WHERE id=OLD.group_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.bim_group_matches WHERE group_id=OLD.group_id AND status IN ('CONFIRMED','REJECTED')) THEN RAISE EXCEPTION 'Human BIM membership immutable'; END IF;
 END IF;
 IF NEW.bim_model_id IS DISTINCT FROM OLD.bim_model_id THEN RAISE EXCEPTION 'IFC model provenance immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_bim_membership_guard BEFORE UPDATE ON public.bim_elements FOR EACH ROW EXECUTE FUNCTION private.execution_bim_membership_guard();
REVOKE ALL ON FUNCTION private.execution_bim_membership_guard() FROM PUBLIC,anon,authenticated,service_role;
