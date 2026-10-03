-- Align persisted target capping with the existing certificate baseline + daily delta loader.
CREATE FUNCTION private.weekly_executed_quantity(pid uuid,bid uuid) RETURNS numeric LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 WITH baseline AS(SELECT id,period_end FROM public.project_certificates WHERE project_id=pid AND period_end IS NOT NULL ORDER BY period_end DESC,numero DESC,id LIMIT 1),
 mapped AS(SELECT i.qty_acumulada FROM public.project_certificate_items i JOIN baseline c ON c.id=i.certificate_id JOIN public.budget_items b ON b.id=bid AND b.project_id=pid WHERE i.budget_item_id=bid OR (NOT EXISTS(SELECT 1 FROM public.budget_items q WHERE q.id=i.budget_item_id AND q.project_id=pid) AND lower(trim(i.codigo))=lower(trim(b.code)) AND (SELECT count(*) FROM public.budget_items q WHERE q.project_id=pid AND lower(trim(q.code))=lower(trim(i.codigo)))=1))
 SELECT coalesce((SELECT sum(qty_acumulada) FROM mapped),0)+coalesce((SELECT sum(quantity_executed) FROM public.execution_entries WHERE project_id=pid AND budget_item_id=bid AND (NOT EXISTS(SELECT 1 FROM baseline) OR entry_date>(SELECT period_end FROM baseline))),0);
