-- ============================================================================
-- 20260918000004_mrp_lifecycle_atomic.sql
-- Lifecycle atómico de reservas (P1-2 hardening final):
-- commit_production_plan_atomic ahora cubre TODOS los status en UNA
-- transacción: save plan/items + (COMMITTED: replace+reserve | otro:
-- release ACTIVE del plan). Sin save-then-release en dos txns.
-- Forward-only. No toca el motor weekly ni flujos legacy.
-- ============================================================================

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
  IF p_plan_id IS NOT NULL THEN
    UPDATE public.inventory_reservations
      SET status = 'RELEASED', released_at = now()
      WHERE weekly_plan_id = p_plan_id
        AND status = 'ACTIVE'
        AND empresa_id = v_empresa_id;
  END IF;

  IF p_status = 'COMMITTED' AND p_location_id IS NOT NULL THEN
    -- Reemplazo atómico: reserva las nuevas (o falla todo).
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
