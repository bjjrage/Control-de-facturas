-- Prevent central inventory movements from invalidating active MRP promises.
-- Forward-only: preserve the authenticated actor boundary and serialize the
-- physical balance read before a reservation is calculated.

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

    -- Lock physical rows first, then read their current total. This order
    -- serializes with canonical outbound movements, which update these rows.
    PERFORM 1 FROM public.inventory_balances
      WHERE empresa_id = v_empresa_id AND location_id = p_location_id AND producto_id = v_prod
      ORDER BY cost_currency::text
      FOR UPDATE;
    SELECT COALESCE(SUM(quantity), 0) INTO v_fisico
      FROM public.inventory_balances
      WHERE empresa_id = v_empresa_id AND location_id = p_location_id AND producto_id = v_prod;

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

REVOKE ALL ON FUNCTION public.reserve_plan_stock(UUID, UUID, UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_plan_stock(UUID, UUID, UUID, UUID, UUID, JSONB, DATE, TEXT, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_inventory_balance_below_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa_id UUID;
  v_location_id UUID;
  v_producto_id UUID;
  v_physical_after NUMERIC;
  v_reserved NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.producto_id IS DISTINCT FROM OLD.producto_id THEN
      RAISE EXCEPTION 'La identidad de un saldo de inventario es inmutable';
    END IF;
    IF NEW.quantity >= OLD.quantity THEN
      RETURN NEW;
    END IF;
    v_empresa_id := NEW.empresa_id;
    v_location_id := NEW.location_id;
    v_producto_id := NEW.producto_id;
    SELECT COALESCE(SUM(b.quantity), 0) - OLD.quantity + NEW.quantity
      INTO v_physical_after
      FROM public.inventory_balances b
      WHERE b.empresa_id = v_empresa_id
        AND b.location_id = v_location_id
        AND b.producto_id = v_producto_id;
  ELSE
    v_empresa_id := OLD.empresa_id;
    v_location_id := OLD.location_id;
    v_producto_id := OLD.producto_id;
    SELECT COALESCE(SUM(b.quantity), 0) - OLD.quantity
      INTO v_physical_after
      FROM public.inventory_balances b
      WHERE b.empresa_id = v_empresa_id
        AND b.location_id = v_location_id
        AND b.producto_id = v_producto_id;
  END IF;

  SELECT COALESCE(SUM(r.quantity), 0)
    INTO v_reserved
    FROM public.inventory_reservations r
    WHERE r.empresa_id = v_empresa_id
      AND r.location_id = v_location_id
      AND r.producto_id = v_producto_id
      AND r.status = 'ACTIVE';

  IF v_physical_after < v_reserved THEN
    RAISE EXCEPTION 'Movimiento bloqueado: stock físico restante (%) sería menor al stock reservado (%)',
      v_physical_after, v_reserved
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_inventory_balance_below_reservations() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inventory_balance_reservation_guard ON public.inventory_balances;
CREATE TRIGGER trg_inventory_balance_reservation_guard
  BEFORE UPDATE OR DELETE ON public.inventory_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_inventory_balance_below_reservations();
