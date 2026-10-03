-- A confirmed partial purchase cannot permanently hide a newly verified residual shortage.
-- Earlier decisions and snapshots stay immutable and queryable; no documents are created here.
CREATE OR REPLACE FUNCTION public.weekly_plan_refresh_needs(p_actor_id uuid,p_plan_id uuid,p_hash text,p_needed_by date,p_lines jsonb,p_seen jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  ON CONFLICT(plan_id,producto_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,quantity=excluded.quantity,
   decision_id=CASE WHEN excluded.snapshot_id<>weekly_plan_material_needs.snapshot_id AND excluded.quantity>0
    AND EXISTS(SELECT 1 FROM public.weekly_plan_need_decisions d JOIN public.direct_purchase_previews v ON v.id=d.direct_purchase_preview_id WHERE d.id=weekly_plan_material_needs.decision_id AND v.order_id IS NOT NULL)
    THEN NULL ELSE weekly_plan_material_needs.decision_id END,updated_at=now();
 END LOOP;
 UPDATE public.weekly_plan_material_needs SET quantity=0,snapshot_id=sid,updated_at=now() WHERE plan_id=w.id AND NOT(producto_id=ANY(seen));
 RETURN jsonb_build_object('snapshot_id',sid,'hash',p_hash,'history',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('order_id',v.order_id) ORDER BY d.created_at,d.id) FROM public.weekly_plan_need_decisions d JOIN public.weekly_plan_need_snapshots sn ON sn.id=d.snapshot_id LEFT JOIN public.direct_purchase_previews v ON v.id=d.direct_purchase_preview_id WHERE sn.plan_id=w.id),'[]'::jsonb),'needs',coalesce((SELECT jsonb_agg(to_jsonb(n)||jsonb_build_object('decision',CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d)||jsonb_build_object('order_id',(SELECT order_id FROM public.direct_purchase_previews WHERE id=d.direct_purchase_preview_id)) END) ORDER BY n.producto_id) FROM public.weekly_plan_material_needs n LEFT JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.plan_id=w.id),'[]'::jsonb));
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['weekly_plan_need_snapshots','weekly_plan_need_decisions','weekly_plan_material_needs'] LOOP
  EXECUTE format('DROP POLICY b08_need_read ON public.%I',t);
  EXECUTE format('CREATE POLICY b08_need_read ON public.%I FOR SELECT TO authenticated USING(empresa_id=(SELECT public.current_empresa_id()) AND EXISTS(SELECT 1 FROM public.profiles a JOIN public.empresas e ON e.id=a.empresa_id WHERE a.id=(SELECT auth.uid()) AND a.active AND e.active AND a.role IN(''admin'',''administracion'') AND (a.is_super_admin OR e.plan IN(''pro'',''caterpillar''))))',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION "public"."reserve_plan_stock"("p_empresa_id" "uuid", "p_actor_id" "uuid", "p_project_id" "uuid", "p_plan_id" "uuid", "p_location_id" "uuid", "p_items" "jsonb", "p_needed_by" "date", "p_idempotency_key" "text", "p_replace" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_empresa_id UUID := public.assert_mrp_actor(p_empresa_id, p_actor_id);
  v_item JSONB;
  v_prod UUID;
  v_qty NUMERIC;
  v_fisico NUMERIC;
  v_reservado NUMERIC;
  v_disp NUMERIC;
  v_key TEXT;
  v_existing UUID;
  v_short JSONB := '[]'::jsonb;
BEGIN
  PERFORM private.weekly_mrp_lock(v_empresa_id);
  PERFORM 1 FROM public.projects
    WHERE id = p_project_id AND empresa_id = v_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto no encontrado o sin permisos';
  END IF;

  PERFORM 1 FROM public.inventory_locations
    WHERE id = p_location_id AND empresa_id = v_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Depósito no encontrado o sin permisos';
  END IF;

  IF p_plan_id IS NOT NULL THEN
    PERFORM 1 FROM public.project_weekly_plans
      WHERE id = p_plan_id AND empresa_id = v_empresa_id AND project_id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Plan no encontrado o sin permisos';
    END IF;
    IF p_replace THEN
      UPDATE public.inventory_reservations
        SET status = 'RELEASED', released_at = now()
        WHERE weekly_plan_id = p_plan_id AND status = 'ACTIVE' AND empresa_id = v_empresa_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_prod := NULLIF(v_item ->> 'producto_id', '')::uuid;
    v_qty := NULLIF(v_item ->> 'quantity', '')::numeric;
    IF v_prod IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty >= 1e16 THEN
      RAISE EXCEPTION 'Invalid physical reservation';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_empresa_id::text || ':' || v_prod::text || ':' || p_location_id::text));

    PERFORM 1 FROM public.productos
      WHERE id = v_prod AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado o sin permisos';
    END IF;

    IF p_plan_id IS NOT NULL THEN
      SELECT id INTO v_existing FROM public.inventory_reservations
        WHERE weekly_plan_id = p_plan_id AND producto_id = v_prod
          AND location_id = p_location_id AND status = 'ACTIVE'
          AND empresa_id = v_empresa_id
        LIMIT 1;
      IF FOUND THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO v_fisico
      FROM public.inventory_balances
      WHERE empresa_id = v_empresa_id AND location_id = p_location_id AND producto_id = v_prod;

    SELECT COALESCE(SUM(quantity), 0) INTO v_reservado
      FROM public.inventory_reservations
      WHERE empresa_id = v_empresa_id AND location_id = p_location_id
        AND producto_id = v_prod AND status = 'ACTIVE';

    v_disp := v_fisico - v_reservado;
    IF v_disp < v_qty THEN
      v_short := v_short || jsonb_build_object(
        'producto_id', v_prod, 'solicitado', v_qty, 'disponible', v_disp
      );
    ELSE
      v_key := CASE WHEN p_idempotency_key IS NULL THEN NULL
        ELSE p_idempotency_key || ':' || v_prod::text END;
      INSERT INTO public.inventory_reservations
        (empresa_id, location_id, producto_id, project_id, weekly_plan_id,
         quantity, status, needed_by_date, idempotency_key, created_by)
      VALUES
        (v_empresa_id, p_location_id, v_prod, p_project_id, p_plan_id,
         v_qty, 'ACTIVE', p_needed_by, v_key, p_actor_id);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_short) > 0 THEN
    RAISE EXCEPTION 'Stock central insuficiente: %', v_short::text;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;