$$;
REVOKE ALL ON FUNCTION private.weekly_executed_quantity(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
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
      SELECT coalesce(jsonb_agg(jsonb_build_object('budget_item_id',i.budget_item_id,'front_label',nullif(trim(i.front_label),''),'input_mode',i.input_mode,'input_value',i.input_value,'unit',i.unit) ORDER BY i.budget_item_id,coalesce(i.front_label,''),i.input_mode,i.input_value),'[]') INTO logical_items FROM public.project_weekly_plan_items i WHERE plan_id=prior.id;
      IF logical_items IS DISTINCT FROM (SELECT coalesce(jsonb_agg(jsonb_build_object('budget_item_id',(x->>'budget_item_id')::uuid,'front_label',nullif(trim(x->>'front_label'),''),'input_mode',x->>'input_mode','input_value',(x->>'input_value')::numeric,'unit',x->>'unit') ORDER BY x->>'budget_item_id',coalesce(x->>'front_label',''),x->>'input_mode',(x->>'input_value')::numeric),'[]') FROM jsonb_array_elements(p_items) x WHERE (x->>'input_value')::numeric>0) OR prior.status<>p_status OR prior.notes IS DISTINCT FROM p_notes OR (p_weather_snapshot_batch_id IS NOT NULL AND prior.weather_snapshot_batch_id IS DISTINCT FROM p_weather_snapshot_batch_id) THEN RAISE EXCEPTION 'A plan already exists for this actor and period; reload before editing' USING ERRCODE='P0409'; END IF;
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
      greatest(0, coalesce(b.quantity, 0) - coalesce(sum(ee.quantity_executed), 0))
    FROM (
      SELECT DISTINCT (elem->>'budget_item_id')::UUID AS b_id
      FROM jsonb_array_elements(p_items) elem
      WHERE (elem->>'budget_item_id') IS NOT NULL
    ) raw_ids
    JOIN public.budget_items b ON b.id = raw_ids.b_id AND b.project_id = p_project_id
    LEFT JOIN public.execution_entries ee ON ee.budget_item_id = b.id AND ee.project_id = p_project_id
    GROUP BY b.id, b.quantity
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


CREATE OR REPLACE FUNCTION "public"."commit_production_plan_atomic"("p_empresa_id" "uuid", "p_actor_id" "uuid", "p_plan_id" "uuid", "p_project_id" "uuid", "p_start_date" "date", "p_end_date" "date", "p_status" "text", "p_notes" "text", "p_items" "jsonb", "p_weather_snapshot_batch_id" "uuid", "p_location_id" "uuid", "p_reserve_items" "jsonb", "p_needed_by" "date", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_empresa_id UUID := public.assert_mrp_actor(p_empresa_id, p_actor_id);
  v_saved JSONB;
  v_new_plan_id UUID;
BEGIN
  IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  PERFORM private.weekly_mrp_lock(v_empresa_id);
  IF p_status NOT IN ('DRAFT', 'COMMITTED', 'CLOSED') THEN
    RAISE EXCEPTION 'status inválido para commit MRP: %', p_status;
  END IF;

  PERFORM 1 FROM public.projects
    WHERE id = p_project_id AND empresa_id = v_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto no encontrado o sin permisos';
  END IF;

  IF p_location_id IS NOT NULL THEN
    PERFORM 1 FROM public.inventory_locations
      WHERE id = p_location_id AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Depósito no encontrado o sin permisos';
    END IF;
  END IF;

  -- Contexto JWT para el anidado legacy (save_weekly_plan_atomic usa
  -- current_empresa_id(); el actor ya fue validado arriba).
  PERFORM set_config('request.jwt.claim.sub', p_actor_id::text, true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','service_role')::text,true);

  -- 1) Plan + targets (misma RPC certificada).
  SELECT public.save_weekly_plan_atomic(
    p_plan_id, p_project_id, p_start_date, p_end_date,
    p_status, p_notes, p_items, p_weather_snapshot_batch_id
  ) INTO v_saved;
  v_new_plan_id := (v_saved ->> 'plan_id')::uuid;
  IF v_new_plan_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo persistir el plan semanal';
  END IF;

  -- 2) Lifecycle de reservas EN LA MISMA transacción.
  -- Orden: primero liberar lo retenido (si el save falla después, el
  -- ROLLBACK lo restaura: rollback total probado en tests).
  IF v_new_plan_id IS NOT NULL THEN
    UPDATE public.inventory_reservations
      SET status = 'RELEASED', released_at = now()
      WHERE weekly_plan_id = v_new_plan_id
        AND status = 'ACTIVE'
        AND empresa_id = v_empresa_id;
  END IF;

  IF p_status = 'COMMITTED' AND p_location_id IS NOT NULL THEN
    -- Reemplazo atómico: reserva las nuevas (o falla todo).
    PERFORM public.reserve_plan_stock(
      v_empresa_id, p_actor_id, p_project_id, v_new_plan_id, p_location_id,
      COALESCE(p_reserve_items, '[]'::jsonb),
      p_needed_by, coalesce(p_idempotency_key,'weekly') || ':' || v_new_plan_id::text, true
    );
  END IF;

  RETURN jsonb_build_object('plan_id', v_new_plan_id, 'status', 'SUCCESS');
END;
$$;



REVOKE INSERT,UPDATE,DELETE ON public.project_weekly_plans,public.project_weekly_plan_items FROM anon,authenticated;

CREATE FUNCTION private.weekly_recipe_unit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.budget_items; r public.production_recipes;
BEGIN
 SELECT * INTO b FROM public.budget_items WHERE id=NEW.budget_item_id;
 SELECT * INTO r FROM public.production_recipes WHERE id=NEW.recipe_id;
 IF b.id IS NULL OR r.id IS NULL OR b.project_id IS DISTINCT FROM r.project_id
 OR NEW.quantity_per_production_unit IS NULL OR NEW.quantity_per_production_unit<=0 OR NEW.quantity_per_production_unit>=1e16
 OR nullif(trim(NEW.unit),'') IS NULL OR coalesce(private.workspace_unit(NEW.unit),lower(trim(NEW.unit))) IS DISTINCT FROM coalesce(private.workspace_unit(b.unit),lower(trim(b.unit))) THEN
  RAISE EXCEPTION 'Invalid production component context, ratio or unit';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.weekly_recipe_unit_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER b08_recipe_unit_guard BEFORE INSERT OR UPDATE ON public.production_recipe_components FOR EACH ROW EXECUTE FUNCTION private.weekly_recipe_unit_guard();
