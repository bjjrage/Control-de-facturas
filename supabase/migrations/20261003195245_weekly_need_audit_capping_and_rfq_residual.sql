-- External audit P1-A/P1-B: canonical certificate capping and RFQ residual lifecycle.
-- No backfill, historical rewrites or automatic procurement. Existing RPC ACLs preserved.
-- Front order changes sequential capping: only identical ordered targets are retries.
CREATE OR REPLACE FUNCTION "public"."save_weekly_plan_atomic"("p_plan_id" "uuid", "p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_status" "text", "p_notes" "text", "p_items" "jsonb", "p_weather_snapshot_batch_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_position integer:=0;
  v_empresa_id UUID;
  actor public.profiles;
  prior public.project_weekly_plans;
  logical_items jsonb;
  v_plan_id UUID;
  v_item JSONB;
  v_budget_item_id UUID;
  v_front_label TEXT;
  v_input_mode TEXT;
  v_input_value NUMERIC;
  v_nominal_qty NUMERIC;
  v_target_qty NUMERIC;
  v_remaining_qty NUMERIC;
  v_unit TEXT;
  v_exists BOOLEAN;
  v_contractual_qty NUMERIC;
  v_executed_qty NUMERIC;
BEGIN

  actor:=private.weekly_mrp_actor(p_project_id); v_empresa_id:=actor.empresa_id;
  PERFORM private.weekly_mrp_lock(v_empresa_id);
  actor:=private.weekly_mrp_actor(p_project_id);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<p_start_date OR p_status IS NULL OR p_status NOT IN('DRAFT','COMMITTED','CLOSED') OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>50000 THEN RAISE EXCEPTION 'Invalid weekly plan input'; END IF;
  IF coalesce(auth.jwt()->>'role','')<>'service_role' AND (p_status<>'DRAFT' OR EXISTS(SELECT 1 FROM public.inventory_reservations WHERE weekly_plan_id=p_plan_id AND status='ACTIVE')) THEN RAISE EXCEPTION 'Reservation lifecycle requires server action' USING ERRCODE='42501'; END IF;
  IF p_plan_id IS NULL THEN
    SELECT * INTO prior FROM public.project_weekly_plans WHERE project_id=p_project_id AND empresa_id=v_empresa_id AND start_date=p_start_date AND end_date=p_end_date AND created_by=actor.id ORDER BY created_at LIMIT 1;
    IF FOUND THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('budget_item_id',i.budget_item_id,'front_label',nullif(trim(i.front_label),''),'input_mode',i.input_mode,'input_value',i.input_value,'unit',i.unit) ORDER BY i.position,i.created_at,i.id),'[]') INTO logical_items FROM public.project_weekly_plan_items i WHERE plan_id=prior.id;
      IF logical_items IS DISTINCT FROM (SELECT coalesce(jsonb_agg(jsonb_build_object('budget_item_id',(x->>'budget_item_id')::uuid,'front_label',nullif(trim(x->>'front_label'),''),'input_mode',x->>'input_mode','input_value',(x->>'input_value')::numeric,'unit',x->>'unit') ORDER BY ordinal),'[]') FROM jsonb_array_elements(p_items) WITH ORDINALITY payload(x,ordinal) WHERE (x->>'input_value')::numeric>0) OR prior.status<>p_status OR prior.notes IS DISTINCT FROM p_notes OR (p_weather_snapshot_batch_id IS NOT NULL AND prior.weather_snapshot_batch_id IS DISTINCT FROM p_weather_snapshot_batch_id) THEN RAISE EXCEPTION 'A plan already exists for this actor and period; reload before editing' USING ERRCODE='P0409'; END IF;
      RETURN jsonb_build_object('plan_id',prior.id,'status','SUCCESS');
    END IF;
  END IF;
  -- Validar o crear cabecera del plan
  IF p_plan_id IS NOT NULL THEN
    SELECT id INTO v_plan_id
    FROM public.project_weekly_plans
    WHERE id = p_plan_id AND empresa_id = v_empresa_id AND project_id=p_project_id FOR UPDATE;

    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'Plan semanal % no encontrado o sin permisos.', p_plan_id;
    END IF;

    UPDATE public.project_weekly_plans
    SET start_date = p_start_date,
        end_date = p_end_date,
        status = p_status,
        notes = p_notes,
        weather_snapshot_batch_id = coalesce(p_weather_snapshot_batch_id, weather_snapshot_batch_id),
        updated_at = now()
    WHERE id = v_plan_id;
  ELSE
    INSERT INTO public.project_weekly_plans (
      empresa_id,
      project_id,
      start_date,
      end_date,
      status,
      notes,
      weather_snapshot_batch_id,
      created_by
    ) VALUES (
      v_empresa_id,
      p_project_id,
      p_start_date,
      p_end_date,
      p_status,
      p_notes,
      p_weather_snapshot_batch_id,
      auth.uid()
    ) RETURNING id INTO v_plan_id;
  END IF;

  -- Asegurar limpieza de tabla temporal en llamadas repetidas dentro de la misma transacción
  DROP TABLE IF EXISTS tmp_item_budget_tracking;
  CREATE TEMP TABLE tmp_item_budget_tracking (
    budget_item_id UUID PRIMARY KEY,
    contractual_qty NUMERIC,
    executed_qty NUMERIC,
    remaining_qty NUMERIC
  ) ON COMMIT DROP;

  -- Pre-cargar partidas referenciadas en el payload para controlar capping multi-frente
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    INSERT INTO tmp_item_budget_tracking (budget_item_id, contractual_qty, executed_qty, remaining_qty)
    SELECT
      b.id,
      coalesce(b.quantity, 0),
      private.weekly_executed_quantity(p_project_id,b.id),
      greatest(0, coalesce(b.quantity, 0) - private.weekly_executed_quantity(p_project_id,b.id))
    FROM (
      SELECT DISTINCT (elem->>'budget_item_id')::UUID AS b_id
      FROM jsonb_array_elements(p_items) elem
      WHERE (elem->>'budget_item_id') IS NOT NULL
    ) raw_ids
    JOIN public.budget_items b ON b.id = raw_ids.b_id AND b.project_id = p_project_id
    ON CONFLICT (budget_item_id) DO NOTHING;
  END IF;

  -- Eliminar items actuales del plan dentro de la misma transacción
  DELETE FROM public.project_weekly_plan_items
  WHERE plan_id = v_plan_id;

  -- Insertar items validados y calcular target_quantity contractual
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_position:=v_position+1;
      v_budget_item_id := (v_item->>'budget_item_id')::UUID;
      v_front_label := NULLIF(trim(v_item->>'front_label'), '');
      v_input_mode := v_item->>'input_mode';
      v_input_value := (v_item->>'input_value')::NUMERIC;
      v_unit := v_item->>'unit';
      IF v_budget_item_id IS NULL OR v_input_mode IS NULL OR v_input_value IS NULL OR v_input_value<0 OR v_input_value>=1e16 OR NOT EXISTS(SELECT 1 FROM public.budget_items b WHERE b.id=v_budget_item_id AND b.project_id=p_project_id AND coalesce(private.workspace_unit(b.unit),lower(trim(b.unit))) IS NOT DISTINCT FROM coalesce(private.workspace_unit(v_unit),lower(trim(v_unit))) AND nullif(trim(v_unit),'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.budget_items child WHERE child.project_id=p_project_id AND (child.parent_id=b.id OR (NOT EXISTS(SELECT 1 FROM public.budget_items q WHERE q.project_id=p_project_id AND q.parent_id IS NOT NULL) AND child.code LIKE b.code||'.%')))) THEN RAISE EXCEPTION 'Invalid or non-leaf target/unit'; END IF;

      -- Validar que la partida pertenece a este proyecto
      IF NOT EXISTS (
        SELECT 1 FROM tmp_item_budget_tracking
        WHERE budget_item_id = v_budget_item_id
      ) THEN
        RAISE EXCEPTION 'La partida % no pertenece al proyecto %.', v_budget_item_id, p_project_id;
      END IF;

      -- Validar input_mode
      IF v_input_mode NOT IN ('QUANTITY', 'CONTRACT_PERCENTAGE_POINTS') THEN
        RAISE EXCEPTION 'Modo de entrada inválido: %', v_input_mode;
      END IF;

      -- Validar input_value
      IF v_input_value < 0 THEN
        RAISE EXCEPTION 'El valor de meta no puede ser negativo: %', v_input_value;
      END IF;

      IF v_input_value > 0 THEN
        SELECT contractual_qty, remaining_qty
        INTO v_contractual_qty, v_remaining_qty
        FROM tmp_item_budget_tracking
        WHERE budget_item_id = v_budget_item_id;

        -- Conversión semántica de target_quantity
        IF v_input_mode = 'CONTRACT_PERCENTAGE_POINTS' THEN
          v_nominal_qty := v_contractual_qty * (v_input_value / 100.0);
        ELSE
          v_nominal_qty := v_input_value;
        END IF;

        -- Capping por remanente disponible (para frentes acumulados)
        v_target_qty := greatest(0, least(v_nominal_qty, v_remaining_qty));

        -- Reducir el saldo remanente disponible para siguientes frentes de la misma partida
        UPDATE tmp_item_budget_tracking
        SET remaining_qty = greatest(0, remaining_qty - v_target_qty)
        WHERE budget_item_id = v_budget_item_id;

        INSERT INTO public.project_weekly_plan_items (
          position,
          plan_id,
          budget_item_id,
          front_label,
          input_mode,
          input_value,
          target_quantity,
          unit
        ) VALUES (
          v_position,
          v_plan_id,
          v_budget_item_id,
          v_front_label,
          v_input_mode,
          v_input_value,
          v_target_qty,
          v_unit
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'plan_id', v_plan_id,
    'status', 'SUCCESS'
  );
END;
$$;


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
   decision_id=CASE WHEN excluded.quantity>0 AND (
    (excluded.snapshot_id<>weekly_plan_material_needs.snapshot_id AND (
      EXISTS(SELECT 1 FROM public.weekly_plan_need_decisions d JOIN public.direct_purchase_previews v ON v.id=d.direct_purchase_preview_id WHERE d.id=weekly_plan_material_needs.decision_id AND v.order_id IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.weekly_plan_need_decisions d JOIN public.authorized_orders o ON o.rfq_id=d.rfq_id OR o.rfq_allocation_id IN(SELECT a.id FROM public.rfq_allocations a WHERE a.rfq_id=d.rfq_id AND a.empresa_id=w.empresa_id) WHERE d.id=weekly_plan_material_needs.decision_id AND o.empresa_id=w.empresa_id AND o.project_id=w.project_id AND o.status='AUTORIZADO')
    ))
    -- Canonical rfq-status.ts: non-bidding, explicit closure or expiry is terminal.
    -- Terminal without OC may have unchanged physical sources: still release on refresh.
    OR EXISTS(SELECT 1 FROM public.weekly_plan_need_decisions d JOIN public.rfqs r ON r.id=d.rfq_id WHERE d.id=weekly_plan_material_needs.decision_id AND r.empresa_id=w.empresa_id AND r.project_id=w.project_id AND (r.closed_at IS NOT NULL OR r.status NOT IN('BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS') OR r.expires_at<=now()))
   ) THEN NULL ELSE weekly_plan_material_needs.decision_id END,updated_at=now();
 END LOOP;
 UPDATE public.weekly_plan_material_needs SET quantity=0,snapshot_id=sid,updated_at=now() WHERE plan_id=w.id AND NOT(producto_id=ANY(seen));
 RETURN jsonb_build_object('snapshot_id',sid,'hash',p_hash,'history',coalesce((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('order_id',v.order_id) ORDER BY d.created_at,d.id) FROM public.weekly_plan_need_decisions d JOIN public.weekly_plan_need_snapshots sn ON sn.id=d.snapshot_id LEFT JOIN public.direct_purchase_previews v ON v.id=d.direct_purchase_preview_id WHERE sn.plan_id=w.id),'[]'::jsonb),'needs',coalesce((SELECT jsonb_agg(to_jsonb(n)||jsonb_build_object('decision',CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d)||jsonb_build_object('order_id',(SELECT order_id FROM public.direct_purchase_previews WHERE id=d.direct_purchase_preview_id)) END) ORDER BY n.producto_id) FROM public.weekly_plan_material_needs n LEFT JOIN public.weekly_plan_need_decisions d ON d.id=n.decision_id WHERE n.plan_id=w.id),'[]'::jsonb));
END $$;

CREATE TRIGGER b08_mrp_source_lock BEFORE INSERT OR UPDATE OR DELETE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION private.weekly_mrp_source_lock();
