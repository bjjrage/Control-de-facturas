-- ============================================================================
-- 20260918000003_mrp_final_integrity.sql
-- Hardening final MRP (P1-1, P1-2 parcial DB, P1-3):
-- 1. P1-1: unicidad de idempotency SOLO entre ACTIVE (los RELEASED históricos
--    pueden repetir key; el replace ya no viola unique en re-commits).
-- 2. P1-3: RPCs mutantes MRP/receta SERVER-ONLY: REVOKE EXECUTE a
--    authenticated (solo service_role). Reciben empresa/actor explícitos y
--    validan rol administracion/admin porque service_role no depende de RLS.
-- Forward-only. No toca el motor weekly ni flujos legacy.
-- ============================================================================

-- 1. Idempotencia solo entre ACTIVE.
DROP INDEX IF EXISTS public.uq_inventory_reservations_idem;
CREATE UNIQUE INDEX uq_inventory_reservations_idem
  ON public.inventory_reservations (empresa_id, idempotency_key)
  WHERE status = 'ACTIVE' AND idempotency_key IS NOT NULL;

-- 2. Revocar las firmas viejas (con current_empresa_id implícito) y
-- recrearlas explícitas. DROP primero para no dejar overloads ambiguos.
DROP FUNCTION IF EXISTS public.reserve_plan_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.release_plan_reservations(UUID);
DROP FUNCTION IF EXISTS public.save_production_recipe_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.commit_production_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID, UUID, JSONB, DATE, TEXT);

