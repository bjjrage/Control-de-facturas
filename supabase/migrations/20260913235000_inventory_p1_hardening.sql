-- Forward-only hardening for the inventory P1 findings.
-- This migration assumes the immutable inventory baseline exists.
-- Baseline snapshot: 7caa643 / supabase/migrations/0080_inventory_panol.sql

ALTER TABLE public.inventory_balances
  ADD COLUMN IF NOT EXISTS total_cost_company numeric(20,6);
ALTER TABLE public.inventory_balances
  ALTER COLUMN total_cost DROP NOT NULL;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS cost_status text NOT NULL DEFAULT 'COMPUTABLE';
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_cost_status_check;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_cost_status_check
  CHECK (cost_status IN ('COMPUTABLE', 'REVISION_REQUERIDA'));

ALTER TABLE public.inventory_movement_costs
  ADD COLUMN IF NOT EXISTS cost_status text NOT NULL DEFAULT 'COMPUTABLE';
ALTER TABLE public.inventory_movement_costs
  DROP CONSTRAINT IF EXISTS inventory_movement_costs_cost_status_check;
ALTER TABLE public.inventory_movement_costs
  ADD CONSTRAINT inventory_movement_costs_cost_status_check
  CHECK (cost_status IN ('COMPUTABLE', 'REVISION_REQUERIDA'));

UPDATE public.inventory_balances
SET exchange_rate_to_company = 1,
    total_cost_company = total_cost
WHERE cost_status = 'COMPUTABLE'
  AND cost_currency = 'PYG'
  AND total_cost IS NOT NULL;

UPDATE public.inventory_balances
SET total_cost_company = total_cost * exchange_rate_to_company
WHERE cost_status = 'COMPUTABLE'
  AND cost_currency IS NOT NULL
  AND cost_currency <> 'PYG'
  AND exchange_rate_to_company IS NOT NULL
  AND total_cost IS NOT NULL;

UPDATE public.inventory_balances
SET cost_status = 'REVISION_REQUERIDA',
    original_cost_currency = coalesce(original_cost_currency, cost_currency::text),
    original_unit_cost = coalesce(original_unit_cost, total_cost / NULLIF(quantity, 0)),
    original_total_cost = coalesce(original_total_cost, total_cost),
    cost_currency = NULL,
    total_cost = NULL,
    total_cost_company = NULL,
    exchange_rate_to_company = NULL
WHERE cost_status = 'COMPUTABLE'
  AND cost_currency IS NOT NULL
  AND cost_currency <> 'PYG'
  AND exchange_rate_to_company IS NULL;

UPDATE public.inventory_balances
SET total_cost = NULL,
    total_cost_company = NULL,
    exchange_rate_to_company = NULL
WHERE cost_status = 'REVISION_REQUERIDA';

ALTER TABLE public.inventory_balances
  DROP CONSTRAINT IF EXISTS inventory_balances_cost_currency_status_check;
ALTER TABLE public.inventory_balances
  ADD CONSTRAINT inventory_balances_cost_currency_status_check
  CHECK (
    (cost_status = 'COMPUTABLE'
      AND cost_currency IS NOT NULL
      AND total_cost IS NOT NULL
      AND total_cost_company IS NOT NULL)
    OR (cost_status = 'REVISION_REQUERIDA'
      AND cost_currency IS NULL
      AND total_cost IS NULL
      AND total_cost_company IS NULL)
  );

