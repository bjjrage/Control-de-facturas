-- ============================================================================
-- 20260918000002_mrp_hardening.sql
-- Endurecimiento MRP (P1-3, P1-4, P1-5):
-- 1. inventory_reservations: solo SELECT para authenticated. Toda mutación
--    pasa EXCLUSIVAMENTE por reserve_plan_stock / release_plan_reservations.
-- 2. production_recipes (+components): solo SELECT para authenticated. Toda
--    escritura pasa por save_production_recipe_atomic (transaccional).
-- 3. RPC save_production_recipe_atomic: validación + reemplazo atómico.
-- 4. RPC commit_production_plan_atomic: plan/items + reservas en UNA
--    transacción (compuesta sobre save_weekly_plan_atomic + reserve_plan_stock).
-- Forward-only. No toca el motor weekly ni flujos legacy.
-- ============================================================================

-- 1. Reservas: revocar escritura directa.
REVOKE INSERT, UPDATE, DELETE ON public.inventory_reservations FROM authenticated;

-- 2. Recetas: revocar escritura directa (solo RPC transaccional).
REVOKE INSERT, UPDATE, DELETE ON public.production_recipes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.production_recipe_components FROM authenticated;

-- 3. Guardado atómico de receta: valida todo, reemplaza todo o nada.
CREATE OR REPLACE FUNCTION public.save_production_recipe_atomic(
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
  v_empresa_id UUID := public.current_empresa_id();
  v_recipe_id UUID;
  v_item JSONB;
  v_item_id UUID;
  v_qty NUMERIC;
  v_count INTEGER;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Sin empresa (tenant fail-closed)';
  END IF;

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

  -- Validar TODOS los componentes ANTES de escribir nada: misma empresa,
  -- mismo proyecto, cantidad > 0, sin duplicados.
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
       contract_total_quantity, source_type, source_file_name, active)
    VALUES
      (v_empresa_id, p_project_id, btrim(p_code), btrim(p_name), btrim(p_production_unit),
       NULLIF(btrim(COALESCE(p_description, '')), ''),
       p_contract_total_quantity, p_source_type,
       NULLIF(btrim(COALESCE(p_source_file_name, '')), ''), true)
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
  -- UNIQUE(recipe_id, budget_item_id) aborta duplicados: rollback total.

  RETURN jsonb_build_object('recipe_id', v_recipe_id, 'status', 'SUCCESS');
END;
$$;

REVOKE ALL ON FUNCTION public.save_production_recipe_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_production_recipe_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO authenticated, service_role;

-- 4. Commit MRP en UNA transacción: plan/items (vía save_weekly_plan_atomic)
-- + reservas (vía reserve_plan_stock con replace). Cualquier fallo =>
-- ROLLBACK completo: nunca plan COMMITTED sin reserva ni viceversa.
CREATE OR REPLACE FUNCTION public.commit_production_plan_atomic(
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
  v_empresa_id UUID := public.current_empresa_id();
  v_saved JSONB;
  v_new_plan_id UUID;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Sin empresa (tenant fail-closed)';
  END IF;

  -- Esta RPC es la vía COMMIT MRP: DRAFT no reserva (lifecycle explícito).
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

  -- 1) Plan + targets (misma RPC certificada; valida empresa/fechas/capping).
  SELECT public.save_weekly_plan_atomic(
    p_plan_id, p_project_id, p_start_date, p_end_date,
    p_status, p_notes, p_items, p_weather_snapshot_batch_id
  ) INTO v_saved;
  v_new_plan_id := (v_saved ->> 'plan_id')::uuid;
  IF v_new_plan_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo persistir el plan semanal';
  END IF;

  -- 2) Reservas (misma transacción; replace libera las viejas del plan).
  IF p_location_id IS NOT NULL THEN
    PERFORM public.reserve_plan_stock(
      p_project_id, v_new_plan_id, p_location_id,
      COALESCE(p_reserve_items, '[]'::jsonb),
      p_needed_by, p_idempotency_key || ':' || v_new_plan_id::text, true
    );
  END IF;

  RETURN jsonb_build_object('plan_id', v_new_plan_id, 'status', 'SUCCESS');
END;
$$;

REVOKE ALL ON FUNCTION public.commit_production_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID, UUID, JSONB, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_production_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, JSONB, UUID, UUID, JSONB, DATE, TEXT) TO authenticated, service_role;
