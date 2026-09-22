-- One-time external links for recording canonical purchase-order receipts.
CREATE TABLE public.receipt_portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.authorized_orders(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_hint text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
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

-- Link creation also materializes a legacy header-only OC as a canonical line,
-- so every external receipt references an authorized_order_items row.
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
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT * INTO v_order
  FROM public.authorized_orders
  WHERE id = p_order_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.project_id IS NULL THEN
    RAISE EXCEPTION 'OC de obra no encontrada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = p_location_id AND empresa_id = p_empresa_id
      AND project_id = v_order.project_id AND location_type = 'PROJECT' AND active
  ) THEN
    RAISE EXCEPTION 'La ubicación de obra no es válida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.authorized_order_items
    WHERE order_id = p_order_id AND empresa_id = p_empresa_id
  ) THEN
    INSERT INTO public.authorized_order_items (
      order_id, empresa_id, product, quantity, unit, unit_price, total_price, sort_order
    ) VALUES (
      v_order.id, v_order.empresa_id, v_order.product, v_order.quantity,
      v_order.unit, v_order.unit_price, greatest(v_order.total_price, 0.01), 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.authorized_order_items oi
    WHERE oi.order_id = p_order_id AND oi.empresa_id = p_empresa_id
      AND oi.quantity > coalesce((
        SELECT sum(ri.cantidad_recibida)
        FROM public.oc_recepcion_items ri
        JOIN public.oc_recepciones r ON r.id = ri.recepcion_id
        WHERE ri.order_item_id = oi.id AND ri.empresa_id = p_empresa_id
          AND r.order_id = p_order_id AND r.empresa_id = p_empresa_id
          AND r.status IN ('DRAFT', 'CONFIRMED')
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
    p_empresa_id, p_order_id, p_location_id, p_token_hash, p_token_hint,
    p_expires_at, p_created_by
  );
END;
$$;

-- Submit receipt, lines, evidence metadata and consume the link atomically.
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
  v_receipt_id uuid;
  v_producto_id uuid;
  v_product_count integer;
  v_received numeric;
  v_prefix text;
  v_item_count integer;
  v_unique_item_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_fecha IS NULL
     OR length(btrim(coalesce(p_recibido_por, ''))) NOT BETWEEN 1 AND 120
     OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Datos de recepción inválidos';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'La recepción debe incluir entre 1 y 100 líneas';
  END IF;

  SELECT * INTO v_link
  FROM public.receipt_portal_links
  WHERE token_hash = p_token_hash AND active AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace inválido, vencido o ya utilizado'; END IF;

  SELECT * INTO v_order
  FROM public.authorized_orders
  WHERE id = v_link.order_id AND empresa_id = v_link.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.project_id IS NULL THEN RAISE EXCEPTION 'OC no encontrada'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_link.location_id AND empresa_id = v_link.empresa_id
      AND project_id = v_order.project_id AND location_type = 'PROJECT' AND active
  ) THEN
    RAISE EXCEPTION 'La ubicación de obra ya no está activa';
  END IF;

  SELECT count(*), count(DISTINCT x.order_item_id)
  INTO v_item_count, v_unique_item_count
  FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity numeric, notes text);
  IF v_item_count <> v_unique_item_count THEN
    RAISE EXCEPTION 'No se puede repetir una línea de la OC';
  END IF;

  INSERT INTO public.oc_recepciones (
    empresa_id, order_id, fecha, recibido_por, notas, delivery_location_id,
    remision_number, idempotency_key, status, created_by
  ) VALUES (
    v_link.empresa_id, v_order.id, p_fecha, btrim(p_recibido_por),
    nullif(btrim(p_notas), ''), v_link.location_id,
    nullif(btrim(p_remision_number), ''), 'receipt-portal:' || v_link.id::text,
    'DRAFT', NULL
  ) RETURNING id INTO v_receipt_id;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items)
      AS x(order_item_id uuid, quantity numeric, notes text)
  LOOP
    IF v_item.order_item_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad o línea de recepción inválida';
    END IF;

    PERFORM 1 FROM public.authorized_order_items
    WHERE id = v_item.order_item_id AND order_id = v_order.id AND empresa_id = v_link.empresa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La línea no pertenece a la OC'; END IF;

    SELECT oi.quantity - coalesce(sum(
      CASE WHEN r.id IS NOT NULL THEN ri.cantidad_recibida ELSE 0 END
    ), 0)
    INTO v_received
    FROM public.authorized_order_items oi
    LEFT JOIN public.oc_recepcion_items ri ON ri.order_item_id = oi.id AND ri.empresa_id = v_link.empresa_id
    LEFT JOIN public.oc_recepciones r ON r.id = ri.recepcion_id
      AND r.order_id = v_order.id AND r.empresa_id = v_link.empresa_id
      AND r.status IN ('DRAFT', 'CONFIRMED')
    WHERE oi.id = v_item.order_item_id AND oi.order_id = v_order.id AND oi.empresa_id = v_link.empresa_id
    GROUP BY oi.quantity;
    IF v_received IS NULL OR v_item.quantity > v_received THEN
      RAISE EXCEPTION 'La cantidad supera lo pendiente de la OC';
    END IF;

    SELECT count(*), (array_agg(p.id))[1]
    INTO v_product_count, v_producto_id
    FROM public.productos p
    JOIN public.authorized_order_items oi ON oi.id = v_item.order_item_id
    WHERE p.empresa_id = v_link.empresa_id AND p.activo
      AND lower(btrim(p.nombre)) = lower(btrim(oi.product))
      AND lower(btrim(coalesce(p.unidad, ''))) = lower(btrim(coalesce(oi.unit, '')));
    IF v_product_count <> 1 THEN v_producto_id := NULL; END IF;

    INSERT INTO public.oc_recepcion_items (
      empresa_id, recepcion_id, order_item_id, producto_id, cantidad_recibida, notas
    ) VALUES (
      v_link.empresa_id, v_receipt_id, v_item.order_item_id, v_producto_id,
      v_item.quantity, nullif(btrim(v_item.notes), '')
    );
  END LOOP;

  v_prefix := 'receipt-portals/' || v_link.id::text || '/';
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(coalesce(p_evidence, '[]'::jsonb)) AS x(
      storage_bucket text, storage_path text, file_name text,
      mime_type text, size_bytes bigint, sha256 text
    )
  LOOP
    IF v_item.storage_bucket <> 'warehouse-evidence'
       OR left(v_item.storage_path, length(v_prefix)) <> v_prefix
       OR v_item.size_bytes <= 0 THEN
      RAISE EXCEPTION 'Evidencia de recepción inválida';
    END IF;
    INSERT INTO public.inventory_receipt_evidence (
      empresa_id, receipt_id, storage_bucket, storage_path, file_name,
      mime_type, size_bytes, sha256, uploaded_by
    ) VALUES (
      v_link.empresa_id, v_receipt_id, v_item.storage_bucket, v_item.storage_path,
      v_item.file_name, v_item.mime_type, v_item.size_bytes, v_item.sha256, NULL
    );
  END LOOP;

  UPDATE public.receipt_portal_links
  SET active = false, last_used_at = now()
  WHERE id = v_link.id;
  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_receipt_portal_link(uuid, uuid, uuid, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_receipt_portal(text, date, text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_receipt_portal_link(uuid, uuid, uuid, text, text, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_receipt_portal(text, date, text, text, text, jsonb, jsonb)
  TO service_role;
