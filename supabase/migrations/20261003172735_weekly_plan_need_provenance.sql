ALTER TABLE public.project_weekly_plan_items ADD COLUMN position integer NOT NULL DEFAULT 0;
-- Batch 08: shortage history and human entry into the existing procurement engines.
-- No application data backfill, automatic procurement, or physical stock mutation.
CREATE FUNCTION private.weekly_mrp_lock(e uuid) RETURNS void LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('weekly-mrp:'||e::text,0));
$$;
REVOKE ALL ON FUNCTION private.weekly_mrp_lock(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.weekly_mrp_actor(pid uuid) RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.profiles:=private.execution_actor(pid);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.empresas WHERE id=a.empresa_id AND active AND plan IN ('pro','caterpillar')) AND NOT a.is_super_admin THEN RAISE EXCEPTION 'Weekly planning plan denied' USING ERRCODE='42501'; END IF;
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION private.weekly_mrp_actor(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Writers serialize with the decision boundary. Readers do not lock physical rows.
CREATE FUNCTION private.weekly_mrp_source_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; e uuid; pid uuid;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 e:=nullif(r->>'empresa_id','')::uuid; pid:=nullif(r->>'project_id','')::uuid;
 IF e IS NULL AND TG_TABLE_NAME='empresas' THEN e:=(r->>'id')::uuid; END IF;
 IF e IS NULL AND pid IS NOT NULL THEN SELECT empresa_id INTO e FROM public.projects WHERE id=pid; END IF;
 IF e IS NULL AND r->>'tender_id' IS NOT NULL THEN SELECT empresa_id INTO e FROM public.licitaciones WHERE id=(r->>'tender_id')::uuid; END IF;
 IF e IS NULL AND r->>'plan_id' IS NOT NULL THEN SELECT empresa_id INTO e FROM public.project_weekly_plans WHERE id=(r->>'plan_id')::uuid; END IF;
 IF e IS NULL AND r->>'order_id' IS NOT NULL THEN SELECT empresa_id INTO e FROM public.authorized_orders WHERE id=(r->>'order_id')::uuid; END IF;
 IF e IS NULL AND r->>'certificate_id' IS NOT NULL THEN SELECT p.empresa_id INTO e FROM public.project_certificates c JOIN public.projects p ON p.id=c.project_id WHERE c.id=(r->>'certificate_id')::uuid; END IF;
 IF e IS NOT NULL THEN PERFORM private.weekly_mrp_lock(e); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.weekly_mrp_source_lock() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_weekly_plans','project_weekly_plan_items','budget_items','budget_item_materials','budget_item_labor','budget_item_equipment','budget_item_subcontracts','execution_entries','project_certificates','project_certificate_items','authorized_orders','authorized_order_items','oc_recepciones','oc_recepcion_items','inventory_balances','inventory_reservations','inventory_locations','productos','project_cost_prices','cost_observations','empresas','profiles'] LOOP
  EXECUTE format('CREATE TRIGGER b08_mrp_source_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.weekly_mrp_source_lock()',t);
 END LOOP;
END $$;

-- One consistent SELECT of physical requirement inputs; no demand formula lives here.
CREATE FUNCTION private.weekly_plan_need_sources(plan_uuid uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'plan',to_jsonb(w),
 'targets',coalesce((SELECT jsonb_agg(to_jsonb(i)-'id'-'created_at'-'updated_at' ORDER BY i.position,i.created_at,i.id) FROM public.project_weekly_plan_items i WHERE i.plan_id=w.id),'[]'::jsonb),
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
 FROM public.project_weekly_plans w WHERE w.id=plan_uuid;
$$;
REVOKE ALL ON FUNCTION private.weekly_plan_need_sources(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.weekly_plan_need_sources(p_plan_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.project_weekly_plans; a public.profiles; facts jsonb;
BEGIN
 SELECT * INTO w FROM public.project_weekly_plans WHERE id=p_plan_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found' USING ERRCODE='42501'; END IF;
 a:=private.weekly_mrp_actor(w.project_id);
 IF w.empresa_id<>a.empresa_id THEN RAISE EXCEPTION 'Plan denied' USING ERRCODE='42501'; END IF;
 facts:=private.weekly_plan_need_sources(w.id);
 RETURN jsonb_build_object('facts',facts,'hash',encode(extensions.digest(facts::text,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.weekly_plan_need_sources(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.weekly_plan_need_sources(uuid) TO authenticated;

CREATE TABLE public.weekly_plan_need_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES public.project_weekly_plans(id),
 empresa_id uuid NOT NULL REFERENCES public.empresas(id), project_id uuid NOT NULL REFERENCES public.projects(id),
 needed_by date NOT NULL, facts_sha256 text NOT NULL CHECK(facts_sha256 ~ '^[a-f0-9]{64}$'),
 source_snapshot jsonb NOT NULL, coverage jsonb NOT NULL, seen_reference jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,facts_sha256,needed_by));
CREATE TABLE public.weekly_plan_need_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id uuid NOT NULL REFERENCES public.weekly_plan_need_snapshots(id),
 empresa_id uuid NOT NULL REFERENCES public.empresas(id), kind text NOT NULL CHECK(kind IN('RFQ','DIRECT_PURCHASE')),
 rfq_id uuid UNIQUE REFERENCES public.rfqs(id), direct_purchase_preview_id uuid UNIQUE REFERENCES public.direct_purchase_previews(id),
 need_ids uuid[] NOT NULL, request_payload jsonb NOT NULL DEFAULT '{}'::jsonb, seen_reference jsonb NOT NULL, created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='RFQ' AND rfq_id IS NOT NULL AND direct_purchase_preview_id IS NULL) OR (kind='DIRECT_PURCHASE' AND direct_purchase_preview_id IS NOT NULL AND rfq_id IS NULL)));
CREATE TABLE public.weekly_plan_material_needs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES public.project_weekly_plans(id),
 empresa_id uuid NOT NULL REFERENCES public.empresas(id), project_id uuid NOT NULL REFERENCES public.projects(id),
 producto_id uuid NOT NULL REFERENCES public.productos(id), snapshot_id uuid NOT NULL REFERENCES public.weekly_plan_need_snapshots(id),
 quantity numeric NOT NULL CHECK(quantity>=0 AND quantity<1e16),
 decision_id uuid REFERENCES public.weekly_plan_need_decisions(id), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,producto_id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['weekly_plan_need_snapshots','weekly_plan_need_decisions','weekly_plan_material_needs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY b08_need_read ON public.%I FOR SELECT TO authenticated USING(empresa_id=(SELECT public.current_empresa_id()) AND public.is_internal_role(ARRAY[''administracion'',''admin'']::public.user_role[]))',t);
 END LOOP;
END $$;
CREATE FUNCTION private.weekly_need_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Need decision history is immutable'; END $$;
CREATE TRIGGER b08_snapshot_immutable BEFORE UPDATE OR DELETE ON public.weekly_plan_need_snapshots FOR EACH ROW EXECUTE FUNCTION private.weekly_need_history_guard();
CREATE TRIGGER b08_decision_immutable BEFORE UPDATE OR DELETE ON public.weekly_plan_need_decisions FOR EACH ROW EXECUTE FUNCTION private.weekly_need_history_guard();
REVOKE ALL ON FUNCTION private.weekly_need_history_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Server recalculates using calculateWeeklyPlanRequirements + allocateMaterialCoverage.
-- The browser cannot write quantities or snapshots. A changed DB source rejects the write.
CREATE FUNCTION public.weekly_plan_refresh_needs(p_actor_id uuid,p_plan_id uuid,p_hash text,p_needed_by date,p_lines jsonb,p_seen jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.project_weekly_plans; facts jsonb; sid uuid; x jsonb; pid uuid; seen uuid[]:='{}'; qty numeric;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM public.project_weekly_plans WHERE id=p_plan_id;
 IF NOT FOUND OR w.status='CLOSED' THEN RAISE EXCEPTION 'An active saved plan is required'; END IF;
 PERFORM public.assert_mrp_actor(w.empresa_id,p_actor_id);
 IF NOT EXISTS(SELECT 1 FROM public.profiles a JOIN public.empresas e ON e.id=a.empresa_id WHERE a.id=p_actor_id AND a.active AND e.active AND (a.is_super_admin OR e.plan IN('pro','caterpillar'))) THEN RAISE EXCEPTION 'Inactive planning actor' USING ERRCODE='42501'; END IF;
 PERFORM private.weekly_mrp_lock(w.empresa_id);
 SELECT * INTO w FROM public.project_weekly_plans WHERE id=p_plan_id;
 IF w.status='CLOSED' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND empresa_id=w.empresa_id AND active AND role IN('admin','administracion')) THEN RAISE EXCEPTION 'Actor or plan changed' USING ERRCODE='42501'; END IF;
 facts:=private.weekly_plan_need_sources(w.id);
 IF p_hash IS DISTINCT FROM encode(extensions.digest(facts::text,'sha256'),'hex') THEN RAISE EXCEPTION 'Planning sources changed; recalculate' USING ERRCODE='P0409'; END IF;
 IF p_needed_by IS NULL OR p_needed_by NOT BETWEEN w.start_date AND w.end_date OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines)>500 THEN RAISE EXCEPTION 'Invalid need coverage'; END IF;
 INSERT INTO public.weekly_plan_need_snapshots(plan_id,empresa_id,project_id,needed_by,facts_sha256,source_snapshot,coverage,seen_reference,created_by)
 VALUES(w.id,w.empresa_id,w.project_id,p_needed_by,p_hash,facts,p_lines,coalesce(p_seen,'{}'),p_actor_id)
 ON CONFLICT(plan_id,facts_sha256,needed_by) DO NOTHING;
 SELECT id INTO sid FROM public.weekly_plan_need_snapshots WHERE plan_id=w.id AND facts_sha256=p_hash AND needed_by=p_needed_by;
 IF (SELECT coverage FROM public.weekly_plan_need_snapshots WHERE id=sid) IS DISTINCT FROM p_lines THEN RAISE EXCEPTION 'Same sources produced different coverage'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  pid:=(x->>'producto_id')::uuid; qty:=(x->>'comprar')::numeric;
  IF pid IS NULL OR pid=ANY(seen) OR qty IS NULL OR qty<0 OR qty>=1e16 OR NOT EXISTS(SELECT 1 FROM public.productos p JOIN public.budget_item_materials b ON b.producto_id=p.id WHERE p.id=pid AND p.empresa_id=w.empresa_id AND b.project_id=w.project_id AND b.empresa_id=w.empresa_id) THEN RAISE EXCEPTION 'Invalid need product/quantity'; END IF;
  seen:=array_append(seen,pid);
  INSERT INTO public.weekly_plan_material_needs(plan_id,empresa_id,project_id,producto_id,snapshot_id,quantity)
  VALUES(w.id,w.empresa_id,w.project_id,pid,sid,qty)
  ON CONFLICT(plan_id,producto_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,quantity=excluded.quantity,updated_at=now();
 END LOOP;
 UPDATE public.weekly_plan_material_needs SET quantity=0,snapshot_id=sid,updated_at=now() WHERE plan_id=w.id AND NOT(producto_id=ANY(seen));
 RETURN jsonb_build_object('snapshot_id',sid,'hash',p_hash,'needs',coalesce((SELECT jsonb_agg(to_jsonb(n)||jsonb_build_object('decision',CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d)||jsonb_build_object('order_id',(SELECT order_id FROM public.direct_purchase_previews WHERE id=d.direct_purchase_preview_id)) END) ORDER BY n.producto_id) FROM public.weekly_plan_material_needs n LEFT JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.plan_id=w.id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.weekly_plan_refresh_needs(uuid,uuid,text,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_plan_refresh_needs(uuid,uuid,text,date,jsonb,jsonb) TO service_role;

CREATE FUNCTION private.weekly_need_check(plan_uuid uuid,snapshot_uuid uuid,need_ids uuid[]) RETURNS public.weekly_plan_need_snapshots LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.weekly_plan_need_snapshots; w public.project_weekly_plans; a public.profiles; facts jsonb;
BEGIN
 SELECT * INTO w FROM public.project_weekly_plans WHERE id=plan_uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan denied' USING ERRCODE='42501'; END IF;
 a:=private.weekly_mrp_actor(w.project_id);
 IF w.empresa_id<>a.empresa_id OR w.status='CLOSED' THEN RAISE EXCEPTION 'Active plan denied' USING ERRCODE='42501'; END IF;
 PERFORM private.weekly_mrp_lock(w.empresa_id);
 SELECT * INTO w FROM public.project_weekly_plans WHERE id=plan_uuid;
 a:=private.weekly_mrp_actor(w.project_id);
 IF w.empresa_id<>a.empresa_id OR w.status='CLOSED' THEN RAISE EXCEPTION 'Active plan denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.weekly_plan_need_snapshots WHERE id=snapshot_uuid AND plan_id=w.id AND empresa_id=w.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Need snapshot denied' USING ERRCODE='42501'; END IF;
 facts:=private.weekly_plan_need_sources(w.id);
 IF s.facts_sha256 IS DISTINCT FROM encode(extensions.digest(facts::text,'sha256'),'hex') THEN RAISE EXCEPTION 'Stock, supply or targets changed; recalculate needs' USING ERRCODE='P0409'; END IF;
 IF need_ids IS NULL OR cardinality(need_ids) NOT BETWEEN 1 AND 500 OR cardinality(need_ids)<>(SELECT count(DISTINCT id) FROM unnest(need_ids) id) THEN RAISE EXCEPTION 'Choose unique active needs'; END IF;
 PERFORM 1 FROM public.weekly_plan_material_needs WHERE id=ANY(need_ids) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.weekly_plan_material_needs WHERE id=ANY(need_ids) AND plan_id=w.id AND snapshot_id=s.id AND quantity>0)<>cardinality(need_ids) THEN RAISE EXCEPTION 'Need no longer active or wrong context'; END IF;
 RETURN s;
END $$;
REVOKE ALL ON FUNCTION private.weekly_need_check(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.weekly_plan_need_rfq(p_plan_id uuid,p_snapshot_id uuid,p_need_ids uuid[],p_header jsonb,p_seen jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.weekly_plan_need_snapshots:=private.weekly_need_check(p_plan_id,p_snapshot_id,p_need_ids); a public.profiles:=private.weekly_mrp_actor(s.project_id); items jsonb; result jsonb; decision uuid; prior uuid;
BEGIN
 SELECT min(d.rfq_id::text)::uuid INTO prior FROM public.weekly_plan_material_needs n JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.id=ANY(p_need_ids) AND d.kind='RFQ';
 IF prior IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.weekly_plan_material_needs n LEFT JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.id=ANY(p_need_ids) AND d.rfq_id IS DISTINCT FROM prior) THEN RAISE EXCEPTION 'Some needs already have a procurement decision; review existing documents'; END IF;
  RETURN (SELECT jsonb_build_object('id',id,'code',code) FROM public.rfqs WHERE id=prior AND empresa_id=s.empresa_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_plan_material_needs n JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id JOIN public.authorized_orders o ON o.direct_purchase_preview_id=d.direct_purchase_preview_id WHERE n.id=ANY(p_need_ids)) THEN RAISE EXCEPTION 'Need already ordered'; END IF;
 SELECT jsonb_agg(jsonb_build_object('producto_id',p.id,'descripcion',p.nombre,'cantidad',n.quantity,'unidad',p.unidad) ORDER BY p.id) INTO items FROM public.weekly_plan_material_needs n JOIN public.productos p ON p.id=n.producto_id AND p.empresa_id=s.empresa_id WHERE n.id=ANY(p_need_ids);
 result:=public.rfq_create(jsonb_build_object('specifications',p_header->>'specifications','internal_reference',p_header->>'internal_reference','observations',p_header->>'observations')||jsonb_build_object('purpose','PROCUREMENT','quote_type','RFQ','project_id',s.project_id,'required_date',s.needed_by,'product','Necesidad del plan semanal','quantity',1,'unit','lote'),items,'{}'::uuid[]);
 INSERT INTO public.weekly_plan_need_decisions(snapshot_id,empresa_id,kind,rfq_id,need_ids,seen_reference,created_by) VALUES(s.id,s.empresa_id,'RFQ',(result->>'id')::uuid,p_need_ids,coalesce(p_seen,'{}'),a.id) RETURNING id INTO decision;
 UPDATE public.weekly_plan_material_needs SET decision_id=decision,updated_at=now() WHERE id=ANY(p_need_ids);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.weekly_plan_need_rfq(uuid,uuid,uuid[],jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.weekly_plan_need_rfq(uuid,uuid,uuid[],jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.weekly_plan_need_direct_preview(p_plan_id uuid,p_snapshot_id uuid,p_need_ids uuid[],p_header jsonb,p_items jsonb,p_seen jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.weekly_plan_need_snapshots:=private.weekly_need_check(p_plan_id,p_snapshot_id,p_need_ids); a public.profiles:=private.weekly_mrp_actor(s.project_id); x jsonb; n public.weekly_plan_material_needs; p public.productos; products uuid[]:='{}'; result jsonb; decision uuid;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<>cardinality(p_need_ids) THEN RAISE EXCEPTION 'Direct purchase must refer to the selected needs'; END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_plan_material_needs n JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.id=ANY(p_need_ids) AND (d.kind='RFQ' OR EXISTS(SELECT 1 FROM public.authorized_orders o WHERE o.direct_purchase_preview_id=d.direct_purchase_preview_id))) THEN RAISE EXCEPTION 'Need already has an RFQ or confirmed order'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO n FROM public.weekly_plan_material_needs WHERE id=ANY(p_need_ids) AND producto_id=(x->>'producto_id')::uuid;
  SELECT * INTO p FROM public.productos WHERE id=n.producto_id AND empresa_id=s.empresa_id;
  IF n.id IS NULL OR p.id IS NULL OR n.producto_id=ANY(products) OR (x->>'quantity')::numeric IS NULL OR (x->>'quantity')::numeric<=0 OR (x->>'quantity')::numeric>n.quantity OR coalesce(private.workspace_unit(x->>'unit'),lower(trim(x->>'unit'))) IS DISTINCT FROM coalesce(private.workspace_unit(p.unidad),lower(trim(p.unidad))) THEN RAISE EXCEPTION 'Invalid direct purchase need quantity/unit'; END IF;
  products:=array_append(products,n.producto_id);
 END LOOP;
 -- Same human facts/snapshot retry reuses the canonical preview rather than creating another draft.
 SELECT jsonb_build_object('id',v.id,'hash',v.preview_hash,'snapshot',v.snapshot) INTO result FROM public.weekly_plan_need_decisions d JOIN public.direct_purchase_previews v ON v.id=d.direct_purchase_preview_id WHERE d.snapshot_id=s.id AND d.kind='DIRECT_PURCHASE' AND v.created_by=a.id AND d.request_payload=jsonb_build_object('header',p_header,'items',p_items) AND d.need_ids @> p_need_ids AND d.need_ids <@ p_need_ids AND NOT EXISTS(SELECT 1 FROM public.weekly_plan_material_needs n WHERE n.id=ANY(p_need_ids) AND n.decision_id IS DISTINCT FROM d.id) ORDER BY d.created_at DESC LIMIT 1;
 -- Canonical preview validates supplier, prices, taxes, freight and terms.
 -- A new deliberate preview replaces only the active pointer; the old decision remains immutable.
 IF result IS NULL THEN
  result:=public.direct_purchase_preview(coalesce(p_header,'{}')||jsonb_build_object('project_id',s.project_id),p_items);
  INSERT INTO public.weekly_plan_need_decisions(snapshot_id,empresa_id,kind,direct_purchase_preview_id,need_ids,request_payload,seen_reference,created_by) VALUES(s.id,s.empresa_id,'DIRECT_PURCHASE',(result->>'id')::uuid,coalesce(p_seen,'{}'),a.id) RETURNING id INTO decision;
  UPDATE public.weekly_plan_material_needs SET decision_id=decision,updated_at=now() WHERE id=ANY(p_need_ids);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.weekly_plan_need_direct_preview(uuid,uuid,uuid[],jsonb,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.weekly_plan_need_direct_preview(uuid,uuid,uuid[],jsonb,jsonb,jsonb) TO authenticated;

-- Even a caller of the generic canonical confirm cannot bypass source revalidation.
CREATE FUNCTION private.weekly_need_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.weekly_plan_need_decisions; s public.weekly_plan_need_snapshots; ids uuid[];
BEGIN
 IF NEW.direct_purchase_preview_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO d FROM public.weekly_plan_need_decisions WHERE direct_purchase_preview_id=NEW.direct_purchase_preview_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO s FROM public.weekly_plan_need_snapshots WHERE id=d.snapshot_id;
 SELECT array_agg(id ORDER BY id) INTO ids FROM public.weekly_plan_material_needs WHERE decision_id=d.id;
 IF ids IS NULL OR NOT(ids @> d.need_ids AND ids <@ d.need_ids) THEN RAISE EXCEPTION 'Need preview superseded; use the current human decision' USING ERRCODE='P0409'; END IF;
 PERFORM private.weekly_need_check(s.plan_id,s.id,ids);
 IF NEW.empresa_id<>s.empresa_id OR NEW.project_id IS DISTINCT FROM s.project_id THEN RAISE EXCEPTION 'Need order provenance mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER b08_need_order_guard BEFORE INSERT ON public.authorized_orders FOR EACH ROW EXECUTE FUNCTION private.weekly_need_order_guard();
REVOKE ALL ON FUNCTION private.weekly_need_order_guard() FROM PUBLIC,anon,authenticated,service_role;
