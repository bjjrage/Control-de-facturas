-- Keep the physical external receiver distinct from the internal portal sponsor.
BEGIN;
CREATE OR REPLACE FUNCTION public.inventory_confirm_receipt(p_empresa_id uuid, p_receipt_id uuid, p_delivery_location_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_confirmed_by uuid DEFAULT NULL::uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_portal_link_id uuid;
  v_portal_source text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF public.current_empresa_id() IS NULL
       OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[])
       OR p_confirmed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar recepciÃ³n';
    END IF;
  END IF;
  IF p_confirmed_by IS NOT NULL AND NOT EXISTS (
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
  -- Anonymous physical receiver, authorized only by this unconsumed delegation.
  -- No internal actor is impersonated as confirmer.
  IF p_confirmed_by IS NULL THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Portal confirmation is server only';
    END IF;
    IF v_receipt.idempotency_key LIKE 'warehouse-portal-receipt:%' THEN
      SELECT l.id INTO v_portal_link_id
      FROM public.warehouse_portal_links l
      JOIN public.inventory_locations loc ON loc.id = l.location_id
        AND loc.empresa_id = l.empresa_id AND loc.active AND loc.location_type = 'PROJECT'
      JOIN public.authorized_orders ord ON ord.id = v_receipt.order_id
        AND ord.empresa_id = l.empresa_id AND ord.project_id = loc.project_id
      JOIN public.profiles sponsor ON sponsor.id = l.created_by AND sponsor.empresa_id = l.empresa_id
      JOIN public.empresas e ON e.id = l.empresa_id
      WHERE l.empresa_id = p_empresa_id
        AND l.location_id = v_receipt.delivery_location_id
        AND l.location_id = p_delivery_location_id
        AND l.created_by = v_receipt.created_by
        AND p_idempotency_key = v_receipt.idempotency_key
        AND v_receipt.idempotency_key LIKE 'warehouse-portal-receipt:' || l.id::text || ':%'
        AND l.active AND (l.expires_at IS NULL OR l.expires_at > now())
        AND sponsor.active AND e.active AND sponsor.role IN ('administracion', 'admin')
      FOR UPDATE OF l;
      IF NOT FOUND OR v_receipt.status NOT IN ('DRAFT', 'CONFIRMED')
         OR EXISTS (SELECT 1 FROM public.oc_recepcion_items ri
            WHERE ri.recepcion_id = p_receipt_id
              AND ri.empresa_id = p_empresa_id AND ri.producto_id IS NULL) THEN
        RAISE EXCEPTION 'A valid scoped warehouse link and materials are required';
      END IF;
      v_portal_source := 'WAREHOUSE_PORTAL';
    ELSE
      SELECT l.id INTO v_portal_link_id
      FROM public.receipt_portal_links l
      JOIN public.profiles sponsor ON sponsor.id = l.created_by AND sponsor.empresa_id = l.empresa_id
      JOIN public.empresas e ON e.id = l.empresa_id
      WHERE l.empresa_id = p_empresa_id AND l.order_id = v_receipt.order_id
        AND l.location_id = v_receipt.delivery_location_id
        AND l.location_id = p_delivery_location_id
        AND l.created_by = v_receipt.created_by
        AND v_receipt.idempotency_key = 'receipt-portal:' || l.id::text
        AND p_idempotency_key = v_receipt.idempotency_key
        AND l.active AND l.expires_at > now()
        AND sponsor.active AND e.active AND sponsor.role IN ('administracion', 'admin')
      FOR UPDATE OF l;
      IF NOT FOUND OR v_receipt.status IS DISTINCT FROM 'DRAFT'
         OR NOT EXISTS (SELECT 1 FROM public.inventory_receipt_evidence ev
            WHERE ev.receipt_id = p_receipt_id AND ev.empresa_id = p_empresa_id)
         OR EXISTS (SELECT 1 FROM public.oc_recepcion_items ri
            WHERE ri.recepcion_id = p_receipt_id AND ri.empresa_id = p_empresa_id AND ri.producto_id IS NULL) THEN
        RAISE EXCEPTION 'A valid scoped receipt link, materials and evidence are required';
      END IF;
    v_portal_source := 'RECEIPT_PORTAL';
    END IF;
  END IF;
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
        || CASE WHEN v_portal_link_id IS NOT NULL THEN jsonb_build_object(
          'confirmation_source', v_portal_source,
          CASE WHEN v_portal_source = 'WAREHOUSE_PORTAL' THEN 'warehouse_portal_link_id' ELSE 'receipt_portal_link_id' END, v_portal_link_id,
          'received_by', v_receipt.recibido_por, 'received_on', v_receipt.fecha
        ) ELSE '{}'::jsonb END
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
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_portal_receipt(p_token_hash text,p_order uuid,p_date date,p_received_by text,p_remision text,p_attempt uuid,p_notes text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link public.warehouse_portal_links; location public.inventory_locations; receipt jsonb; movements uuid[]; k text;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
 SELECT * INTO link FROM public.warehouse_portal_links WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR NOT link.active OR (link.expires_at IS NOT NULL AND link.expires_at<=now()) OR p_attempt IS NULL THEN RAISE EXCEPTION 'Portal expired/revoked or attempt missing'; END IF;
 SELECT * INTO location FROM public.inventory_locations WHERE id=link.location_id AND empresa_id=link.empresa_id AND active AND location_type='PROJECT';
 IF NOT FOUND OR location.project_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.authorized_orders WHERE id=p_order AND project_id=location.project_id AND empresa_id=link.empresa_id) THEN RAISE EXCEPTION 'Order outside portal context'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id WHERE p.id=link.created_by AND p.empresa_id=link.empresa_id AND p.active AND e.active AND p.role IN ('administracion','admin')) THEN RAISE EXCEPTION 'Active portal sponsor required'; END IF;
 k:='warehouse-portal-receipt:'||link.id::text||':'||p_attempt::text;
 receipt:=public.inventory_create_receipt(link.empresa_id,p_order,p_date,p_received_by,location.id,p_remision,k,link.created_by,p_notes,p_items);
 movements:=public.inventory_confirm_receipt(link.empresa_id,(receipt->>'receipt_id')::uuid,location.id,k,NULL);
 RETURN receipt||jsonb_build_object('movements',movements,'portal_link_id',link.id);
END $$;
REVOKE ALL ON FUNCTION public.inventory_portal_receipt(text,uuid,date,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_portal_receipt(text,uuid,date,text,text,uuid,text,jsonb) TO service_role;

COMMIT;
