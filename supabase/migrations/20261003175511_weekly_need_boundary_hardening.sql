-- Preserve applied migrations. Resolve SQL alias ambiguity and order stock/reservation serialization.
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
  INSERT INTO public.weekly_plan_need_decisions(snapshot_id,empresa_id,kind,direct_purchase_preview_id,need_ids,request_payload,seen_reference,created_by) VALUES(s.id,s.empresa_id,'DIRECT_PURCHASE',(result->>'id')::uuid,coalesce(p_seen,'{}'),a.id) RETURNING id INTO decision;
  UPDATE public.weekly_plan_material_needs SET decision_id=decision,updated_at=now() WHERE id=ANY(p_need_ids);
 END IF;
 RETURN result;
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
    IF v_prod IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
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



CREATE OR REPLACE FUNCTION "public"."release_plan_reservations"("p_empresa_id" "uuid", "p_actor_id" "uuid", "p_plan_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_empresa_id UUID := public.assert_mrp_actor(p_empresa_id, p_actor_id);
  v_count INTEGER := 0;
BEGIN
  PERFORM private.weekly_mrp_lock(p_empresa_id);
  PERFORM 1 FROM public.project_weekly_plans
    WHERE id = p_plan_id AND empresa_id = v_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan no encontrado o sin permisos';
  END IF;

  UPDATE public.inventory_reservations
    SET status = 'RELEASED', released_at = now()
    WHERE weekly_plan_id = p_plan_id AND status = 'ACTIVE' AND empresa_id = v_empresa_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'released', v_count);
END;
$$;


