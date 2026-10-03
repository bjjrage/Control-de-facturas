-- IFC GUID is a physical identity across model revisions; preserve historical models.
CREATE OR REPLACE FUNCTION public.workspace_apply_bim_quantity(p_context jsonb,p_budget_id uuid,p_elements uuid[],p_expected_version timestamptz,p_quantity numeric) RETURNS numeric
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(p_context); b public.budget_items; e public.bim_elements; total numeric:=0; owner_id uuid:=(p_context->>'id')::uuid; u text; eu text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace-bim-quantity:'||owner_id::text,0));
 SELECT * INTO b FROM public.budget_items WHERE id=p_budget_id FOR UPDATE;
 IF NOT FOUND OR (p_context->>'kind'='TENDER' AND b.tender_id IS DISTINCT FROM owner_id) OR (p_context->>'kind'='PROJECT' AND b.project_id IS DISTINCT FROM owner_id) THEN RAISE EXCEPTION 'Budget context mismatch'; END IF;
 IF b.updated_at IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='P0409'; END IF;
 IF p_elements IS NULL OR cardinality(p_elements) NOT BETWEEN 1 AND 50000 OR (SELECT count(DISTINCT x) FROM unnest(p_elements) x)<>cardinality(p_elements) THEN RAISE EXCEPTION 'Choose unique BIM elements'; END IF;
 IF EXISTS(SELECT 1 FROM public.budget_items WHERE parent_id=b.id) THEN RAISE EXCEPTION 'BIM quantity requires a leaf budget item'; END IF;
 IF (SELECT count(DISTINCT ifc_guid) FROM public.bim_elements WHERE id=ANY(p_elements))<>cardinality(p_elements) THEN RAISE EXCEPTION 'Choose one IFC revision per physical GUID'; END IF;
 IF EXISTS(SELECT 1 FROM public.bim_elements chosen JOIN public.bim_elements other ON other.ifc_guid=chosen.ifc_guid AND other.project_id IS NOT DISTINCT FROM b.project_id AND other.tender_id IS NOT DISTINCT FROM b.tender_id JOIN public.bim_budget_matches m ON m.bim_element_id=other.id AND m.status='CONFIRMADO' AND m.budget_item_id<>b.id WHERE chosen.id=ANY(p_elements)) THEN RAISE EXCEPTION 'Physical IFC identity already counted on another budget item'; END IF;
 u:=private.workspace_unit(b.unit);
 FOR e IN SELECT * FROM public.bim_elements WHERE id=ANY(p_elements) ORDER BY id FOR UPDATE LOOP
  IF e.project_id IS DISTINCT FROM b.project_id OR e.tender_id IS DISTINCT FROM b.tender_id OR e.quantity_value IS NULL THEN RAISE EXCEPTION 'BIM context or measured quantity mismatch'; END IF;
  eu:=private.workspace_unit(e.quantity_unit);
  IF eu IS NULL OR u IS NULL OR eu IS DISTINCT FROM u THEN RAISE EXCEPTION 'BIM unit mismatch: explicit compatible units required'; END IF;
  IF EXISTS(SELECT 1 FROM public.bim_budget_matches WHERE bim_element_id=e.id AND status='CONFIRMADO' AND budget_item_id<>b.id) THEN RAISE EXCEPTION 'BIM element already counted elsewhere'; END IF;
  total:=total+e.quantity_value;
 END LOOP;
 IF (SELECT count(*) FROM public.bim_elements WHERE id=ANY(p_elements))<>cardinality(p_elements) THEN RAISE EXCEPTION 'Missing BIM elements'; END IF;
 IF round(total,4) IS DISTINCT FROM p_quantity OR total<=0 OR total>=1e16 THEN RAISE EXCEPTION 'BIM factual quantity mismatch'; END IF;
 DELETE FROM public.bim_budget_matches WHERE budget_item_id=b.id AND status='CONFIRMADO';
 INSERT INTO public.bim_budget_matches(bim_element_id,budget_item_id,method,status,confirmed_by,confirmed_at)
 SELECT x,b.id,'MANUAL','CONFIRMADO',p.id,now() FROM unnest(p_elements) x;
 UPDATE public.budget_items SET quantity=round(total,4),updated_at=now() WHERE id=b.id;
 RETURN round(total,4);
END $$;
