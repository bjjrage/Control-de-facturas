-- Complete the immutable decision payload used for exact human-facts retries.
CREATE OR REPLACE FUNCTION public.weekly_plan_need_direct_preview(p_plan_id uuid,p_snapshot_id uuid,p_need_ids uuid[],p_header jsonb,p_items jsonb,p_seen jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.weekly_plan_need_snapshots:=private.weekly_need_check(p_plan_id,p_snapshot_id,p_need_ids); a public.profiles:=private.weekly_mrp_actor(s.project_id); x jsonb; selected_need public.weekly_plan_material_needs; p public.productos; products uuid[]:='{}'; result jsonb; decision uuid;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<>cardinality(p_need_ids) THEN RAISE EXCEPTION 'Direct purchase must refer to the selected needs'; END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_plan_material_needs n JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.id=ANY(p_need_ids) AND (d.kind='RFQ' OR EXISTS(SELECT 1 FROM public.authorized_orders o WHERE o.direct_purchase_preview_id=d.direct_purchase_preview_id))) THEN RAISE EXCEPTION 'Need already has an RFQ or confirmed order'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO selected_need FROM public.weekly_plan_material_needs WHERE id=ANY(p_need_ids) AND producto_id=(x->>'producto_id')::uuid;
  SELECT * INTO p FROM public.productos WHERE id=selected_need.producto_id AND empresa_id=s.empresa_id;
  IF selected_need.id IS NULL OR p.id IS NULL OR selected_need.producto_id=ANY(products) OR (x->>'quantity')::numeric IS NULL OR (x->>'quantity')::numeric<=0 OR (x->>'quantity')::numeric>selected_need.quantity OR coalesce(private.workspace_unit(x->>'unit'),lower(trim(x->>'unit'))) IS DISTINCT FROM coalesce(private.workspace_unit(p.unidad),lower(trim(p.unidad))) THEN RAISE EXCEPTION 'Invalid direct purchase need quantity/unit'; END IF;
  products:=array_append(products,selected_need.producto_id);
 END LOOP;
 -- Same human facts/snapshot retry reuses the canonical preview rather than creating another draft.
 SELECT jsonb_build_object('id',v.id,'hash',v.preview_hash,'snapshot',v.snapshot) INTO result FROM public.weekly_plan_need_decisions d JOIN public.direct_purchase_previews v ON v.id=d.direct_purchase_preview_id WHERE d.snapshot_id=s.id AND d.kind='DIRECT_PURCHASE' AND v.created_by=a.id AND d.request_payload=jsonb_build_object('header',p_header,'items',p_items) AND d.need_ids @> p_need_ids AND d.need_ids <@ p_need_ids AND NOT EXISTS(SELECT 1 FROM public.weekly_plan_material_needs n WHERE n.id=ANY(p_need_ids) AND n.decision_id IS DISTINCT FROM d.id) ORDER BY d.created_at DESC LIMIT 1;
 -- Canonical preview validates supplier, prices, taxes, freight and terms.
 -- A new deliberate preview replaces only the active pointer; the old decision remains immutable.
 IF result IS NULL THEN
  result:=public.direct_purchase_preview(coalesce(p_header,'{}')||jsonb_build_object('project_id',s.project_id),p_items);
  INSERT INTO public.weekly_plan_need_decisions(snapshot_id,empresa_id,kind,direct_purchase_preview_id,need_ids,request_payload,seen_reference,created_by) VALUES(s.id,s.empresa_id,'DIRECT_PURCHASE',(result->>'id')::uuid,p_need_ids,jsonb_build_object('header',p_header,'items',p_items),coalesce(p_seen,'{}'),a.id) RETURNING id INTO decision;
  UPDATE public.weekly_plan_material_needs SET decision_id=decision,updated_at=now() WHERE id=ANY(p_need_ids);
 END IF;
 RETURN result;
END $$;

