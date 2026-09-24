-- Canonical purchase receipts: atomic draft creation, confirmed-only inbound,
-- and an immutable bridge from OC receipts to the canonical inventory ledger.

-- Preserve only pre-cutover legacy receipts whose lines and any old stock
-- movements can be reconciled exactly. Never synthesize canonical inventory
-- movements from legacy data. Unverifiable rows remain DRAFT.
UPDATE public.oc_recepciones r
SET status = 'CONFIRMED',
    confirmed_by = coalesce(r.confirmed_by, r.created_by),
    confirmed_at = coalesce(r.confirmed_at, r.created_at, now()),
    updated_at = now()
WHERE r.status = 'DRAFT'
  AND r.idempotency_key IS NULL
  AND (
    r.delivery_location_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.inventory_locations il
      WHERE il.id = r.delivery_location_id
        AND il.empresa_id = r.empresa_id
        AND il.active
    )
  )
  AND EXISTS (
    SELECT 1
    FROM public.oc_recepcion_items ri
    WHERE ri.recepcion_id = r.id
      AND ri.empresa_id = r.empresa_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.oc_recepcion_items ri
    LEFT JOIN public.authorized_order_items oi
      ON oi.id = ri.order_item_id
     AND oi.order_id = r.order_id
     AND oi.empresa_id = r.empresa_id
    WHERE ri.recepcion_id = r.id
      AND ri.empresa_id = r.empresa_id
      AND oi.id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT ri2.order_item_id, sum(ri2.cantidad_recibida) AS received_quantity
      FROM public.oc_recepcion_items ri2
      JOIN public.oc_recepciones r2
        ON r2.id = ri2.recepcion_id
       AND r2.empresa_id = ri2.empresa_id
      WHERE r2.order_id = r.order_id
        AND r2.empresa_id = r.empresa_id
        AND r2.status <> 'VOIDED'
      GROUP BY ri2.order_item_id
    ) accumulated
    JOIN public.authorized_order_items oi
      ON oi.id = accumulated.order_item_id
     AND oi.order_id = r.order_id
     AND oi.empresa_id = r.empresa_id
    WHERE accumulated.received_quantity > oi.quantity
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT ri.producto_id, sum(ri.cantidad_recibida) AS expected_quantity
      FROM public.oc_recepcion_items ri
      WHERE ri.recepcion_id = r.id
        AND ri.empresa_id = r.empresa_id
        AND ri.producto_id IS NOT NULL
      GROUP BY ri.producto_id
    ) expected
    FULL JOIN (
      SELECT sm.producto_id, sum(sm.cantidad) AS actual_quantity
      FROM public.stock_movimientos sm
      WHERE sm.empresa_id = r.empresa_id
        AND sm.referencia_tipo = 'oc_recepcion'
        AND sm.referencia_id = r.id
        AND sm.tipo = 'ENTRADA'
      GROUP BY sm.producto_id
    ) actual USING (producto_id)
    WHERE expected.expected_quantity IS DISTINCT FROM actual.actual_quantity
  );