CREATE OR REPLACE FUNCTION public.upsert_inventory_balance(
  p_empresa_id                uuid,
  p_producto_id               uuid,
  p_location_id               uuid,
  p_cost_currency             public.currency_code,
  p_quantity                  numeric,
  p_total_cost                numeric,
  p_total_cost_company        numeric,
  p_cost_status               text,
  p_original_cost_currency    text DEFAULT NULL,
  p_original_unit_cost        numeric DEFAULT NULL,
  p_original_total_cost       numeric DEFAULT NULL,
  p_exchange_rate_to_company  numeric DEFAULT NULL,
  p_cost_source               text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'El saldo a agregar debe ser positivo';
  END IF;

  IF p_cost_status = 'COMPUTABLE' THEN
    IF p_cost_currency IS NULL
       OR p_total_cost IS NULL
       OR p_total_cost_company IS NULL
       OR p_exchange_rate_to_company IS NULL
       OR p_exchange_rate_to_company <= 0 THEN
      RAISE EXCEPTION 'Un saldo computable necesita costo, moneda y FX válidos';
    END IF;

    INSERT INTO public.inventory_balances (
      empresa_id, producto_id, location_id, cost_currency, quantity,
      total_cost, total_cost_company, cost_status, original_cost_currency,
      original_unit_cost, original_total_cost, exchange_rate_to_company,
      cost_source
    ) VALUES (
      p_empresa_id, p_producto_id, p_location_id, p_cost_currency, p_quantity,
      p_total_cost, p_total_cost_company, 'COMPUTABLE',
      p_original_cost_currency, p_original_unit_cost, p_original_total_cost,
      p_exchange_rate_to_company, coalesce(p_cost_source, 'CANONICAL_MOVEMENT')
    )
    ON CONFLICT (empresa_id, producto_id, location_id, cost_currency)
    DO UPDATE SET
      quantity = public.inventory_balances.quantity + EXCLUDED.quantity,
      total_cost = public.inventory_balances.total_cost + EXCLUDED.total_cost,
      total_cost_company = public.inventory_balances.total_cost_company
        + EXCLUDED.total_cost_company,
      exchange_rate_to_company = CASE
        WHEN public.inventory_balances.total_cost + EXCLUDED.total_cost = 0
          THEN EXCLUDED.exchange_rate_to_company
        ELSE (public.inventory_balances.total_cost_company
              + EXCLUDED.total_cost_company)
          / (public.inventory_balances.total_cost + EXCLUDED.total_cost)
      END,
      original_cost_currency = coalesce(
        public.inventory_balances.original_cost_currency,
        EXCLUDED.original_cost_currency
      ),
      original_unit_cost = coalesce(
        public.inventory_balances.original_unit_cost,
        EXCLUDED.original_unit_cost
      ),
      original_total_cost = coalesce(
        public.inventory_balances.original_total_cost,
        0
      ) + coalesce(EXCLUDED.original_total_cost, 0),
      cost_source = coalesce(EXCLUDED.cost_source, public.inventory_balances.cost_source),
      updated_at = now();
    RETURN;
  END IF;

  IF p_cost_status = 'REVISION_REQUERIDA' THEN
    INSERT INTO public.inventory_balances (
      empresa_id, producto_id, location_id, cost_currency, quantity,
      total_cost, total_cost_company, cost_status, original_cost_currency,
      original_unit_cost, original_total_cost, exchange_rate_to_company,
      cost_source
    ) VALUES (
      p_empresa_id, p_producto_id, p_location_id, NULL, p_quantity,
      NULL, NULL, 'REVISION_REQUERIDA', p_original_cost_currency,
      p_original_unit_cost, p_original_total_cost, NULL,
      coalesce(p_cost_source, 'CANONICAL_MOVEMENT_REVIEW')
    )
    ON CONFLICT (empresa_id, producto_id, location_id) WHERE cost_currency IS NULL
    DO UPDATE SET
      quantity = public.inventory_balances.quantity + EXCLUDED.quantity,
      total_cost = NULL,
      total_cost_company = NULL,
      cost_status = 'REVISION_REQUERIDA',
      original_cost_currency = CASE
        WHEN public.inventory_balances.original_cost_currency IS NULL
          THEN EXCLUDED.original_cost_currency
        WHEN EXCLUDED.original_cost_currency IS NULL
          OR public.inventory_balances.original_cost_currency = EXCLUDED.original_cost_currency
          THEN public.inventory_balances.original_cost_currency
        ELSE 'MULTIPLE'
      END,
      original_unit_cost = CASE
        WHEN public.inventory_balances.original_cost_currency IS NOT DISTINCT FROM
             EXCLUDED.original_cost_currency
          THEN coalesce(public.inventory_balances.original_unit_cost,
                        EXCLUDED.original_unit_cost)
        ELSE NULL
      END,
      original_total_cost = CASE
        WHEN public.inventory_balances.original_cost_currency IS NOT DISTINCT FROM
             EXCLUDED.original_cost_currency
          THEN coalesce(public.inventory_balances.original_total_cost, 0)
             + coalesce(EXCLUDED.original_total_cost, 0)
        ELSE NULL
      END,
      exchange_rate_to_company = NULL,
      cost_source = coalesce(EXCLUDED.cost_source, public.inventory_balances.cost_source),
      updated_at = now();
    RETURN;
  END IF;

  RAISE EXCEPTION 'Estado de costo inválido: %', p_cost_status;
END;
$$;


-- A receipt can contain an OC item only once. The cumulative quantity is checked
-- by the canonical RPC while holding the parent authorized order lock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_recepcion_items_order_item_once
  ON public.oc_recepcion_items(recepcion_id, order_item_id);

CREATE OR REPLACE FUNCTION public.can_read_warehouse_evidence(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa_id uuid;
  v_context_id uuid;
  v_location_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RETURN false;
  END IF;
  v_empresa_id := public.current_empresa_id();
  IF v_empresa_id IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  IF p_object_name ~ '^receipts/[0-9A-Fa-f-]{36}/[^/]+$' THEN
    BEGIN
      v_context_id := split_part(p_object_name, '/', 2)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
    RETURN EXISTS (
      SELECT 1
      FROM public.inventory_receipt_evidence e
      JOIN public.oc_recepciones r ON r.id = e.receipt_id
      WHERE e.empresa_id = v_empresa_id
        AND r.empresa_id = v_empresa_id
        AND e.receipt_id = v_context_id
        AND e.storage_bucket = 'warehouse-evidence'
        AND e.storage_path = p_object_name
        AND split_part(p_object_name, '/', 2) = e.receipt_id::text
    );
  END IF;

  IF p_object_name ~ '^[0-9A-Fa-f-]{36}/[0-9A-Fa-f-]{36}/[^/]+$' THEN
    BEGIN
      v_location_id := split_part(p_object_name, '/', 1)::uuid;
      v_context_id := split_part(p_object_name, '/', 2)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
    RETURN EXISTS (
      SELECT 1
      FROM public.warehouse_submission_evidence e
      JOIN public.warehouse_submissions s ON s.id = e.submission_id
      JOIN public.inventory_locations l ON l.id = s.location_id
      WHERE e.empresa_id = v_empresa_id
        AND s.empresa_id = v_empresa_id
        AND l.empresa_id = v_empresa_id
        AND e.submission_id = v_context_id
        AND s.location_id = v_location_id
        AND e.storage_bucket = 'warehouse-evidence'
        AND e.storage_path = p_object_name
        AND split_part(p_object_name, '/', 1) = s.location_id::text
        AND split_part(p_object_name, '/', 2) = e.submission_id::text
    );
  END IF;

  RETURN false;
END;
$$;

DROP POLICY IF EXISTS "internal read warehouse evidence" ON storage.objects;
CREATE POLICY "internal read warehouse evidence" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'warehouse-evidence'
    AND public.can_read_warehouse_evidence(name)
  );

-- ---------------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.prevent_confirmed_warehouse_submission_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_id uuid;
  v_status text;
BEGIN
  v_submission_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  SELECT status INTO v_status
  FROM public.warehouse_submissions
  WHERE id = v_submission_id
  FOR UPDATE;

  IF v_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Las líneas de una rendición confirmada son inmutables';
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.inventory_movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Una línea vinculada a un movimiento canónico es inmutable';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_line_mutation
  ON public.warehouse_submission_lines;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_line_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.warehouse_submission_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_line_mutation();

CREATE OR REPLACE FUNCTION public.prevent_confirmed_warehouse_submission_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_id uuid;
  v_status text;
BEGIN
  v_submission_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  SELECT status INTO v_status
  FROM public.warehouse_submissions
  WHERE id = v_submission_id
  FOR UPDATE;
  IF v_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'La evidencia de una rendición confirmada es inmutable';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_evidence_mutation
  ON public.warehouse_submission_evidence;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_evidence_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.warehouse_submission_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_evidence_mutation();


CREATE OR REPLACE FUNCTION public.inventory_post_movement(
  p_empresa_id               uuid,
  p_producto_id              uuid,
  p_quantity                 numeric,
  p_unit                     text,
  p_movement_type             text,
  p_from_location_id         uuid DEFAULT NULL,
  p_to_location_id           uuid DEFAULT NULL,
  p_project_id               uuid DEFAULT NULL,
  p_budget_item_id           uuid DEFAULT NULL,
  p_source_type              text DEFAULT 'MANUAL',
  p_source_id                uuid DEFAULT NULL,
  p_source_line_id           uuid DEFAULT NULL,
  p_idempotency_key          text DEFAULT NULL,
  p_cost_currency             public.currency_code DEFAULT NULL,
  p_unit_cost                 numeric DEFAULT NULL,
  p_exchange_rate_to_company  numeric DEFAULT NULL,
  p_created_by                uuid DEFAULT NULL,
  p_metadata                 jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type                text := upper(trim(p_movement_type));
  v_source_type         text := coalesce(nullif(trim(p_source_type), ''), 'MANUAL');
  v_idempotency_key     text := nullif(trim(p_idempotency_key), '');
  v_existing            record;
  v_movement_id         uuid;
  v_product_unit        text;
  v_product_empresa     uuid;
  v_location_empresa    uuid;
  v_from_project        uuid;
  v_to_project          uuid;
  v_from_type           text;
  v_to_type             text;
  v_context_project     uuid := p_project_id;
  v_currency             public.currency_code := p_cost_currency;
  v_order_currency      public.currency_code;
  v_receipt_location    uuid;
  v_receipt_order       uuid;
  v_receipt_order_item  uuid;
  v_receipt_product     uuid;
  v_receipt_quantity    numeric;
  v_ordered_quantity    numeric;
  v_received_quantity   numeric;
  v_cost_unit            numeric;
  v_total_cost           numeric := 0;
  v_total_cost_company   numeric;
  v_cost_status          text := 'COMPUTABLE';
  v_effective_exchange_rate numeric;
  v_remaining             numeric;
  v_take                  numeric;
  v_cost_take             numeric;
  v_cost_take_company     numeric;
  v_currency_count        integer;
  v_currency_text         text;
  v_cost_quantity         numeric;
  v_balance               record;
  v_balance_unit_cost     numeric;
  v_balance_company_unit_cost numeric;
  v_had_balance           boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'Acceso denegado: tenant inválido';
    END IF;
    IF NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'No tenés permisos para registrar movimientos de inventario';
    END IF;
  END IF;

  IF v_type NOT IN ('RECEIPT', 'TRANSFER', 'CONSUMPTION', 'RETURN', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_movement_type;
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 OR (v_type <> 'ADJUSTMENT' AND p_quantity < 0) THEN
    RAISE EXCEPTION 'La cantidad del movimiento no es válida';
  END IF;
  IF v_type = 'RECEIPT' AND (p_from_location_id IS NOT NULL OR p_to_location_id IS NULL) THEN
    RAISE EXCEPTION 'Una recepción necesita solo ubicación destino';
  ELSIF v_type = 'TRANSFER' AND (p_from_location_id IS NULL OR p_to_location_id IS NULL
      OR p_from_location_id = p_to_location_id) THEN
    RAISE EXCEPTION 'Una transferencia necesita origen y destino distintos';
  ELSIF v_type = 'CONSUMPTION' AND (p_from_location_id IS NULL OR p_to_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Un consumo necesita solo ubicación origen';
  ELSIF v_type = 'RETURN' AND (p_from_location_id IS NULL OR p_to_location_id IS NULL
      OR p_from_location_id = p_to_location_id) THEN
    RAISE EXCEPTION 'RETURN necesita origen y destino distintos';
  ELSIF v_type = 'ADJUSTMENT' AND (
      (p_quantity > 0 AND (p_from_location_id IS NOT NULL OR p_to_location_id IS NULL))
      OR (p_quantity < 0 AND (p_from_location_id IS NULL OR p_to_location_id IS NOT NULL))
    ) THEN
    RAISE EXCEPTION 'La forma del ajuste no es válida';
  END IF;
  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN
    RAISE EXCEPTION 'La unidad del movimiento es obligatoria';
  END IF;
  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'La idempotency_key es obligatoria';
  END IF;
  -- Serializa reintentos concurrentes de la misma operación antes de leer el
  -- libro. Así la restricción única es una última defensa y no el mecanismo
  -- normal de idempotencia.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_empresa_id::text || ':' || v_idempotency_key, 0)
  );
  IF p_source_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_empresa_id::text || ':' || v_source_type || ':' || p_source_id::text
          || ':' || coalesce(p_source_line_id::text, ''),
        0
      )
    );
  END IF;
  IF p_exchange_rate_to_company IS NOT NULL AND p_exchange_rate_to_company <= 0 THEN
    RAISE EXCEPTION 'El tipo de cambio debe ser mayor a cero';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'El costo unitario no puede ser negativo';
  END IF;

  -- Retry seguro: primero por clave explícita y luego por origen canónico.
  SELECT * INTO v_existing
  FROM public.inventory_movements
  WHERE empresa_id = p_empresa_id AND idempotency_key = v_idempotency_key;
  IF FOUND THEN
    IF v_existing.producto_id IS DISTINCT FROM p_producto_id
       OR v_existing.quantity IS DISTINCT FROM p_quantity
       OR v_existing.unit IS DISTINCT FROM trim(p_unit)
       OR v_existing.movement_type IS DISTINCT FROM v_type
       OR v_existing.from_location_id IS DISTINCT FROM p_from_location_id
       OR v_existing.to_location_id IS DISTINCT FROM p_to_location_id
       OR (p_cost_currency IS NOT NULL AND v_existing.cost_currency IS DISTINCT FROM p_cost_currency)
       OR (p_unit_cost IS NOT NULL AND v_existing.unit_cost IS DISTINCT FROM p_unit_cost)
       OR (p_project_id IS NOT NULL AND v_existing.project_id IS DISTINCT FROM p_project_id)
       OR (p_budget_item_id IS NOT NULL AND v_existing.budget_item_id IS DISTINCT FROM p_budget_item_id) THEN
      RAISE EXCEPTION 'La idempotency_key ya fue usada para otra operación';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.inventory_movements
    WHERE empresa_id = p_empresa_id
      AND source_type = v_source_type
      AND source_id = p_source_id
      AND source_line_id IS NOT DISTINCT FROM p_source_line_id
      AND movement_type = v_type;
    IF FOUND THEN
      IF v_existing.producto_id IS DISTINCT FROM p_producto_id
         OR v_existing.quantity IS DISTINCT FROM p_quantity
         OR v_existing.unit IS DISTINCT FROM trim(p_unit)
         OR v_existing.from_location_id IS DISTINCT FROM p_from_location_id
         OR v_existing.to_location_id IS DISTINCT FROM p_to_location_id
         OR (p_cost_currency IS NOT NULL AND v_existing.cost_currency IS DISTINCT FROM p_cost_currency)
         OR (p_unit_cost IS NOT NULL AND v_existing.unit_cost IS DISTINCT FROM p_unit_cost)
         OR (p_project_id IS NOT NULL AND v_existing.project_id IS DISTINCT FROM p_project_id)
         OR (p_budget_item_id IS NOT NULL AND v_existing.budget_item_id IS DISTINCT FROM p_budget_item_id) THEN
        RAISE EXCEPTION 'El origen ya fue aplicado con otra operación';
      END IF;
      RETURN v_existing.id;
    END IF;
  END IF;

  SELECT empresa_id, unidad INTO v_product_empresa, v_product_unit
  FROM public.productos
  WHERE id = p_producto_id;
  IF v_product_empresa IS NULL OR v_product_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'El material no pertenece a la empresa';
  END IF;
  IF trim(v_product_unit) <> trim(p_unit) THEN
    RAISE EXCEPTION 'La unidad no coincide con la unidad del material';
  END IF;

  IF p_from_location_id IS NOT NULL THEN
    SELECT empresa_id, project_id, location_type
      INTO v_location_empresa, v_from_project, v_from_type
    FROM public.inventory_locations
    WHERE id = p_from_location_id AND active;
    IF v_location_empresa IS NULL OR v_location_empresa IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'La ubicación origen no pertenece a la empresa o está inactiva';
    END IF;
  END IF;
  IF p_to_location_id IS NOT NULL THEN
    SELECT empresa_id, project_id, location_type
      INTO v_location_empresa, v_to_project, v_to_type
    FROM public.inventory_locations
    WHERE id = p_to_location_id AND active;
    IF v_location_empresa IS NULL OR v_location_empresa IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'La ubicación destino no pertenece a la empresa o está inactiva';
    END IF;
  END IF;

  -- Un receipt canónico queda vinculado a la OC, su tenant, ítem y moneda real.
  IF v_type = 'RECEIPT' AND v_source_type = 'OC_RECEPCION' AND p_source_id IS NOT NULL THEN
    SELECT r.order_id, r.delivery_location_id, ao.currency,
           ri.producto_id, ri.cantidad_recibida, ri.order_item_id, aoi.quantity
      INTO v_receipt_order, v_receipt_location, v_order_currency,
           v_receipt_product, v_receipt_quantity, v_receipt_order_item,
           v_ordered_quantity
    FROM public.oc_recepciones r
    JOIN public.oc_recepcion_items ri ON ri.recepcion_id = r.id
    JOIN public.authorized_orders ao ON ao.id = r.order_id
    JOIN public.authorized_order_items aoi ON aoi.id = ri.order_item_id
    WHERE r.id = p_source_id
      AND ri.id = p_source_line_id
      AND r.empresa_id = p_empresa_id
      AND ao.empresa_id = p_empresa_id
      AND aoi.empresa_id = p_empresa_id
      AND ri.empresa_id = p_empresa_id;
    IF v_receipt_order IS NULL THEN
      RAISE EXCEPTION 'La recepción o su línea no pertenece a la empresa';
    END IF;
    PERFORM 1
    FROM public.authorized_orders
    WHERE id = v_receipt_order AND empresa_id = p_empresa_id
    FOR UPDATE;
    SELECT coalesce(sum(ri2.cantidad_recibida), 0)
      INTO v_received_quantity
    FROM public.oc_recepcion_items ri2
    JOIN public.oc_recepciones r2 ON r2.id = ri2.recepcion_id
    WHERE r2.order_id = v_receipt_order
      AND r2.empresa_id = p_empresa_id
      AND ri2.empresa_id = p_empresa_id
      AND ri2.order_item_id = v_receipt_order_item
      AND ri2.recepcion_id <> p_source_id
      AND r2.status = 'CONFIRMED';
    IF p_quantity > v_ordered_quantity - v_received_quantity THEN
      RAISE EXCEPTION 'La recepción supera la cantidad pendiente de la línea de OC';
    END IF;
    IF v_receipt_product IS DISTINCT FROM p_producto_id
       OR p_quantity > v_receipt_quantity THEN
      RAISE EXCEPTION 'La línea de recepción no coincide con el material o cantidad';
    END IF;
    IF v_receipt_location IS NOT NULL AND v_receipt_location IS DISTINCT FROM p_to_location_id THEN
      RAISE EXCEPTION 'La ubicación no coincide con la recepción';
    END IF;
    v_context_project := coalesce(v_context_project,
      (SELECT project_id FROM public.authorized_orders WHERE id = v_receipt_order));
    v_currency := coalesce(v_currency, v_order_currency);
  END IF;

  IF v_to_project IS NOT NULL AND v_type IN ('RECEIPT', 'RETURN') THEN
    IF v_context_project IS NULL THEN v_context_project := v_to_project; END IF;
    IF v_context_project IS DISTINCT FROM v_to_project THEN
      RAISE EXCEPTION 'El proyecto contextual no coincide con la ubicación destino';
    END IF;
  END IF;
  IF v_type = 'CONSUMPTION' THEN
    IF v_context_project IS NULL OR p_budget_item_id IS NULL THEN
      RAISE EXCEPTION 'El consumo requiere proyecto y partida presupuestaria';
    END IF;
    IF v_from_project IS DISTINCT FROM v_context_project THEN
      RAISE EXCEPTION 'El consumo debe salir del pañol de la obra indicada';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.budget_items bi
      JOIN public.projects pr ON pr.id = bi.project_id
      WHERE bi.id = p_budget_item_id
        AND bi.project_id = v_context_project
        AND pr.empresa_id = p_empresa_id
    ) THEN
      RAISE EXCEPTION 'La partida no pertenece al proyecto y tenant indicados';
    END IF;
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa';
  END IF;
  IF p_budget_item_id IS NOT NULL AND v_type <> 'CONSUMPTION' THEN
    RAISE EXCEPTION 'Solo el consumo puede imputarse a una partida';
  END IF;

  IF v_type = 'RECEIPT' AND (v_currency IS NULL OR p_unit_cost IS NULL) THEN
    RAISE EXCEPTION 'La recepción necesita costo y moneda de compra explícitos';
  END IF;
  IF v_type = 'ADJUSTMENT' AND (v_currency IS NULL OR p_unit_cost IS NULL) THEN
    RAISE EXCEPTION 'El ajuste necesita costo y moneda explicitos';
  END IF;

  IF v_type = 'RECEIPT' OR (v_type = 'ADJUSTMENT' AND p_quantity > 0) THEN
    IF v_currency = 'PYG' THEN
      v_cost_status := 'COMPUTABLE';
      v_effective_exchange_rate := 1;
    ELSIF p_exchange_rate_to_company IS NOT NULL AND p_exchange_rate_to_company > 0 THEN
      v_cost_status := 'COMPUTABLE';
      v_effective_exchange_rate := p_exchange_rate_to_company;
    ELSE
      v_cost_status := 'REVISION_REQUERIDA';
      v_effective_exchange_rate := NULL;
    END IF;
  END IF;

  INSERT INTO public.inventory_movements (
    empresa_id, producto_id, quantity, unit, movement_type,
    from_location_id, to_location_id, project_id, budget_item_id,
    source_type, source_id, source_line_id, idempotency_key,
    status, cost_status, created_by, confirmed_by, metadata
  ) VALUES (
    p_empresa_id, p_producto_id, p_quantity, trim(p_unit), v_type,
    p_from_location_id, p_to_location_id, v_context_project, p_budget_item_id,
    v_source_type, p_source_id, p_source_line_id, v_idempotency_key,
    'DRAFT', v_cost_status, p_created_by, p_created_by, coalesce(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_movement_id;

  IF v_type = 'RECEIPT' OR (v_type = 'ADJUSTMENT' AND p_quantity > 0) THEN
    v_cost_unit := p_unit_cost;
    v_total_cost := p_quantity * v_cost_unit;
    v_total_cost_company := CASE WHEN v_cost_status = 'COMPUTABLE'
      THEN v_total_cost * v_effective_exchange_rate ELSE NULL END;
    PERFORM public.upsert_inventory_balance(
      p_empresa_id => p_empresa_id,
      p_producto_id => p_producto_id,
      p_location_id => p_to_location_id,
      p_cost_currency => CASE WHEN v_cost_status = 'COMPUTABLE' THEN v_currency ELSE NULL END,
      p_quantity => p_quantity,
      p_total_cost => CASE WHEN v_cost_status = 'COMPUTABLE' THEN v_total_cost ELSE NULL END,
      p_total_cost_company => v_total_cost_company,
      p_cost_status => v_cost_status,
      p_original_cost_currency => v_currency::text,
      p_original_unit_cost => v_cost_unit,
      p_original_total_cost => v_total_cost,
      p_exchange_rate_to_company => v_effective_exchange_rate,
      p_cost_source => CASE WHEN v_cost_status = 'COMPUTABLE'
        THEN 'CANONICAL_MOVEMENT' ELSE 'CANONICAL_MOVEMENT_REVIEW' END
    );

    INSERT INTO public.inventory_movement_costs (
      empresa_id, movement_id, quantity, cost_currency, unit_cost, total_cost,
      cost_status, exchange_rate_to_company, total_cost_company
    ) VALUES (
      p_empresa_id, v_movement_id, p_quantity, v_currency, v_cost_unit, v_total_cost,
      v_cost_status, v_effective_exchange_rate, v_total_cost_company
    );

  ELSIF v_type = 'ADJUSTMENT' AND p_quantity < 0 THEN
    SELECT quantity, total_cost, total_cost_company, exchange_rate_to_company,
           cost_currency, cost_status INTO v_balance
    FROM public.inventory_balances
    WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
      AND location_id = p_from_location_id AND cost_currency = v_currency
      AND cost_status = 'COMPUTABLE'
    FOR UPDATE;
    IF NOT FOUND OR v_balance.quantity < abs(p_quantity) THEN
      RAISE EXCEPTION 'Stock insuficiente para el ajuste';
    END IF;
    v_cost_unit := CASE WHEN v_balance.quantity = 0 THEN 0
                        ELSE v_balance.total_cost / v_balance.quantity END;
    v_total_cost := abs(p_quantity) * v_cost_unit;
    v_cost_take_company := abs(p_quantity)
      * (v_balance.total_cost_company / NULLIF(v_balance.quantity, 0));
    v_total_cost_company := v_cost_take_company;
    v_effective_exchange_rate := v_balance.exchange_rate_to_company;
    UPDATE public.inventory_balances
    SET quantity = quantity - abs(p_quantity),
        total_cost = greatest(0, total_cost - v_total_cost),
        total_cost_company = greatest(0, total_cost_company - v_total_cost_company),
        updated_at = now()
    WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
      AND location_id = p_from_location_id AND cost_currency = v_currency;
    INSERT INTO public.inventory_movement_costs (
      empresa_id, movement_id, quantity, cost_currency, unit_cost, total_cost,
      cost_status, exchange_rate_to_company, total_cost_company
    ) VALUES (
      p_empresa_id, v_movement_id, abs(p_quantity), v_currency, v_cost_unit, v_total_cost,
      'COMPUTABLE', v_effective_exchange_rate, v_total_cost_company
    );
    v_total_cost := -v_total_cost;

  ELSE
    -- Transferencias, devoluciones y consumos descargan los saldos por moneda, preservando
    -- el costo real transportado. Si hay varias monedas no se las convierte ni
    -- se las mezcla: el movimiento conserva varias filas de costo.
    v_remaining := p_quantity;
    FOR v_balance IN
      SELECT id, cost_currency, quantity, total_cost, total_cost_company,
             exchange_rate_to_company, cost_status
      FROM public.inventory_balances
      WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
        AND location_id = p_from_location_id AND quantity > 0
        AND cost_status = 'COMPUTABLE' AND cost_currency IS NOT NULL
      ORDER BY cost_currency::text
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := least(v_remaining, v_balance.quantity);
      v_balance_unit_cost := CASE WHEN v_balance.quantity = 0 THEN 0
                                  ELSE v_balance.total_cost / v_balance.quantity END;
      v_cost_take := CASE WHEN v_take = v_balance.quantity THEN v_balance.total_cost
                          ELSE v_take * v_balance_unit_cost END;
      IF v_balance.cost_currency <> 'PYG'
         AND (v_balance.exchange_rate_to_company IS NULL
              OR v_balance.total_cost_company IS NULL) THEN
        RAISE EXCEPTION 'El saldo extranjero requiere FX antes de moverse';
      END IF;
      v_balance_company_unit_cost := CASE WHEN v_balance.quantity = 0 THEN 0
        ELSE v_balance.total_cost_company / v_balance.quantity END;
      v_cost_take_company := CASE WHEN v_take = v_balance.quantity
        THEN v_balance.total_cost_company
        ELSE v_take * v_balance_company_unit_cost END;

      UPDATE public.inventory_balances
      SET quantity = quantity - v_take,
          total_cost = greatest(0, total_cost - v_cost_take),
          total_cost_company = greatest(0, total_cost_company - v_cost_take_company),
          updated_at = now()
      WHERE id = v_balance.id;

      INSERT INTO public.inventory_movement_costs (
        empresa_id, movement_id, quantity, cost_currency, unit_cost, total_cost,
        cost_status, exchange_rate_to_company, total_cost_company
      ) VALUES (
        p_empresa_id, v_movement_id, v_take, v_balance.cost_currency,
        v_balance_unit_cost, v_cost_take, 'COMPUTABLE',
        v_balance.exchange_rate_to_company, v_cost_take_company
      );

      IF v_type IN ('TRANSFER', 'RETURN') THEN
        PERFORM public.upsert_inventory_balance(
          p_empresa_id => p_empresa_id,
          p_producto_id => p_producto_id,
          p_location_id => p_to_location_id,
          p_cost_currency => v_balance.cost_currency,
          p_quantity => v_take,
          p_total_cost => v_cost_take,
          p_total_cost_company => v_cost_take_company,
          p_cost_status => 'COMPUTABLE',
          p_original_cost_currency => coalesce(
            v_balance.original_cost_currency, v_balance.cost_currency::text
          ),
          p_original_unit_cost => coalesce(v_balance.original_unit_cost, v_balance_unit_cost),
          p_original_total_cost => v_cost_take,
          p_exchange_rate_to_company => v_balance.exchange_rate_to_company,
          p_cost_source => 'CANONICAL_MOVEMENT'
        );
      END IF;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF coalesce(v_remaining, p_quantity) > 0 THEN
      RAISE EXCEPTION 'Stock insuficiente en la ubicación origen: faltan %', v_remaining;
    END IF;

    SELECT coalesce(sum(total_cost), 0), coalesce(sum(quantity), 0),
           count(DISTINCT cost_currency), min(cost_currency::text),
           CASE WHEN count(*) = count(total_cost_company)
                THEN sum(total_cost_company) ELSE NULL END
      INTO v_total_cost, v_cost_quantity, v_currency_count, v_currency_text,
           v_total_cost_company
    FROM public.inventory_movement_costs
    WHERE movement_id = v_movement_id;
  END IF;

  -- RECEIPT/ADJUSTMENT también usan el mismo resumen canónico.
  IF v_type = 'RECEIPT' OR v_type = 'ADJUSTMENT' THEN
    SELECT count(DISTINCT cost_currency), min(cost_currency::text),
           CASE WHEN count(*) = count(total_cost_company)
                THEN sum(total_cost_company) ELSE NULL END
      INTO v_currency_count, v_currency_text, v_total_cost_company
    FROM public.inventory_movement_costs
    WHERE movement_id = v_movement_id;
  END IF;

  IF v_currency_count = 1 THEN
    v_currency := v_currency_text::public.currency_code;
    SELECT sum(total_cost) / NULLIF(sum(quantity), 0)
      INTO v_cost_unit
    FROM public.inventory_movement_costs
    WHERE movement_id = v_movement_id;
  ELSE
    v_currency := NULL;
    v_cost_unit := NULL;
  END IF;

  IF v_cost_status = 'COMPUTABLE'
     AND v_total_cost_company IS NOT NULL
     AND v_total_cost IS NOT NULL
     AND v_total_cost <> 0
     AND v_type IN ('TRANSFER', 'RETURN', 'CONSUMPTION') THEN
    v_effective_exchange_rate := abs(v_total_cost_company / v_total_cost);
  END IF;

  UPDATE public.inventory_movements
  SET cost_currency = v_currency,
      unit_cost = v_cost_unit,
      cost_status = v_cost_status,
      cost_total = CASE WHEN v_type = 'ADJUSTMENT' AND p_quantity < 0
                        THEN v_total_cost ELSE abs(v_total_cost) END,
      exchange_rate_to_company = CASE
        WHEN v_cost_status = 'COMPUTABLE' AND v_currency_count = 1
          THEN v_effective_exchange_rate
        ELSE NULL
      END,
      cost_total_company = CASE WHEN v_type = 'ADJUSTMENT' AND p_quantity < 0
                                THEN CASE WHEN v_total_cost_company IS NULL THEN NULL ELSE -v_total_cost_company END
                                ELSE v_total_cost_company END,
      status = 'CONFIRMED', confirmed_by = p_created_by, confirmed_at = now()
  WHERE id = v_movement_id;

  PERFORM public.sync_inventory_legacy_projection(
    p_empresa_id,
    p_producto_id,
    ARRAY[p_from_location_id, p_to_location_id]::uuid[]
  );

  RETURN v_movement_id;
END;
$$;

-- ---------------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.inventory_confirm_receipt(
  p_empresa_id          uuid,
  p_receipt_id          uuid,
  p_delivery_location_id uuid DEFAULT NULL,
  p_idempotency_key     text DEFAULT NULL,
  p_confirmed_by        uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
  v_order record;
  v_location uuid := p_delivery_location_id;
  v_item record;
  v_movement uuid;
  v_ids uuid[] := '{}';
  v_key text;
  v_received_quantity numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar recepción';
    END IF;
  END IF;

  SELECT * INTO v_receipt
  FROM public.oc_recepciones
  WHERE id = p_receipt_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recepción no encontrada'; END IF;
  IF v_receipt.status = 'VOIDED' THEN RAISE EXCEPTION 'La recepción está anulada'; END IF;
  IF v_receipt.status = 'CONFIRMED' THEN
    IF p_delivery_location_id IS NOT NULL
       AND p_delivery_location_id IS DISTINCT FROM v_receipt.delivery_location_id THEN
      RAISE EXCEPTION 'La recepción ya fue confirmada en otra ubicación';
    END IF;
    SELECT coalesce(
      array_agg(ri.inventory_movement_id ORDER BY ri.id)
        FILTER (WHERE ri.inventory_movement_id IS NOT NULL),
      '{}'::uuid[]
    ) INTO v_ids
    FROM public.oc_recepcion_items ri
    WHERE ri.recepcion_id = p_receipt_id AND ri.empresa_id = p_empresa_id;
    RETURN v_ids;
  END IF;

  SELECT id, project_id, currency INTO v_order
  FROM public.authorized_orders
  WHERE id = v_receipt.order_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La OC de la recepción no pertenece a la empresa'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.oc_recepcion_items
    WHERE recepcion_id = p_receipt_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La recepción necesita al menos una línea';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.oc_recepcion_items ri
    LEFT JOIN public.authorized_order_items oi
      ON oi.id = ri.order_item_id
     AND oi.order_id = v_receipt.order_id
     AND oi.empresa_id = p_empresa_id
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
      AND oi.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Una línea de recepción no pertenece a la OC';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.oc_recepcion_items
    WHERE recepcion_id = p_receipt_id AND empresa_id = p_empresa_id
    GROUP BY order_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se puede repetir un ítem de OC dentro de una recepción';
  END IF;

  -- El lock de la OC serializa todas las confirmaciones de sus recepciones.
  -- La suma se calcula antes de crear el primer movimiento para garantizar
  -- rollback total si alguna línea excede el remanente.
  FOR v_item IN
    SELECT ri.order_item_id,
           sum(ri.cantidad_recibida) AS receipt_quantity,
           max(oi.quantity) AS ordered_quantity
    FROM public.oc_recepcion_items ri
    JOIN public.authorized_order_items oi
      ON oi.id = ri.order_item_id
     AND oi.order_id = v_receipt.order_id
     AND oi.empresa_id = p_empresa_id
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
    GROUP BY ri.order_item_id
  LOOP
    SELECT coalesce(sum(ri2.cantidad_recibida), 0)
      INTO v_received_quantity
    FROM public.oc_recepcion_items ri2
    JOIN public.oc_recepciones r2 ON r2.id = ri2.recepcion_id
    WHERE r2.order_id = v_receipt.order_id
      AND r2.empresa_id = p_empresa_id
      AND ri2.empresa_id = p_empresa_id
      AND ri2.order_item_id = v_item.order_item_id
      AND ri2.recepcion_id <> p_receipt_id
      AND r2.status = 'CONFIRMED';
    IF v_item.receipt_quantity > v_item.ordered_quantity - v_received_quantity THEN
      RAISE EXCEPTION 'La recepción supera la cantidad pendiente de la línea de OC';
    END IF;
  END LOOP;

  v_location := coalesce(v_location, v_receipt.delivery_location_id);
  IF v_location IS NULL THEN
    SELECT il.id INTO v_location
    FROM public.inventory_locations il
    WHERE il.empresa_id = p_empresa_id AND il.active
      AND ((v_order.project_id IS NOT NULL AND il.location_type = 'PROJECT'
            AND il.project_id = v_order.project_id)
        OR (v_order.project_id IS NULL AND il.location_type = 'CENTRAL' AND il.is_primary))
    ORDER BY il.is_primary DESC, il.created_at
    LIMIT 1;
  END IF;
  IF v_location IS NULL THEN
    RAISE EXCEPTION 'La recepción necesita una ubicación de entrega válida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_location AND empresa_id = p_empresa_id AND active
  ) THEN
    RAISE EXCEPTION 'La ubicación de entrega no pertenece a la empresa';
  END IF;

  FOR v_item IN
    SELECT ri.id, ri.producto_id, ri.cantidad_recibida, ri.inventory_movement_id,
           oi.unit, oi.unit_price
    FROM public.oc_recepcion_items ri
    JOIN public.authorized_order_items oi ON oi.id = ri.order_item_id
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
      AND oi.empresa_id = p_empresa_id
  LOOP
    IF v_item.producto_id IS NULL THEN
      RAISE EXCEPTION 'La línea de recepción % necesita vincularse a un material del catálogo', v_item.id;
    END IF;
    IF v_item.inventory_movement_id IS NOT NULL THEN
      v_ids := array_append(v_ids, v_item.inventory_movement_id);
      CONTINUE;
    END IF;
    v_key := coalesce(nullif(trim(p_idempotency_key), ''), p_receipt_id::text) || ':' || v_item.id::text;
    v_movement := public.inventory_post_movement(
      p_empresa_id := p_empresa_id,
      p_producto_id := v_item.producto_id,
      p_quantity := v_item.cantidad_recibida,
      p_unit := v_item.unit,
      p_movement_type := 'RECEIPT',
      p_to_location_id := v_location,
      p_project_id := v_order.project_id,
      p_source_type := 'OC_RECEPCION',
      p_source_id := p_receipt_id,
      p_source_line_id := v_item.id,
      p_idempotency_key := v_key,
      p_cost_currency := v_order.currency,
      p_unit_cost := v_item.unit_price,
      p_created_by := p_confirmed_by,
      p_metadata := jsonb_build_object('receipt_id', p_receipt_id, 'order_id', v_order.id)
    );
    UPDATE public.oc_recepcion_items
    SET inventory_movement_id = v_movement
    WHERE id = v_item.id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;

  UPDATE public.oc_recepciones
  SET delivery_location_id = v_location,
      status = 'CONFIRMED', confirmed_by = p_confirmed_by,
      confirmed_at = now(), updated_at = now()
  WHERE id = p_receipt_id;
  RETURN v_ids;
END;
$$;


CREATE OR REPLACE VIEW public.inventory_stock_by_location AS
SELECT
  b.empresa_id,
  b.location_id,
  l.name AS location_name,
  l.location_type,
  l.project_id,
  b.producto_id,
  p.nombre AS producto,
  p.unidad,
  b.cost_currency,
  b.quantity,
  b.total_cost,
  b.cost_status,
  b.original_cost_currency,
  b.original_unit_cost,
  b.original_total_cost,
  b.exchange_rate_to_company,
  b.cost_source,
  b.updated_at,
  b.total_cost_company
FROM public.inventory_balances b
JOIN public.inventory_locations l ON l.id = b.location_id
JOIN public.productos p ON p.id = b.producto_id
WHERE b.quantity > 0;

CREATE OR REPLACE VIEW public.inventory_stock_global AS
SELECT
  empresa_id, producto_id, producto, unidad, cost_currency,
  sum(quantity) AS quantity,
  sum(total_cost) AS total_cost,
  sum(total_cost_company) AS total_cost_company
FROM public.inventory_stock_by_location
WHERE cost_status = 'COMPUTABLE' AND cost_currency IS NOT NULL
GROUP BY empresa_id, producto_id, producto, unidad, cost_currency;

CREATE OR REPLACE VIEW public.inventory_stock_global_quantity AS
SELECT empresa_id, producto_id, producto, unidad, sum(quantity) AS quantity
FROM public.inventory_stock_by_location
GROUP BY empresa_id, producto_id, producto, unidad;

CREATE OR REPLACE VIEW public.inventory_stock_by_project AS
SELECT
  empresa_id, project_id, producto_id, producto, unidad, cost_currency, cost_status,
  sum(quantity) AS quantity,
  sum(total_cost) AS total_cost,
  sum(total_cost_company) AS total_cost_company
FROM public.inventory_stock_by_location
WHERE project_id IS NOT NULL
GROUP BY empresa_id, project_id, producto_id, producto, unidad, cost_currency, cost_status;

CREATE OR REPLACE VIEW public.inventory_consumption_by_budget AS
SELECT
  m.empresa_id, m.project_id, m.budget_item_id, m.producto_id,
  p.nombre AS producto, p.unidad,
  sum(c.quantity) AS quantity_consumed,
  c.cost_currency,
  sum(c.total_cost) AS cost_consumed,
  sum(c.total_cost_company) AS cost_consumed_company
FROM public.inventory_movements m
JOIN public.productos p ON p.id = m.producto_id
JOIN public.inventory_movement_costs c ON c.movement_id = m.id
WHERE m.movement_type = 'CONSUMPTION'
  AND m.status = 'CONFIRMED'
  AND c.cost_status = 'COMPUTABLE'
GROUP BY m.empresa_id, m.project_id, m.budget_item_id, m.producto_id,
         p.nombre, p.unidad, c.cost_currency;

ALTER VIEW public.inventory_stock_by_location SET (security_invoker = true);
ALTER VIEW public.inventory_stock_global SET (security_invoker = true);
ALTER VIEW public.inventory_stock_global_quantity SET (security_invoker = true);
ALTER VIEW public.inventory_stock_by_project SET (security_invoker = true);
ALTER VIEW public.inventory_consumption_by_budget SET (security_invoker = true);

REVOKE ALL ON FUNCTION public.upsert_inventory_balance(
  uuid, uuid, uuid, public.currency_code, numeric, numeric, numeric, text,
  text, numeric, numeric, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_inventory_balance(
  uuid, uuid, uuid, public.currency_code, numeric, numeric, numeric, text,
  text, numeric, numeric, numeric, text
) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.can_read_warehouse_evidence(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_confirmed_warehouse_submission_line_mutation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_confirmed_warehouse_submission_evidence_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_warehouse_evidence(text)
  TO authenticated;
