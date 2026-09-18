-- ============================================================================
-- 20260917000005_mrp_reservations.sql
-- MRP de obra: reservas atómicas de stock central + fecha de entrega en OC.
--
-- 1. authorized_order_items.expected_delivery_date (nullable):
--    NULL = fecha no confirmada → ese inbound NO descuenta faltante crítico.
-- 2. inventory_reservations: promesa de stock central para un plan
--    (ACTIVE / RELEASED / CONSUMED). Distinto de transferencia (movimiento).
-- 3. RPC reserve_plan_stock: reserva atómica multi-producto con
--    pg_advisory_xact_lock + FOR UPDATE (nunca stock negativo, nunca doble).
-- 4. RPC release_plan_reservations: liberación por plan (lifecycle).
--
-- Forward-only. No modifica el motor weekly ni el flujo legacy de inbound.
-- ============================================================================

-- 1. Fecha esperada de entrega (NULL = no confirmada).
ALTER TABLE public.authorized_order_items
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE;
CREATE INDEX IF NOT EXISTS idx_aoi_delivery
  ON public.authorized_order_items (empresa_id, expected_delivery_date);

-- 2. Reservas de stock central por plan.
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  weekly_plan_id UUID REFERENCES public.project_weekly_plans(id) ON DELETE CASCADE,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
  needed_by_date DATE,
  idempotency_key TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_reservations_idem
  ON public.inventory_reservations (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_active_lookup
  ON public.inventory_reservations (empresa_id, location_id, producto_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_reservations_plan
  ON public.inventory_reservations (weekly_plan_id)
  WHERE weekly_plan_id IS NOT NULL;

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_reservations_tenant ON public.inventory_reservations;
CREATE POLICY inventory_reservations_tenant ON public.inventory_reservations
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());

REVOKE ALL ON public.inventory_reservations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.inventory_reservations TO authenticated;

-- 3. Reserva atómica: verifica tenant, serializa por producto+depósito,
-- recalcula disponible = físico - ACTIVE, inserta o falla TODO (rollback).
CREATE OR REPLACE FUNCTION public.reserve_plan_stock(
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
  v_empresa_id UUID := public.current_empresa_id();
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
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Sin empresa (tenant fail-closed)';
  END IF;

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
    -- Reemplazo atómico: liberar las ACTIVE de este plan dentro de la misma
    -- transacción (si algo falla después, el ROLLBACK las restaura).
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

    -- Serializar por recurso: dos commits concurrentes no pueden intercalarse.
    PERFORM pg_advisory_xact_lock(hashtext(v_empresa_id::text || ':' || v_prod::text || ':' || p_location_id::text));

    PERFORM 1 FROM public.productos
      WHERE id = v_prod AND empresa_id = v_empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado o sin permisos';
    END IF;

    -- Idempotencia por plan+producto: reintento del mismo plan no duplica.
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

    -- Bloquear filas de reserva existentes (sin agregado: FOR UPDATE no
    -- admite funciones de agregado) y luego sumar lo reservado.
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
         quantity, status, needed_by_date, idempotency_key)
      VALUES
        (v_empresa_id, p_location_id, v_prod, p_project_id, p_plan_id,
         v_qty, 'ACTIVE', p_needed_by, v_key);
    END IF;
  END LOOP;

  -- Cualquier faltante aborta TODO (nunca reserva parcial inconsistente).
  IF jsonb_array_length(v_short) > 0 THEN
    RAISE EXCEPTION 'Stock central insuficiente: %', v_short::text;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_plan_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_plan_stock(UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN) TO authenticated, service_role;

-- 4. Liberación por plan (lifecycle: DRAFT/CLOSED/reemplazo).
CREATE OR REPLACE FUNCTION public.release_plan_reservations(p_plan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := public.current_empresa_id();
  v_count INTEGER := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Sin empresa (tenant fail-closed)';
  END IF;

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

REVOKE ALL ON FUNCTION public.release_plan_reservations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_plan_reservations(UUID) TO authenticated, service_role;