-- Force all authenticated receipt creation through the atomic RPC. The old
-- tenant-only INSERT policies allowed callers to forge CONFIRMED receipts.
DROP POLICY IF EXISTS "insert oc_recepciones" ON public.oc_recepciones;
DROP POLICY IF EXISTS "insert oc_recepcion_items" ON public.oc_recepcion_items;
DROP POLICY IF EXISTS "delete oc_recepciones" ON public.oc_recepciones;
CREATE POLICY "delete oc_recepciones"
  ON public.oc_recepciones FOR DELETE TO authenticated
  USING (
    empresa_id = public.current_empresa_id()
    AND status = 'DRAFT'
    AND idempotency_key IS NOT NULL
    AND (
      public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
      OR (
        public.is_internal_role(ARRAY['comercial']::public.user_role[])
        AND created_by = auth.uid()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_non_draft_oc_receipt_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'DRAFT'
     OR OLD.idempotency_key IS NULL
     OR EXISTS (
       SELECT 1
       FROM public.oc_recepcion_items ri
       WHERE ri.recepcion_id = OLD.id
         AND ri.empresa_id = OLD.empresa_id
         AND ri.inventory_movement_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Solo se puede eliminar un borrador canónico sin movimientos';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_non_draft_oc_receipt_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_prevent_non_draft_oc_receipt_delete ON public.oc_recepciones;
CREATE TRIGGER trg_prevent_non_draft_oc_receipt_delete
  BEFORE DELETE ON public.oc_recepciones
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_non_draft_oc_receipt_delete();

CREATE OR REPLACE FUNCTION public.prevent_order_quantity_below_confirmed_receipts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_received_quantity numeric;
BEGIN
  IF NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(ri.cantidad_recibida), 0)
  INTO v_received_quantity
  FROM public.oc_recepcion_items ri
  JOIN public.oc_recepciones r
    ON r.id = ri.recepcion_id
   AND r.empresa_id = ri.empresa_id
  WHERE ri.order_item_id = OLD.id
    AND ri.empresa_id = OLD.empresa_id
    AND r.order_id = OLD.order_id
    AND r.empresa_id = OLD.empresa_id
    AND r.status = 'CONFIRMED';

  IF NEW.quantity IS NULL OR NEW.quantity < v_received_quantity THEN
    RAISE EXCEPTION 'La cantidad de OC no puede quedar debajo de lo ya recibido';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_order_quantity_below_confirmed_receipts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_prevent_order_quantity_below_confirmed_receipts ON public.authorized_order_items;
CREATE TRIGGER trg_prevent_order_quantity_below_confirmed_receipts
  BEFORE UPDATE OF quantity ON public.authorized_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_order_quantity_below_confirmed_receipts();

CREATE OR REPLACE FUNCTION public.inventory_create_receipt(
  p_empresa_id           uuid,
  p_order_id             uuid,
  p_fecha                date,
  p_recibido_por         text,
  p_delivery_location_id uuid,
  p_remision_number      text,
  p_idempotency_key      text,
  p_created_by           uuid,
  p_notes                text,
  p_items                jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_location record;
  v_existing record;
  v_receipt_id uuid;
  v_requested_items jsonb;
  v_stored_items jsonb;
  v_key text := nullif(trim(p_idempotency_key), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF public.current_empresa_id() IS NULL
       OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[])
       OR p_created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Acceso denegado para crear recepciÃ³n';
    END IF;
  END IF;

  IF p_empresa_id IS NULL OR p_order_id IS NULL OR p_fecha IS NULL
     OR nullif(trim(p_recibido_por), '') IS NULL
     OR v_key IS NULL OR length(v_key) > 200
     OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'La recepciÃ³n necesita OC, fecha, responsable, clave e Ã­tems';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las lÃ­neas de recepciÃ³n deben ser un arreglo JSON';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La recepciÃ³n necesita al menos una lÃ­nea';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_created_by AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El creador no pertenece a la empresa de la recepciÃ³n';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(item)
    WHERE entry.item->>'order_item_id' IS NULL
       OR entry.item->>'cantidad_recibida' IS NULL
       OR lower(entry.item->>'cantidad_recibida') IN ('nan', 'infinity', '-infinity')
       OR round((entry.item->>'cantidad_recibida')::numeric, 2) <= 0
  ) THEN
    RAISE EXCEPTION 'Cada lÃ­nea necesita Ã­tem de OC y cantidad positiva';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (entry.item->>'order_item_id')::uuid AS order_item_id
      FROM jsonb_array_elements(p_items) AS entry(item)
    ) requested
    GROUP BY requested.order_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se puede repetir un Ã­tem de OC en una recepciÃ³n';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_empresa_id::text || ':receipt:' || v_key, 0)
  );

  SELECT ao.id, ao.project_id
  INTO v_order
  FROM public.authorized_orders ao
  WHERE ao.id = p_order_id AND ao.empresa_id = p_empresa_id
  FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC no encontrada para esta empresa'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(item)
    LEFT JOIN public.authorized_order_items oi
      ON oi.id = (entry.item->>'order_item_id')::uuid
     AND oi.order_id = p_order_id
     AND oi.empresa_id = p_empresa_id
    WHERE oi.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Una lÃ­nea de recepciÃ³n no pertenece a la OC y empresa';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(item)
    JOIN public.authorized_order_items oi
      ON oi.id = (entry.item->>'order_item_id')::uuid
     AND oi.order_id = p_order_id
     AND oi.empresa_id = p_empresa_id
    LEFT JOIN public.productos p
      ON p.id = nullif(entry.item->>'producto_id', '')::uuid
     AND p.empresa_id = p_empresa_id
    WHERE (
      oi.producto_id IS NOT NULL
      AND oi.producto_id IS DISTINCT FROM nullif(entry.item->>'producto_id', '')::uuid
    ) OR (
      nullif(entry.item->>'producto_id', '') IS NOT NULL
      AND (p.id IS NULL OR trim(p.unidad) IS DISTINCT FROM trim(oi.unit))
    )
  ) THEN
    RAISE EXCEPTION 'El material no pertenece a la empresa o su unidad no coincide con la OC';
  END IF;

  IF p_delivery_location_id IS NOT NULL THEN
    SELECT il.id, il.location_type, il.project_id
    INTO v_location
    FROM public.inventory_locations il
    WHERE il.id = p_delivery_location_id
      AND il.empresa_id = p_empresa_id
      AND il.active;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ubicaciÃ³n de entrega no pertenece a la empresa o estÃ¡ inactiva'; END IF;
    IF v_location.location_type = 'PROJECT'
       AND (v_order.project_id IS NULL OR v_location.project_id IS DISTINCT FROM v_order.project_id) THEN
      RAISE EXCEPTION 'La ubicaciÃ³n de obra no coincide con la OC';
    ELSIF v_location.location_type = 'CENTRAL' AND v_location.project_id IS NOT NULL THEN
      RAISE EXCEPTION 'La ubicaciÃ³n central no puede pertenecer a una obra';
    ELSIF v_location.location_type NOT IN ('CENTRAL', 'PROJECT') THEN
      RAISE EXCEPTION 'La recepciÃ³n requiere una ubicaciÃ³n central o de la obra de la OC';
    END IF;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_item_id', normalized.order_item_id,
        'producto_id', normalized.producto_id,
        'cantidad_recibida', normalized.cantidad_recibida,
        'notas', normalized.notas
      ) ORDER BY normalized.order_item_id
    ),
    '[]'::jsonb
  )
  INTO v_requested_items
  FROM (
    SELECT (entry.item->>'order_item_id')::uuid AS order_item_id,
           nullif(entry.item->>'producto_id', '')::uuid AS producto_id,
           round((entry.item->>'cantidad_recibida')::numeric, 2) AS cantidad_recibida,
           nullif(trim(entry.item->>'notas'), '') AS notas
    FROM jsonb_array_elements(p_items) AS entry(item)
  ) normalized;

  SELECT * INTO v_existing
  FROM public.oc_recepciones r
  WHERE r.empresa_id = p_empresa_id
    AND r.idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_item_id', ri.order_item_id,
          'producto_id', ri.producto_id,
          'cantidad_recibida', ri.cantidad_recibida,
          'notas', nullif(trim(ri.notas), '')
        ) ORDER BY ri.order_item_id
      ),
      '[]'::jsonb
    )
    INTO v_stored_items
    FROM public.oc_recepcion_items ri
    WHERE ri.recepcion_id = v_existing.id
      AND ri.empresa_id = p_empresa_id;

    IF v_existing.order_id IS DISTINCT FROM p_order_id
       OR v_existing.fecha IS DISTINCT FROM p_fecha
       OR v_existing.recibido_por IS DISTINCT FROM trim(p_recibido_por)
       OR v_existing.notas IS DISTINCT FROM nullif(trim(p_notes), '')
       OR v_existing.remision_number IS DISTINCT FROM nullif(trim(p_remision_number), '')
       OR (p_delivery_location_id IS NOT NULL
           AND v_existing.delivery_location_id IS DISTINCT FROM p_delivery_location_id)
       OR v_stored_items IS DISTINCT FROM v_requested_items THEN
      RAISE EXCEPTION 'La clave de idempotencia ya fue usada con otro contenido';
    END IF;
    RETURN jsonb_build_object('receipt_id', v_existing.id, 'created', false);
  END IF;

  INSERT INTO public.oc_recepciones (
    empresa_id, order_id, fecha, recibido_por, notas, delivery_location_id,
    remision_number, idempotency_key, status, created_by
  ) VALUES (
    p_empresa_id, p_order_id, p_fecha, trim(p_recibido_por), nullif(trim(p_notes), ''),
    p_delivery_location_id, nullif(trim(p_remision_number), ''), v_key, 'DRAFT', p_created_by
  )
  RETURNING id INTO v_receipt_id;

  INSERT INTO public.oc_recepcion_items (
    empresa_id, recepcion_id, order_item_id, producto_id, cantidad_recibida, notas
  )
  SELECT p_empresa_id,
         v_receipt_id,
         (entry.item->>'order_item_id')::uuid,
         nullif(entry.item->>'producto_id', '')::uuid,
         round((entry.item->>'cantidad_recibida')::numeric, 2),
         nullif(trim(entry.item->>'notas'), '')
  FROM jsonb_array_elements(p_items) AS entry(item);

  RETURN jsonb_build_object('receipt_id', v_receipt_id, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_create_receipt(uuid, uuid, date, text, uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_create_receipt(uuid, uuid, date, text, uuid, text, text, uuid, text, jsonb) TO authenticated, service_role;

-- Confirmed receipts are the only OC receipts visible to inbound readers.
CREATE OR REPLACE VIEW public.oc_order_item_recibido
WITH (security_invoker = true) AS
SELECT ri.order_item_id,
       ri.empresa_id,
       sum(ri.cantidad_recibida) AS cantidad_recibida_total
FROM public.oc_recepcion_items ri
JOIN public.oc_recepciones r
  ON r.id = ri.recepcion_id
 AND r.empresa_id = ri.empresa_id
WHERE r.status = 'CONFIRMED'
GROUP BY ri.order_item_id, ri.empresa_id;

CREATE OR REPLACE FUNCTION public.enforce_confirmed_canonical_oc_receipt_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
BEGIN
  IF NEW.movement_type <> 'RECEIPT' OR NEW.source_type <> 'OC_RECEPCION' THEN
    RETURN NEW;
  END IF;

  SELECT r.status, r.idempotency_key, r.delivery_location_id,
         ri.producto_id, ri.cantidad_recibida
  INTO v_receipt
  FROM public.oc_recepciones r
  JOIN public.oc_recepcion_items ri
    ON ri.recepcion_id = r.id
   AND ri.empresa_id = r.empresa_id
   AND ri.id = NEW.source_line_id
  WHERE r.id = NEW.source_id
    AND r.empresa_id = NEW.empresa_id;

  IF NOT FOUND
     OR v_receipt.status IS DISTINCT FROM 'CONFIRMED'
     OR v_receipt.idempotency_key IS NULL
     OR v_receipt.producto_id IS DISTINCT FROM NEW.producto_id
     OR v_receipt.cantidad_recibida IS DISTINCT FROM NEW.quantity
     OR v_receipt.delivery_location_id IS DISTINCT FROM NEW.to_location_id THEN
    RAISE EXCEPTION 'El movimiento requiere una lÃ­nea de recepciÃ³n canÃ³nica confirmada e idÃ©ntica';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_confirmed_canonical_oc_receipt_movement() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_confirmed_canonical_oc_receipt_movement ON public.inventory_movements;
CREATE TRIGGER trg_confirmed_canonical_oc_receipt_movement
  BEFORE INSERT OR UPDATE ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_confirmed_canonical_oc_receipt_movement();

CREATE OR REPLACE FUNCTION public.enforce_oc_receipt_line_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt_status text;
  v_delivery_location_id uuid;
  v_receipt_id uuid;
BEGIN
  v_receipt_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.recepcion_id ELSE NEW.recepcion_id END;
  SELECT r.status, r.delivery_location_id
  INTO v_receipt_status, v_delivery_location_id
  FROM public.oc_recepciones r
  WHERE r.id = v_receipt_id
  FOR UPDATE;

  -- A parent deletion cascades after the parent row is no longer visible.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recepción no encontrada para la línea'; END IF;
  IF v_receipt_status = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Confirmation may attach only the exact canonical movement just posted by
  -- inventory_confirm_receipt. All receipt payload fields remain immutable.
  IF TG_OP = 'UPDATE'
     AND OLD.inventory_movement_id IS NULL
     AND NEW.inventory_movement_id IS NOT NULL
     AND (to_jsonb(NEW) - 'inventory_movement_id')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'inventory_movement_id')
     AND EXISTS (
       SELECT 1
       FROM public.inventory_movements m
       WHERE m.id = NEW.inventory_movement_id
         AND m.empresa_id = NEW.empresa_id
         AND m.movement_type = 'RECEIPT'
         AND m.source_type = 'OC_RECEPCION'
         AND m.source_id = NEW.recepcion_id
         AND m.source_line_id = NEW.id
         AND m.producto_id = NEW.producto_id
         AND m.quantity = NEW.cantidad_recibida
         AND m.to_location_id = v_delivery_location_id
         AND m.status = 'CONFIRMED'
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Las líneas de una recepción confirmada o anulada son inmutables';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_oc_receipt_line_immutability() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_oc_receipt_line_immutability ON public.oc_recepcion_items;
CREATE TRIGGER trg_oc_receipt_line_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.oc_recepcion_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_oc_receipt_line_immutability();

CREATE OR REPLACE FUNCTION public.inventory_confirm_receipt(
  p_empresa_id           uuid,
  p_receipt_id           uuid,
  p_delivery_location_id uuid DEFAULT NULL,
  p_idempotency_key      text DEFAULT NULL,
  p_confirmed_by         uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
  v_order record;
  v_location record;
  v_location_id uuid := p_delivery_location_id;
  v_item record;
  v_movement uuid;
  v_ids uuid[] := '{}';
  v_key text;
  v_received_quantity numeric;
  v_has_stock boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF public.current_empresa_id() IS NULL
       OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[])
       OR p_confirmed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar recepciÃ³n';
    END IF;
  END IF;
  IF p_confirmed_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_confirmed_by AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El confirmante no pertenece a la empresa';
  END IF;

  SELECT * INTO v_receipt
  FROM public.oc_recepciones r
  WHERE r.id = p_receipt_id AND r.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RecepciÃ³n no encontrada'; END IF;
  IF v_receipt.status = 'VOIDED' THEN RAISE EXCEPTION 'La recepciÃ³n estÃ¡ anulada'; END IF;
  IF v_receipt.status = 'DRAFT' AND v_receipt.idempotency_key IS NULL THEN
    RAISE EXCEPTION 'El borrador histórico requiere reconciliación manual';
  END IF;
  IF v_receipt.idempotency_key IS NOT NULL
     AND nullif(trim(p_idempotency_key), '') IS NOT NULL
     AND nullif(trim(p_idempotency_key), '') IS DISTINCT FROM v_receipt.idempotency_key THEN
    RAISE EXCEPTION 'La clave de confirmación no coincide con la clave de creación';
  END IF;
  IF v_receipt.status = 'CONFIRMED' THEN
    IF p_delivery_location_id IS NOT NULL
       AND p_delivery_location_id IS DISTINCT FROM v_receipt.delivery_location_id THEN
      RAISE EXCEPTION 'La recepciÃ³n ya fue confirmada en otra ubicaciÃ³n';
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

  SELECT ao.id, ao.project_id, ao.currency
  INTO v_order
  FROM public.authorized_orders ao
  WHERE ao.id = v_receipt.order_id AND ao.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La OC de la recepciÃ³n no pertenece a la empresa'; END IF;

  -- Serialize quantity edits against confirmation. All receipt confirmations
  -- lock their order header first, then these line rows in a stable order.
  PERFORM oi.id
  FROM public.authorized_order_items oi
  JOIN public.oc_recepcion_items ri
    ON ri.order_item_id = oi.id
   AND ri.empresa_id = oi.empresa_id
  WHERE ri.recepcion_id = p_receipt_id
    AND ri.empresa_id = p_empresa_id
    AND oi.order_id = v_receipt.order_id
    AND oi.empresa_id = p_empresa_id
  ORDER BY oi.id
  FOR UPDATE OF oi;

  IF NOT EXISTS (
    SELECT 1 FROM public.oc_recepcion_items ri
    WHERE ri.recepcion_id = p_receipt_id AND ri.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La recepciÃ³n necesita al menos una lÃ­nea';
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
    RAISE EXCEPTION 'Una lÃ­nea de recepciÃ³n no pertenece a la OC';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.oc_recepcion_items ri
    WHERE ri.recepcion_id = p_receipt_id AND ri.empresa_id = p_empresa_id
    GROUP BY ri.order_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'No se puede repetir un Ã­tem de OC dentro de una recepciÃ³n';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.oc_recepcion_items ri
    JOIN public.authorized_order_items oi
      ON oi.id = ri.order_item_id
     AND oi.order_id = v_receipt.order_id
     AND oi.empresa_id = p_empresa_id
    LEFT JOIN public.productos p
      ON p.id = ri.producto_id
     AND p.empresa_id = p_empresa_id
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
      AND (
        ri.cantidad_recibida <= 0
        OR (oi.producto_id IS NOT NULL AND oi.producto_id IS DISTINCT FROM ri.producto_id)
        OR (ri.producto_id IS NOT NULL AND (
          p.id IS NULL
          OR trim(p.unidad) IS DISTINCT FROM trim(oi.unit)
          OR oi.unit_price IS NULL
          OR oi.unit_price < 0
          OR v_order.currency IS NULL
        ))
      )
  ) THEN
    RAISE EXCEPTION 'La lÃ­nea de recepciÃ³n tiene material, unidad o costo invÃ¡lido';
  END IF;

  -- Locking the OC serializes all receipt confirmations for its order items.
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
    JOIN public.oc_recepciones r2
      ON r2.id = ri2.recepcion_id
     AND r2.empresa_id = ri2.empresa_id
    WHERE r2.order_id = v_receipt.order_id
      AND r2.empresa_id = p_empresa_id
      AND ri2.empresa_id = p_empresa_id
      AND ri2.order_item_id = v_item.order_item_id
      AND ri2.recepcion_id <> p_receipt_id
      AND r2.status = 'CONFIRMED';
    IF v_item.receipt_quantity > v_item.ordered_quantity - v_received_quantity THEN
      RAISE EXCEPTION 'La recepciÃ³n supera la cantidad pendiente de la lÃ­nea de OC';
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM public.oc_recepcion_items ri
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
      AND ri.producto_id IS NOT NULL
  ) INTO v_has_stock;
  v_location_id := coalesce(v_location_id, v_receipt.delivery_location_id);
  IF v_has_stock AND v_location_id IS NULL THEN
    SELECT il.id INTO v_location_id
    FROM public.inventory_locations il
    WHERE il.empresa_id = p_empresa_id
      AND il.active
      AND (
        (v_order.project_id IS NOT NULL AND il.location_type = 'PROJECT' AND il.project_id = v_order.project_id)
        OR (v_order.project_id IS NULL AND il.location_type = 'CENTRAL' AND il.is_primary)
      )
    ORDER BY il.is_primary DESC, il.created_at
    LIMIT 1;
  END IF;
  IF v_has_stock AND v_location_id IS NULL THEN
    RAISE EXCEPTION 'La recepciÃ³n necesita una ubicaciÃ³n de entrega vÃ¡lida';
  END IF;
  IF v_location_id IS NOT NULL THEN
    SELECT il.id, il.location_type, il.project_id
    INTO v_location
    FROM public.inventory_locations il
    WHERE il.id = v_location_id
      AND il.empresa_id = p_empresa_id
      AND il.active;
    IF NOT FOUND THEN RAISE EXCEPTION 'La ubicaciÃ³n de entrega no pertenece a la empresa o estÃ¡ inactiva'; END IF;
    IF v_location.location_type = 'PROJECT'
       AND (v_order.project_id IS NULL OR v_location.project_id IS DISTINCT FROM v_order.project_id) THEN
      RAISE EXCEPTION 'La ubicaciÃ³n de obra no coincide con la OC';
    ELSIF v_location.location_type = 'CENTRAL' AND v_location.project_id IS NOT NULL THEN
      RAISE EXCEPTION 'La ubicaciÃ³n central no puede pertenecer a una obra';
    ELSIF v_location.location_type NOT IN ('CENTRAL', 'PROJECT') THEN
      RAISE EXCEPTION 'La recepciÃ³n requiere una ubicaciÃ³n central o de la obra de la OC';
    END IF;
  END IF;

  -- Set state inside this transaction before inserting receipt movements. Any
  -- later error rolls the status and every balance/movement write back together.
  UPDATE public.oc_recepciones
  SET delivery_location_id = v_location_id,
      status = 'CONFIRMED',
      confirmed_by = p_confirmed_by,
      confirmed_at = now(),
      updated_at = now()
  WHERE id = p_receipt_id AND empresa_id = p_empresa_id;

  FOR v_item IN
    SELECT ri.id, ri.producto_id, ri.cantidad_recibida, ri.inventory_movement_id,
           oi.unit, oi.unit_price
    FROM public.oc_recepcion_items ri
    JOIN public.authorized_order_items oi
      ON oi.id = ri.order_item_id
     AND oi.order_id = v_receipt.order_id
     AND oi.empresa_id = p_empresa_id
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
    ORDER BY ri.id
  LOOP
    IF v_item.inventory_movement_id IS NOT NULL THEN
      v_ids := array_append(v_ids, v_item.inventory_movement_id);
      CONTINUE;
    END IF;
    IF v_item.producto_id IS NULL THEN
      CONTINUE;
    END IF;
    v_key := coalesce(nullif(trim(p_idempotency_key), ''), v_receipt.idempotency_key, p_receipt_id::text)
      || ':' || v_item.id::text;
    v_movement := public.inventory_post_movement(
      p_empresa_id := p_empresa_id,
      p_producto_id := v_item.producto_id,
      p_quantity := v_item.cantidad_recibida,
      p_unit := v_item.unit,
      p_movement_type := 'RECEIPT',
      p_to_location_id := v_location_id,
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
    WHERE id = v_item.id
      AND recepcion_id = p_receipt_id
      AND empresa_id = p_empresa_id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_confirm_receipt(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_confirm_receipt(uuid, uuid, uuid, text, uuid) TO authenticated, service_role;