-- Helper interno: valida empresa + actor con rol interno.
CREATE OR REPLACE FUNCTION public.assert_mrp_actor(
  p_empresa_id UUID,
  p_actor_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  PERFORM 1 FROM public.empresas WHERE id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa no encontrada';
  END IF;

  SELECT role INTO v_role FROM public.profiles
    WHERE id = p_actor_id AND empresa_id = p_empresa_id;
  IF NOT FOUND OR v_role IS NULL THEN
    RAISE EXCEPTION 'Actor sin perfil en la empresa (tenant fail-closed)';
  END IF;
  IF v_role NOT IN ('administracion', 'admin') THEN
    RAISE EXCEPTION 'Actor sin rol requerido para MRP';
  END IF;

  RETURN p_empresa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_mrp_actor(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_mrp_actor(UUID, UUID) TO service_role;

-- 3. reserve_plan_stock explícita (empresa/actor primero).
CREATE OR REPLACE FUNCTION public.reserve_plan_stock(
  p_empresa_id UUID,
  p_actor_id UUID,
  p_project_id UUID,
  p_plan_id UUID,
  p_location_id UUID,
  p_items JSONB,
  p_needed_by DATE,
  p_idempotency_key TEXT,
  p_replace BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    PERFORM 1 FROM public.inventory_balances
      WHERE empresa_id = v_empresa_id AND location_id = p_location_id AND producto_id = v_prod
      FOR UPDATE;

    PERFORM 1 FROM public.inventory_reservations
      WHERE empresa_id = v_empresa_id AND location_id = p_location_id
        AND producto_id = v_prod AND status = 'ACTIVE'
      FOR UPDATE;
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

REVOKE ALL ON FUNCTION public.reserve_plan_stock(UUID, UUID, UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_plan_stock(UUID, UUID, UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN) TO service_role;

-- 4. release explícito.
CREATE OR REPLACE FUNCTION public.release_plan_reservations(
  p_empresa_id UUID,
  p_actor_id UUID,
  p_plan_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := public.assert_mrp_actor(p_empresa_id, p_actor_id);
  v_count INTEGER := 0;
BEGIN
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

REVOKE ALL ON FUNCTION public.release_plan_reservations(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_plan_reservations(UUID, UUID, UUID) TO service_role;

-- 5. save receta explícito.
CREATE OR REPLACE FUNCTION public.save_production_recipe_atomic(
  p_empresa_id UUID,
  p_actor_id UUID,
  p_recipe_id UUID,
  p_project_id UUID,
  p_code TEXT,
  p_name TEXT,
  p_production_unit TEXT,
  p_description TEXT,
  p_contract_total_quantity NUMERIC,
  p_source_type TEXT,
  p_source_file_name TEXT,
  p_components JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := public.assert_mrp_actor(p_empresa_id, p_actor_id);
  v_recipe_id UUID;
  v_item JSONB;
  v_item_id UUID;
  v_qty NUMERIC;
  v_count INTEGER;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'Código de receta requerido';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Nombre de receta requerido';
  END IF;
  IF p_production_unit IS NULL OR btrim(p_production_unit) = '' THEN
    RAISE EXCEPTION 'Unidad de producción requerida';
  END IF;
  IF p_source_type NOT IN ('EXCEL', 'BIM', 'MANUAL') THEN
    RAISE EXCEPTION 'source_type inválido';
  END IF;

  PERFORM 1 FROM public.projects
    WHERE id = p_project_id AND empresa_id = v_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto no encontrado o sin permisos';
  END IF;

  IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN
    RAISE EXCEPTION 'La receta necesita al menos un componente';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    v_item_id := NULLIF(v_item ->> 'budget_item_id', '')::uuid;
    v_qty := NULLIF(v_item ->> 'quantity_per_unit', '')::numeric;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Componente sin partida válida';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad por unidad debe ser > 0';
    END IF;
    SELECT COUNT(*) INTO v_count FROM public.budget_items bi
      JOIN public.projects p ON p.id = bi.project_id
      WHERE bi.id = v_item_id
        AND bi.project_id = p_project_id
        AND p.empresa_id = v_empresa_id;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Partida no pertenece a este proyecto/empresa: %', v_item_id;
    END IF;
  END LOOP;

  IF p_recipe_id IS NOT NULL THEN
    SELECT id INTO v_recipe_id FROM public.production_recipes
      WHERE id = p_recipe_id AND project_id = p_project_id AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Receta no encontrada o sin permisos';
    END IF;
    UPDATE public.production_recipes SET
      code = btrim(p_code),
      name = btrim(p_name),
      production_unit = btrim(p_production_unit),
      description = NULLIF(btrim(COALESCE(p_description, '')), ''),
      contract_total_quantity = p_contract_total_quantity,
      source_type = p_source_type,
      source_file_name = NULLIF(btrim(COALESCE(p_source_file_name, '')), ''),
      updated_at = now()
      WHERE id = v_recipe_id;
    DELETE FROM public.production_recipe_components WHERE recipe_id = v_recipe_id;
  ELSE
    INSERT INTO public.production_recipes
      (empresa_id, project_id, code, name, production_unit, description,
       contract_total_quantity, source_type, source_file_name, active, created_by)
    VALUES
      (v_empresa_id, p_project_id, btrim(p_code), btrim(p_name), btrim(p_production_unit),
       NULLIF(btrim(COALESCE(p_description, '')), ''),
       p_contract_total_quantity, p_source_type,
       NULLIF(btrim(COALESCE(p_source_file_name, '')), ''), true, p_actor_id)
    RETURNING id INTO v_recipe_id;
  END IF;

  INSERT INTO public.production_recipe_components
    (recipe_id, budget_item_id, quantity_per_production_unit, unit, sort_order)
  SELECT
    v_recipe_id,
    (v ->> 'budget_item_id')::uuid,
    (v ->> 'quantity_per_unit')::numeric,
    COALESCE(NULLIF(btrim(v ->> 'unit'), ''), 'unid'),
    (row_number() OVER ())::integer - 1
  FROM jsonb_array_elements(p_components) WITH ORDINALITY AS t(v, ord)
  ORDER BY ord;

  RETURN jsonb_build_object('recipe_id', v_recipe_id, 'status', 'SUCCESS');
END;
$$;

REVOKE ALL ON FUNCTION public.save_production_recipe_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_production_recipe_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;

-- 6. Commit MRP explícito: fija contexto actor/empresa para el anidado legacy.
CREATE OR REPLACE FUNCTION public.commit_production_plan_atomic(
  p_empresa_id UUID,
  p_actor_id UUID,
  p_plan_id UUID,
  p_project_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_status TEXT,
  p_notes TEXT,
  p_items JSONB,
  p_weather_snapshot_batch_id UUID,
  p_location_id UUID,
  p_reserve_items JSONB,
  p_needed_by DATE,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := public.assert_mrp_actor(p_empresa_id, p_actor_id);
  v_saved JSONB;
  v_new_plan_id UUID;
BEGIN
  IF p_status IS DISTINCT FROM 'COMMITTED' THEN
    RAISE EXCEPTION 'commit_production_plan_atomic solo admite status COMMITTED';
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

  SELECT public.save_weekly_plan_atomic(
    p_plan_id, p_project_id, p_start_date, p_end_date,
    p_status, p_notes, p_items, p_weather_snapshot_batch_id
  ) INTO v_saved;
  v_new_plan_id := (v_saved ->> 'plan_id')::uuid;
  IF v_new_plan_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo persistir el plan semanal';
  END IF;

  IF p_location_id IS NOT NULL THEN
    PERFORM public.reserve_plan_stock(
      v_empresa_id, p_actor_id, p_project_id, v_new_plan_id, p_location_id,
      COALESCE(p_reserve_items, '[]'::jsonb),
      p_needed_by, p_idempotency_key || ':' || v_new_plan_id::text, true
    );
  END IF;

  RETURN jsonb_build_object('plan_id', v_new_plan_id, 'status', 'SUCCESS');
END;
$$;

REVOKE ALL ON FUNCTION public.commit_production_plan_atomic(UUID, UUID, UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID, UUID, JSONB, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_production_plan_atomic(UUID, UUID, UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID, UUID, JSONB, DATE, TEXT) TO service_role;
