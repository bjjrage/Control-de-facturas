-- Share one source collector and reject requirements changing during COMMITTED recomputation.
CREATE FUNCTION private.weekly_plan_project_sources(project_uuid uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'budget',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.budget_items b WHERE b.project_id=w.project_id),'[]'::jsonb),
 'bom',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.budget_item_materials b WHERE b.project_id=w.project_id AND b.empresa_id=w.empresa_id),'[]'::jsonb),
 'labor',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.budget_item_labor b WHERE b.project_id=w.project_id),'[]'::jsonb),
 'equipment',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.budget_item_equipment b WHERE b.project_id=w.project_id),'[]'::jsonb),
 'subcontracts',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.budget_item_subcontracts b WHERE b.project_id=w.project_id),'[]'::jsonb),
 'execution',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.execution_entries x WHERE x.project_id=w.project_id),'[]'::jsonb),
 'certificates',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.project_certificates c WHERE c.project_id=w.project_id),'[]'::jsonb),
 'certificate_items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.project_certificate_items i JOIN public.project_certificates c ON c.id=i.certificate_id WHERE c.project_id=w.project_id),'[]'::jsonb),
 'project_stock',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.inventory_stock_by_project s WHERE s.project_id=w.project_id AND s.empresa_id=w.empresa_id),'[]'::jsonb),
 'central', (SELECT to_jsonb(l) FROM public.inventory_locations l WHERE l.empresa_id=w.empresa_id AND l.location_type='CENTRAL' AND l.active ORDER BY l.is_primary DESC,l.created_at,l.id LIMIT 1),
 'central_stock',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text) FROM public.inventory_stock_by_location s WHERE s.empresa_id=w.empresa_id AND s.location_id=(SELECT l.id FROM public.inventory_locations l WHERE l.empresa_id=w.empresa_id AND l.location_type='CENTRAL' AND l.active ORDER BY l.is_primary DESC,l.created_at,l.id LIMIT 1)),'[]'::jsonb),
 'reservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.inventory_reservations r WHERE r.empresa_id=w.empresa_id AND r.status='ACTIVE'),'[]'::jsonb),
 'orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'status',o.status,'items',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('received',coalesce(r.cantidad_recibida_total,0)) ORDER BY i.id) FROM public.authorized_order_items i LEFT JOIN public.oc_order_item_recibido r ON r.order_item_id=i.id AND r.empresa_id=w.empresa_id WHERE i.order_id=o.id),'[]'::jsonb)) ORDER BY o.id) FROM public.authorized_orders o WHERE o.project_id=w.project_id AND o.empresa_id=w.empresa_id AND o.status='AUTORIZADO'),'[]'::jsonb),
 'products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'unidad',p.unidad,'nombre',p.nombre,'activo',p.activo,'costo_promedio',p.costo_promedio) ORDER BY p.id) FROM public.productos p WHERE p.empresa_id=w.empresa_id AND p.id IN(SELECT b.producto_id FROM public.budget_item_materials b WHERE b.project_id=w.project_id)),'[]'::jsonb),
 'adopted_prices',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.producto_id) FROM public.project_cost_prices p WHERE p.project_id=w.project_id AND p.empresa_id=w.empresa_id),'[]'::jsonb),
 'observations',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.cost_observations o WHERE o.empresa_id=w.empresa_id AND o.producto_id IN(SELECT b.producto_id FROM public.budget_item_materials b WHERE b.project_id=w.project_id)),'[]'::jsonb))
 FROM (SELECT id project_id,empresa_id FROM public.projects WHERE id=project_uuid) w;
$$;
REVOKE ALL ON FUNCTION private.weekly_plan_project_sources(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.weekly_plan_need_sources(plan_uuid uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.weekly_plan_project_sources(w.project_id)||jsonb_build_object('plan',to_jsonb(w),
'targets',coalesce((SELECT jsonb_agg(to_jsonb(i)-'id'-'created_at'-'updated_at' ORDER BY i.position,i.created_at,i.id) FROM public.project_weekly_plan_items i WHERE i.plan_id=w.id),'[]'::jsonb)) FROM public.project_weekly_plans w WHERE w.id=plan_uuid;
$$;
CREATE FUNCTION public.weekly_plan_project_sources(p_project_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.profiles:=private.weekly_mrp_actor(p_project_id); facts jsonb;
BEGIN facts:=private.weekly_plan_project_sources(p_project_id); RETURN jsonb_build_object('hash',encode(extensions.digest(facts::text,'sha256'),'hex')); END $$;
REVOKE ALL ON FUNCTION public.weekly_plan_project_sources(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.weekly_plan_project_sources(uuid) TO authenticated;
CREATE FUNCTION public.commit_weekly_plan_validated(p_sources_hash text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid:=(p_args->>'p_project_id')::uuid; eid uuid:=(p_args->>'p_empresa_id')::uuid; aid uuid:=(p_args->>'p_actor_id')::uuid;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
 PERFORM public.assert_mrp_actor(eid,aid); PERFORM private.weekly_mrp_lock(eid);
 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=pid AND empresa_id=eid) THEN RAISE EXCEPTION 'Project denied' USING ERRCODE='42501'; END IF;
 IF p_sources_hash IS DISTINCT FROM encode(extensions.digest(private.weekly_plan_project_sources(pid)::text,'sha256'),'hex') THEN RAISE EXCEPTION 'Stock, supply or requirements changed; recalculate plan' USING ERRCODE='P0409'; END IF;
 RETURN public.commit_production_plan_atomic(eid,aid,(p_args->>'p_plan_id')::uuid,pid,(p_args->>'p_start_date')::date,(p_args->>'p_end_date')::date,p_args->>'p_status',p_args->>'p_notes',p_args->'p_items',(p_args->>'p_weather_snapshot_batch_id')::uuid,(p_args->>'p_location_id')::uuid,p_args->'p_reserve_items',(p_args->>'p_needed_by')::date,p_args->>'p_idempotency_key');
END $$;
REVOKE ALL ON FUNCTION public.commit_weekly_plan_validated(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_weekly_plan_validated(text,jsonb) TO service_role;
