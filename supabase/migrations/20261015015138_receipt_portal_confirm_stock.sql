-- Direct worksite receipt: validate delegation, preserve evidence and post stock
-- in one transaction. No historical data backfill or browser-role grant expansion.
-- Receipt created_by identifies the internal issuer of the delegation.
-- recibido_por and movement metadata identify the physical receiver;
-- confirmed_by stays NULL for the portal actor, never the issuer's user ID.

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
          'confirmation_source', 'RECEIPT_PORTAL', 'receipt_portal_link_id', v_portal_link_id,
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

CREATE OR REPLACE FUNCTION public.submit_receipt_portal(
  p_token_hash text,
  p_fecha date,
  p_recibido_por text,
  p_remision_number text,
  p_notas text,
  p_items jsonb,
  p_evidence jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.receipt_portal_links%ROWTYPE;
  v_order public.authorized_orders%ROWTYPE;
  v_item record;
  v_receipt_result jsonb;
  v_receipt_id uuid;
  v_producto_id uuid;
  v_product_count integer;
  v_pending numeric;
  v_items jsonb := '[]'::jsonb;
  v_prefix text;
  v_file record;
  v_file_count integer;
  v_unique_file_count integer;
  v_total_bytes bigint;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_fecha IS NULL
     OR length(btrim(coalesce(p_recibido_por, ''))) NOT BETWEEN 1 AND 120
     OR length(coalesce(p_remision_number, '')) > 100
     OR length(coalesce(p_notas, '')) > 2000
     OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR p_evidence IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Datos de recepción inválidos';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100
     OR jsonb_array_length(p_evidence) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'La recepción requiere líneas y evidencia dentro de los límites permitidos';
  END IF;

  SELECT count(*), count(DISTINCT x.sha256)
  INTO v_file_count, v_unique_file_count
  FROM jsonb_to_recordset(p_evidence) AS x(sha256 text);
  IF v_file_count <> v_unique_file_count THEN
    RAISE EXCEPTION 'La evidencia contiene archivos duplicados';
  END IF;
  SELECT coalesce(sum(x.size_bytes), 0)
  INTO v_total_bytes
  FROM jsonb_to_recordset(p_evidence) AS x(size_bytes bigint);
  IF v_total_bytes > 52428800 THEN
    RAISE EXCEPTION 'La evidencia supera el tamaño total permitido';
  END IF;

  v_link := NULL;
  SELECT * INTO v_link
  FROM public.receipt_portal_links l
  WHERE l.token_hash = p_token_hash AND l.active AND l.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace inválido, vencido o ya utilizado'; END IF;

  SELECT ao.* INTO v_order
  FROM public.authorized_orders ao
  WHERE ao.id = v_link.order_id AND ao.empresa_id = v_link.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.project_id IS NULL THEN RAISE EXCEPTION 'OC de obra no encontrada'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.empresas e ON e.id = p.empresa_id
    WHERE p.id = v_link.created_by AND p.empresa_id = v_link.empresa_id
      AND p.active AND e.active AND p.role IN ('administracion', 'admin')
  ) THEN RAISE EXCEPTION 'El enlace perdió su responsable interno y debe regenerarse'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il
    WHERE il.id = v_link.location_id AND il.empresa_id = v_link.empresa_id
      AND il.project_id = v_order.project_id AND il.location_type = 'PROJECT' AND il.active
  ) THEN RAISE EXCEPTION 'La ubicación de entrega ya no pertenece a la obra activa'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric, notes text)
    WHERE x.order_item_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
       OR x.quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR x.quantity <> round(x.quantity, 2)
       OR length(coalesce(x.notes, '')) > 500
  ) THEN RAISE EXCEPTION 'Cantidad o línea de recepción inválida'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric, notes text)
    GROUP BY x.order_item_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'No se puede repetir una línea de la OC'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric, notes text)
    LEFT JOIN public.authorized_order_items oi
      ON oi.id = x.order_item_id AND oi.order_id = v_order.id AND oi.empresa_id = v_link.empresa_id
    WHERE oi.id IS NULL
  ) THEN RAISE EXCEPTION 'Una línea no pertenece a esta OC y empresa'; END IF;

  FOR v_item IN
    SELECT x.order_item_id, x.quantity, x.notes, oi.product, oi.unit,
           oi.producto_id AS order_product_id
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric, notes text)
    JOIN public.authorized_order_items oi
      ON oi.id = x.order_item_id AND oi.order_id = v_order.id AND oi.empresa_id = v_link.empresa_id
    ORDER BY x.order_item_id
  LOOP
    SELECT oi.quantity - coalesce(sum(
      CASE WHEN r.id IS NOT NULL THEN ri.cantidad_recibida ELSE 0 END
    ), 0)
    INTO v_pending
    FROM public.authorized_order_items oi
    LEFT JOIN public.oc_recepcion_items ri
      ON ri.order_item_id = oi.id AND ri.empresa_id = oi.empresa_id
    LEFT JOIN public.oc_recepciones r
      ON r.id = ri.recepcion_id AND r.empresa_id = ri.empresa_id
      AND r.order_id = v_order.id AND r.status IN ('DRAFT', 'CONFIRMED')
    WHERE oi.id = v_item.order_item_id AND oi.order_id = v_order.id AND oi.empresa_id = v_link.empresa_id
    GROUP BY oi.quantity;
    IF v_pending IS NULL OR v_item.quantity > v_pending THEN
      RAISE EXCEPTION 'La cantidad supera lo pendiente de la OC';
    END IF;

    IF v_item.order_product_id IS NOT NULL THEN
      v_producto_id := v_item.order_product_id;
    ELSE
      SELECT count(*), (array_agg(p.id ORDER BY p.id))[1]
      INTO v_product_count, v_producto_id
      FROM public.productos p
      WHERE p.empresa_id = v_link.empresa_id AND p.activo
        AND lower(btrim(p.nombre)) = lower(btrim(v_item.product))
        AND lower(btrim(coalesce(p.unidad, ''))) = lower(btrim(coalesce(v_item.unit, '')));
      IF v_product_count <> 1 THEN v_producto_id := NULL; END IF;
    END IF;

    IF v_producto_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.productos p
      WHERE p.id = v_producto_id AND p.empresa_id = v_link.empresa_id
        AND p.activo AND btrim(p.unidad) = btrim(v_item.unit)
    ) THEN
      RAISE EXCEPTION 'La OC tiene materiales sin vincular al inventario';
    END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'order_item_id', v_item.order_item_id,
      'producto_id', v_producto_id,
      'cantidad_recibida', v_item.quantity,
      'notas', nullif(btrim(v_item.notes), '')
    ));
  END LOOP;

  v_prefix := 'receipt-portals/' || v_link.id::text || '/';
  FOR v_file IN
    SELECT * FROM jsonb_to_recordset(p_evidence) AS x(
      storage_bucket text, storage_path text, file_name text,
      mime_type text, size_bytes bigint, sha256 text
    )
  LOOP
    IF v_file.storage_bucket IS DISTINCT FROM 'warehouse-evidence'
       OR left(v_file.storage_path, length(v_prefix)) IS DISTINCT FROM v_prefix
       OR position('/../' IN v_file.storage_path) > 0
       OR v_file.storage_path ~ '/\.\.?$'
       OR length(coalesce(v_file.file_name, '')) NOT BETWEEN 1 AND 255
       OR v_file.size_bytes IS NULL OR v_file.size_bytes NOT BETWEEN 1 AND 20971520
       OR v_file.sha256 IS NULL OR v_file.sha256 !~ '^[a-f0-9]{64}$'
       OR v_file.mime_type IS NULL
       OR v_file.mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') THEN
      RAISE EXCEPTION 'Evidencia de recepción inválida';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = v_file.storage_bucket AND o.name = v_file.storage_path
    ) THEN RAISE EXCEPTION 'El archivo de evidencia no fue conservado'; END IF;
  END LOOP;

  v_receipt_result := public.inventory_create_receipt(
    p_empresa_id := v_link.empresa_id,
    p_order_id := v_order.id,
    p_fecha := p_fecha,
    p_recibido_por := btrim(p_recibido_por),
    p_delivery_location_id := v_link.location_id,
    p_remision_number := nullif(btrim(p_remision_number), ''),
    p_idempotency_key := 'receipt-portal:' || v_link.id::text,
    p_created_by := v_link.created_by,
    p_notes := pg_catalog.concat_ws(E'\n', '[Portal externo de recepción]', nullif(btrim(p_notas), '')),
    p_items := v_items
  );
  v_receipt_id := (v_receipt_result ->> 'receipt_id')::uuid;
  IF v_receipt_id IS NULL THEN RAISE EXCEPTION 'No se pudo crear el borrador canónico'; END IF;

  INSERT INTO public.inventory_receipt_evidence (
    empresa_id, receipt_id, storage_bucket, storage_path, file_name,
    mime_type, size_bytes, sha256, uploaded_by
  )
  SELECT v_link.empresa_id, v_receipt_id, x.storage_bucket, x.storage_path,
         x.file_name, x.mime_type, x.size_bytes, x.sha256, NULL
  FROM jsonb_to_recordset(p_evidence) AS x(
    storage_bucket text, storage_path text, file_name text,
    mime_type text, size_bytes bigint, sha256 text
  );

  PERFORM public.inventory_confirm_receipt(
    p_empresa_id := v_link.empresa_id,
    p_receipt_id := v_receipt_id,
    p_delivery_location_id := v_link.location_id,
    p_idempotency_key := 'receipt-portal:' || v_link.id::text,
    p_confirmed_by := NULL
  );

  UPDATE public.receipt_portal_links
  SET active = false, last_used_at = now()
  WHERE id = v_link.id AND empresa_id = v_link.empresa_id;
  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_receipt_portal(text,date,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_receipt_portal(text,date,text,text,text,jsonb,jsonb) TO service_role;
