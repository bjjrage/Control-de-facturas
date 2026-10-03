-- Batch05: restore existing canonical contracts omitted from the production baseline.
-- No historical receipt promotion, inventory backfill or reconciliation DML.
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

CREATE OR REPLACE FUNCTION public.inventory_set_receipt_item_product(
  p_empresa_id uuid,
  p_receipt_id uuid,
  p_item_id uuid,
  p_product_id uuid,
  p_updated_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt public.oc_recepciones%ROWTYPE;
  v_item public.oc_recepcion_items%ROWTYPE;
  v_order_unit text;
  v_order_product_id uuid;
  v_product_unit text;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
       OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
       OR p_updated_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Acceso denegado para vincular material a recepción';
    END IF;
  END IF;
  IF p_updated_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_updated_by AND p.empresa_id = p_empresa_id
  ) THEN RAISE EXCEPTION 'El revisor no pertenece a la empresa'; END IF;

  SELECT r.* INTO v_receipt
  FROM public.oc_recepciones r
  WHERE r.id = p_receipt_id AND r.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'La recepción ya no está pendiente de revisión';
  END IF;

  SELECT ri.* INTO v_item
  FROM public.oc_recepcion_items ri
  WHERE ri.id = p_item_id AND ri.recepcion_id = p_receipt_id AND ri.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La línea no pertenece a la recepción'; END IF;

  SELECT oi.unit, oi.producto_id, p.unidad
  INTO v_order_unit, v_order_product_id, v_product_unit
  FROM public.authorized_order_items oi
  JOIN public.productos p ON p.id = p_product_id AND p.empresa_id = p_empresa_id AND p.activo
  WHERE oi.id = v_item.order_item_id
    AND oi.order_id = v_receipt.order_id
    AND oi.empresa_id = p_empresa_id;
  IF NOT FOUND OR btrim(v_order_unit) IS DISTINCT FROM btrim(v_product_unit)
     OR (v_order_product_id IS NOT NULL AND v_order_product_id IS DISTINCT FROM p_product_id) THEN
    RAISE EXCEPTION 'El producto no pertenece a la empresa o su unidad no coincide con la OC';
  END IF;

  UPDATE public.oc_recepcion_items
  SET producto_id = p_product_id
  WHERE id = v_item.id AND recepcion_id = v_receipt.id AND empresa_id = p_empresa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_receipt_portal_link(uuid, uuid, uuid, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_receipt_portal(text, date, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_set_receipt_item_product(uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_receipt_portal_link(uuid, uuid, uuid, text, text, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_receipt_portal(text, date, text, text, text, jsonb, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_set_receipt_item_product(uuid, uuid, uuid, uuid, uuid)
  TO authenticated, service_role;


-- `status` and confirmation metadata may only be changed by the canonical
-- submission confirmer or trusted server-side portal/processing code.
REVOKE UPDATE ON public.warehouse_submissions FROM PUBLIC, anon, authenticated;
-- A prior migration granted column-level UPDATE as well; table-level REVOKE
-- does not clear those independent ACL entries.
REVOKE UPDATE (
  id, empresa_id, location_id, project_id, portal_link_id, period_start,
  period_end, remision_number, notes, status, processing_error,
  submitted_by, reviewed_by, confirmed_by, processing_started_at,
  processed_at, confirmed_at, created_at, updated_at
) ON public.warehouse_submissions FROM PUBLIC, anon, authenticated;

-- Legacy projections and movement rows are not an alternate write path.
-- Canonical SECURITY DEFINER ledger functions remain able to maintain them.
REVOKE INSERT, UPDATE ON public.productos FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  empresa_id, nombre, descripcion, unidad, sku, stock_minimo, activo,
  created_by, contenido_por_unidad, unidad_base, categoria_id
) ON public.productos TO authenticated;
GRANT UPDATE (
  nombre, descripcion, unidad, sku, stock_minimo, activo, updated_at,
  contenido_por_unidad, unidad_base, categoria_id
) ON public.productos TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.stock_movimientos
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_confirmed_warehouse_submission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_id uuid;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'warehouse_submissions' THEN
    IF (TG_OP = 'DELETE' AND OLD.status = 'CONFIRMED')
       OR (TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED') THEN
      RAISE EXCEPTION 'Una rendición confirmada es inmutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_submission_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  SELECT status INTO v_status
  FROM public.warehouse_submissions
  WHERE id = v_submission_id
  FOR UPDATE;
  IF v_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Las líneas de una rendición confirmada son inmutables';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_confirmed_warehouse_submission_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_mutation
  ON public.warehouse_submissions;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_mutation
  BEFORE UPDATE OR DELETE ON public.warehouse_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_mutation();
DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_line_mutation
  ON public.warehouse_submission_lines;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_line_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.warehouse_submission_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_mutation();

-- Only the locked submission confirmer may emit movements carrying this
-- source. Prevents a direct inventory_post_movement call from creating an
-- extra/unlinked consumption that masquerades as part of a submission.
CREATE OR REPLACE FUNCTION public.enforce_warehouse_submission_movement_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_line record;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'WAREHOUSE_SUBMISSION' THEN
    RETURN NEW;
  END IF;

  IF NEW.movement_type IS DISTINCT FROM 'CONSUMPTION'
     OR NEW.source_id IS NULL OR NEW.source_line_id IS NULL
     OR current_setting('app.warehouse_submission_confirmation', true)
        IS DISTINCT FROM NEW.source_id::text THEN
    RAISE EXCEPTION 'Los consumos de rendición solo pueden generarse desde su confirmación canónica';
  END IF;

  SELECT id, empresa_id, location_id, project_id, status, upload_incomplete
    INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = NEW.source_id AND empresa_id = NEW.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status NOT IN ('READY', 'NEEDS_REVIEW')
     OR v_submission.upload_incomplete THEN
    RAISE EXCEPTION 'La rendición no pertenece a la empresa o no está lista para consumir';
  END IF;

  SELECT id, empresa_id, submission_id, producto_id, quantity, unit,
         budget_item_id, state
    INTO v_line
  FROM public.warehouse_submission_lines
  WHERE id = NEW.source_line_id
    AND submission_id = NEW.source_id
    AND empresa_id = NEW.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_line.state IS DISTINCT FROM 'CONFIRMED'
     OR NEW.producto_id IS DISTINCT FROM v_line.producto_id
     OR NEW.quantity IS DISTINCT FROM v_line.quantity
     OR NEW.unit IS DISTINCT FROM v_line.unit
     OR NEW.budget_item_id IS DISTINCT FROM v_line.budget_item_id
     OR NEW.from_location_id IS DISTINCT FROM v_submission.location_id
     OR NEW.to_location_id IS NOT NULL
     OR NEW.project_id IS DISTINCT FROM v_submission.project_id THEN
    RAISE EXCEPTION 'El consumo no coincide con la línea confirmada de la rendición';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_warehouse_submission_movement_source()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_enforce_warehouse_submission_movement_source
  ON public.inventory_movements;
CREATE TRIGGER trg_enforce_warehouse_submission_movement_source
  BEFORE INSERT OR UPDATE ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_warehouse_submission_movement_source();

CREATE OR REPLACE FUNCTION public.enforce_warehouse_submission_canonical_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Una rendición solo puede confirmarse mediante el flujo canónico';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Una rendición confirmada es inmutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = 'CONFIRMED'
     AND OLD.status IS DISTINCT FROM 'CONFIRMED' THEN
    IF NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL
       OR NEW.project_id IS NULL OR NEW.location_id IS NULL THEN
      RAISE EXCEPTION 'La confirmación requiere responsable, obra y ubicación';
    END IF;
    IF NEW.upload_incomplete THEN
      RAISE EXCEPTION 'La rendición tiene cargas de archivos incompletas o pendientes';
    END IF;
    IF auth.uid() IS NOT NULL
       AND NEW.confirmed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'El confirmador debe coincidir con el usuario autenticado';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      WHERE l.submission_id = NEW.id
        AND l.empresa_id = NEW.empresa_id
        AND l.state = 'CONFIRMED'
    ) OR EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      LEFT JOIN public.inventory_movements m
        ON m.id = l.inventory_movement_id
       AND m.empresa_id = NEW.empresa_id
      WHERE l.submission_id = NEW.id
        AND l.empresa_id = NEW.empresa_id
        AND (
          l.state = 'PROPOSED'
          OR (l.state = 'REJECTED' AND l.inventory_movement_id IS NOT NULL)
          OR (l.state = 'CONFIRMED' AND (
            l.producto_id IS NULL
            OR l.quantity IS NULL
            OR l.unit IS NULL
            OR l.budget_item_id IS NULL
            OR l.inventory_movement_id IS NULL
            OR m.id IS NULL
            OR m.status IS DISTINCT FROM 'CONFIRMED'
            OR m.movement_type IS DISTINCT FROM 'CONSUMPTION'
            OR m.source_type IS DISTINCT FROM 'WAREHOUSE_SUBMISSION'
            OR m.source_id IS DISTINCT FROM NEW.id
            OR m.source_line_id IS DISTINCT FROM l.id
            OR m.producto_id IS DISTINCT FROM l.producto_id
            OR m.quantity IS DISTINCT FROM l.quantity
            OR m.unit IS DISTINCT FROM l.unit
            OR nullif(btrim(l.raw_description), '') IS NULL
            OR btrim(l.raw_description) ~* '^fila [0-9]+: descripción pendiente$'
            OR m.project_id IS DISTINCT FROM NEW.project_id
            OR m.from_location_id IS DISTINCT FROM NEW.location_id
            OR m.budget_item_id IS DISTINCT FROM l.budget_item_id
          ))
        )
    ) THEN
      RAISE EXCEPTION 'La rendición no tiene consumos canónicos completos y conciliados';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_warehouse_submission_canonical_confirmation()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_enforce_warehouse_submission_canonical_confirmation
  ON public.warehouse_submissions;
CREATE TRIGGER trg_enforce_warehouse_submission_canonical_confirmation
  BEFORE INSERT OR UPDATE ON public.warehouse_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_warehouse_submission_canonical_confirmation();

-- Confirmed rows created before this gate cannot be reported as a successful
-- idempotent confirmation unless every line is linked to its exact consumption.
CREATE OR REPLACE FUNCTION public.inventory_confirm_warehouse_submission(
  p_empresa_id uuid,
  p_submission_id uuid,
  p_confirmed_by uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_line record;
  v_movement uuid;
  v_ids uuid[] := '{}';
  v_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar rendición';
    END IF;
    IF p_confirmed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'El confirmador debe coincidir con el usuario autenticado';
    END IF;
  END IF;

  SELECT * INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rendición no encontrada'; END IF;
  IF v_submission.status = 'VOIDED' THEN RAISE EXCEPTION 'La rendición está anulada'; END IF;
  IF nullif(btrim(v_submission.processing_error), '') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.warehouse_submission_evidence e
       WHERE e.submission_id = p_submission_id
         AND e.empresa_id = p_empresa_id
         AND (
           e.extraction_status IN ('NOT_PROCESSED', 'PROCESSING', 'FAILED')
           OR e.extraction_error IS NOT NULL
         )
     ) THEN
    RAISE EXCEPTION 'Hay evidencia sin procesar o con errores; resolvé su revisión antes de confirmar';
  END IF;
  IF v_submission.status = 'CONFIRMED' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      WHERE l.submission_id = p_submission_id
        AND l.empresa_id = p_empresa_id
        AND l.state = 'CONFIRMED'
    ) OR EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      LEFT JOIN public.inventory_movements m
        ON m.id = l.inventory_movement_id
       AND m.empresa_id = p_empresa_id
      WHERE l.submission_id = p_submission_id
        AND l.empresa_id = p_empresa_id
        AND (
          l.state = 'PROPOSED'
          OR (l.state = 'REJECTED' AND l.inventory_movement_id IS NOT NULL)
          OR (l.state = 'CONFIRMED' AND (
            l.producto_id IS NULL
            OR l.quantity IS NULL
            OR l.unit IS NULL
            OR l.budget_item_id IS NULL
            OR l.inventory_movement_id IS NULL
            OR m.id IS NULL
            OR m.status IS DISTINCT FROM 'CONFIRMED'
            OR m.movement_type IS DISTINCT FROM 'CONSUMPTION'
            OR m.source_type IS DISTINCT FROM 'WAREHOUSE_SUBMISSION'
            OR m.source_id IS DISTINCT FROM p_submission_id
            OR m.source_line_id IS DISTINCT FROM l.id
            OR m.producto_id IS DISTINCT FROM l.producto_id
            OR m.quantity IS DISTINCT FROM l.quantity
            OR m.unit IS DISTINCT FROM l.unit
            OR nullif(btrim(l.raw_description), '') IS NULL
            OR btrim(l.raw_description) ~* '^fila [0-9]+: descripción pendiente$'
            OR m.project_id IS DISTINCT FROM v_submission.project_id
            OR m.from_location_id IS DISTINCT FROM v_submission.location_id
            OR m.budget_item_id IS DISTINCT FROM l.budget_item_id
          ))
        )
    ) THEN
      RAISE EXCEPTION 'La rendición confirmada no concilia con sus consumos canónicos; requiere revisión';
    END IF;

    SELECT coalesce(array_agg(l.inventory_movement_id ORDER BY l.line_number), '{}') INTO v_ids
    FROM public.warehouse_submission_lines l
    WHERE l.submission_id = p_submission_id
      AND l.empresa_id = p_empresa_id
      AND l.state = 'CONFIRMED';
    RETURN v_ids;
  END IF;
  IF v_submission.upload_incomplete THEN
    RAISE EXCEPTION 'La rendición tiene cargas de archivos incompletas o pendientes';
  END IF;
  IF v_submission.status NOT IN ('READY', 'NEEDS_REVIEW') THEN
    RAISE EXCEPTION 'La rendición todavía no está lista para confirmar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id
      AND empresa_id = p_empresa_id
      AND state = 'PROPOSED'
  ) THEN
    RAISE EXCEPTION 'La rendición todavía tiene líneas propuestas sin revisar';
  END IF;

  PERFORM set_config('app.warehouse_submission_confirmation', p_submission_id::text, true);
  FOR v_line IN
    SELECT * FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id
      AND empresa_id = p_empresa_id
      AND state = 'CONFIRMED'
    ORDER BY line_number
  LOOP
    IF v_line.producto_id IS NULL OR v_line.quantity IS NULL OR v_line.unit IS NULL
       OR v_line.budget_item_id IS NULL
       OR nullif(btrim(v_line.raw_description), '') IS NULL
       OR btrim(v_line.raw_description) ~* '^fila [0-9]+: descripción pendiente$' THEN
      RAISE EXCEPTION 'La línea % no está completa para confirmar', v_line.line_number;
    END IF;
    IF v_line.inventory_movement_id IS NOT NULL THEN
      v_ids := array_append(v_ids, v_line.inventory_movement_id);
      CONTINUE;
    END IF;
    v_key := coalesce(nullif(trim(p_idempotency_key), ''), p_submission_id::text) || ':' || v_line.id::text;
    v_movement := public.inventory_post_movement(
      p_empresa_id := p_empresa_id,
      p_producto_id := v_line.producto_id,
      p_quantity := v_line.quantity,
      p_unit := v_line.unit,
      p_movement_type := 'CONSUMPTION',
      p_from_location_id := v_submission.location_id,
      p_project_id := v_submission.project_id,
      p_budget_item_id := v_line.budget_item_id,
      p_source_type := 'WAREHOUSE_SUBMISSION',
      p_source_id := p_submission_id,
      p_source_line_id := v_line.id,
      p_idempotency_key := v_key,
      p_created_by := p_confirmed_by,
      p_metadata := jsonb_build_object('submission_id', p_submission_id, 'line_number', v_line.line_number)
    );
    UPDATE public.warehouse_submission_lines
    SET inventory_movement_id = v_movement, updated_at = now()
    WHERE id = v_line.id AND empresa_id = p_empresa_id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;
  PERFORM set_config('app.warehouse_submission_confirmation', '', true);

  UPDATE public.warehouse_submissions
  SET status = 'CONFIRMED', confirmed_by = p_confirmed_by,
      confirmed_at = now(), updated_at = now(), processing_error = NULL
  WHERE id = p_submission_id AND empresa_id = p_empresa_id;
  RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text)
  TO authenticated, service_role;

