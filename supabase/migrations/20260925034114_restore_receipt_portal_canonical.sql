-- External one-time receipt portal. Submissions are canonical DRAFT receipts;
-- only the existing human confirmation RPC can post inventory movements.

CREATE TABLE public.receipt_portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.authorized_orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_hint text NOT NULL CHECK (token_hint ~ '^[A-Za-z0-9_-]{6}$'),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX idx_receipt_portal_links_order
  ON public.receipt_portal_links(empresa_id, order_id, active);
CREATE UNIQUE INDEX idx_receipt_portal_links_one_active_order
  ON public.receipt_portal_links(empresa_id, order_id)
  WHERE active;

ALTER TABLE public.receipt_portal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.receipt_portal_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.receipt_portal_links TO service_role;

CREATE OR REPLACE FUNCTION public.create_receipt_portal_link(
  p_empresa_id uuid,
  p_order_id uuid,
  p_location_id uuid,
  p_token_hash text,
  p_token_hint text,
  p_expires_at timestamptz,
  p_created_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.authorized_orders%ROWTYPE;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  IF p_empresa_id IS NULL OR p_order_id IS NULL OR p_location_id IS NULL
     OR p_created_by IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_token_hint IS NULL OR p_token_hint !~ '^[A-Za-z0-9_-]{6}$'
     OR p_expires_at IS NULL
     OR p_expires_at <= now() OR p_expires_at > now() + interval '30 days'
     OR NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = p_created_by AND p.empresa_id = p_empresa_id
     ) THEN
    RAISE EXCEPTION 'Datos del enlace de recepción inválidos';
  END IF;

  SELECT ao.* INTO v_order
  FROM public.authorized_orders ao
  WHERE ao.id = p_order_id AND ao.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.project_id IS NULL THEN
    RAISE EXCEPTION 'La OC de obra no pertenece a esta empresa';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations il
    WHERE il.id = p_location_id AND il.empresa_id = p_empresa_id
      AND il.project_id = v_order.project_id AND il.location_type = 'PROJECT' AND il.active
  ) THEN
    RAISE EXCEPTION 'La ubicación de entrega no pertenece a la obra o está inactiva';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.authorized_order_items oi
    WHERE oi.order_id = p_order_id AND oi.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La OC debe tener líneas canónicas antes de crear el enlace';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.authorized_order_items oi
    WHERE oi.order_id = p_order_id AND oi.empresa_id = p_empresa_id
      AND oi.quantity > coalesce((
        SELECT sum(ri.cantidad_recibida)
        FROM public.oc_recepcion_items ri
        JOIN public.oc_recepciones r
          ON r.id = ri.recepcion_id AND r.empresa_id = ri.empresa_id
        WHERE ri.order_item_id = oi.id AND ri.empresa_id = p_empresa_id
          AND r.order_id = p_order_id AND r.status IN ('DRAFT', 'CONFIRMED')
      ), 0)
  ) THEN
    RAISE EXCEPTION 'La OC no tiene cantidades pendientes para recibir';
  END IF;

  UPDATE public.receipt_portal_links
  SET active = false
  WHERE empresa_id = p_empresa_id AND order_id = p_order_id AND active;

  INSERT INTO public.receipt_portal_links (
    empresa_id, order_id, location_id, token_hash, token_hint, expires_at, created_by
  ) VALUES (
    p_empresa_id, p_order_id, p_location_id, p_token_hash, p_token_hint, p_expires_at, p_created_by
  );
END;
$$;

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
    WHERE p.id = v_link.created_by AND p.empresa_id = v_link.empresa_id
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
       OR v_file.size_bytes NOT BETWEEN 1 AND 20971520
       OR v_file.sha256 IS NULL OR v_file.sha256 !~ '^[a-f0-9]{64}$'
       OR v_file.mime_type IS NULL
       OR v_file.mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') THEN
      RAISE EXCEPTION 'Evidencia de recepción inválida';
    END IF;
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

  UPDATE public.receipt_portal_links
  SET active = false, last_used_at = now()
  WHERE id = v_link.id AND empresa_id = v_link.empresa_id;
  RETURN v_receipt_id;
END;
$$;

-- Human review can bind an unambiguous inventory product to an external draft.
-- This narrowly replaces the historical direct UPDATE policy that canonical
-- receipt hardening intentionally removed.
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