-- The legacy stock RPC bypasses inventory_movements/inventory_balances and
-- trusts a caller-supplied tenant id. Keep it present for migration history,
-- but remove its public application write surface entirely.
REVOKE ALL ON FUNCTION public.registrar_stock_movimiento(
  uuid, uuid, text, numeric, text, uuid, text, uuid, numeric
) FROM PUBLIC, anon, authenticated, service_role;



-- A confirmation may only consume a complete, successfully processed evidence set.
-- Row-level spreadsheet validation warnings are stored on the proposed lines and
-- must be reviewed there; failed/unprocessed evidence always blocks confirmation.
CREATE OR REPLACE FUNCTION public.prevent_confirmation_with_unresolved_warehouse_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED'
     AND OLD.status IS DISTINCT FROM 'CONFIRMED'
     AND EXISTS (
       SELECT 1
       FROM public.warehouse_submission_evidence e
       WHERE e.submission_id = NEW.id
         AND e.empresa_id = NEW.empresa_id
         AND (
           e.extraction_status IN ('NOT_PROCESSED', 'PROCESSING', 'FAILED')
           OR e.extraction_error IS NOT NULL
         )
     ) THEN
    RAISE EXCEPTION 'Hay evidencia sin procesar o con errores; resolvé su revisión antes de confirmar';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_confirmation_with_unresolved_warehouse_evidence()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_prevent_confirmation_with_unresolved_warehouse_evidence
  ON public.warehouse_submissions;
CREATE TRIGGER trg_prevent_confirmation_with_unresolved_warehouse_evidence
  BEFORE UPDATE OF status ON public.warehouse_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmation_with_unresolved_warehouse_evidence();


-- Add one review-only row to a submission backed by human-supplied evidence.
-- This enables photo-only renditions without interpreting image contents.
CREATE OR REPLACE FUNCTION public.inventory_add_manual_warehouse_submission_line(
  p_empresa_id uuid,
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_evidence_id uuid;
  v_line_number integer;
  v_line_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT coalesce(public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]), false) THEN
    RAISE EXCEPTION 'Acceso denegado para agregar una línea manual';
  END IF;

  SELECT id, project_id, status
    INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id
    AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rendición no encontrada o no pertenece a la empresa';
  END IF;
  IF v_submission.status NOT IN ('READY', 'NEEDS_REVIEW') THEN
    RAISE EXCEPTION 'La rendición debe terminar de procesarse antes de agregar líneas';
  END IF;

  SELECT id
    INTO v_evidence_id
  FROM public.warehouse_submission_evidence
  WHERE submission_id = p_submission_id
    AND empresa_id = p_empresa_id
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La rendición necesita evidencia antes de agregar una línea manual';
  END IF;

  SELECT coalesce(max(line_number), 0) + 1
    INTO v_line_number
  FROM public.warehouse_submission_lines
  WHERE submission_id = p_submission_id
    AND empresa_id = p_empresa_id;

  INSERT INTO public.warehouse_submission_lines (
    empresa_id,
    submission_id,
    line_number,
    raw_description,
    state,
    uncertainty_reason,
    confidence,
    source_evidence_id
  ) VALUES (
    p_empresa_id,
    p_submission_id,
    v_line_number,
    format('Fila %s: descripción pendiente', v_line_number),
    'PROPOSED',
    'Línea ingresada manualmente desde la evidencia; completar y revisar antes de confirmar.',
    0,
    v_evidence_id
  )
  RETURNING id INTO v_line_id;

  RETURN jsonb_build_object(
    'line_id', v_line_id,
    'project_id', v_submission.project_id,
    'line_number', v_line_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_add_manual_warehouse_submission_line(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_add_manual_warehouse_submission_line(uuid, uuid)
  TO authenticated;

-- Extraction state is controlled by the server-side processor only. A tenant
-- admin must not clear FAILED/PROCESSING evidence through the Data API.
REVOKE UPDATE, DELETE ON public.warehouse_submission_evidence
  FROM PUBLIC, anon, authenticated;
GRANT UPDATE ON public.warehouse_submission_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.validate_warehouse_submission_evidence_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_empresa uuid;
BEGIN
  SELECT empresa_id
    INTO v_submission_empresa
  FROM public.warehouse_submissions
  WHERE id = NEW.submission_id;

  IF v_submission_empresa IS NULL
     OR v_submission_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'La evidencia no pertenece a la rendición y tenant indicados';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_warehouse_submission_evidence_tenant()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_00_validate_warehouse_submission_evidence_tenant
  ON public.warehouse_submission_evidence;
CREATE TRIGGER trg_00_validate_warehouse_submission_evidence_tenant
  BEFORE INSERT OR UPDATE ON public.warehouse_submission_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_submission_evidence_tenant();
