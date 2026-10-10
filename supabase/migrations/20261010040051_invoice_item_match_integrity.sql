-- Remediation 3 financial reconciliation integrity boundary.
-- Installs atomic item-match create/correct/delete and header-unmatch RPCs,
-- serialized with approval and guarded source writes. It aborts on legacy
-- integrity drift; it never repairs historical rows silently.
-- Deployment order and rollback procedures are documented in the release plan.

BEGIN;

-- Freeze reconciliation writers while preflight and grants change, so no
-- direct write can slip between validation and the new RPC-only boundary.
-- Acquire relations in the same parent-to-child order used by the RPCs.
LOCK TABLE public.invoices, public.invoice_order_matches, public.authorized_orders,
  public.invoice_items, public.authorized_order_items, public.invoice_item_matches
IN SHARE ROW EXCLUSIVE MODE;

-- No repair is implicit in this migration. Refuse installation if existing
-- rows already violate any invariant the new write boundary will enforce.
DO $preflight$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(problem, ', ' ORDER BY problem) INTO v_bad
  FROM (
    SELECT 'match tenant/ownership/link mismatch' AS problem
    FROM public.invoice_item_matches m
    LEFT JOIN public.invoice_items l ON l.id=m.invoice_item_id
    LEFT JOIN public.invoices i ON i.id=l.invoice_id
    LEFT JOIN public.authorized_order_items oi ON oi.id=m.order_item_id
    LEFT JOIN public.invoice_order_matches iom ON iom.invoice_id=l.invoice_id
    WHERE l.id IS NULL OR i.id IS NULL OR oi.id IS NULL
       OR l.empresa_id IS DISTINCT FROM m.empresa_id
       OR i.empresa_id IS DISTINCT FROM m.empresa_id
       OR oi.empresa_id IS DISTINCT FROM m.empresa_id
       OR iom.empresa_id IS DISTINCT FROM m.empresa_id
       OR iom.authorized_order_id IS DISTINCT FROM oi.order_id
    UNION ALL
    SELECT 'invoice line tenant does not match invoice parent'
    FROM public.invoice_items l
    LEFT JOIN public.invoices i ON i.id=l.invoice_id
    WHERE i.id IS NULL OR l.empresa_id IS DISTINCT FROM i.empresa_id
    UNION ALL
    SELECT 'order line tenant does not match authorized-order parent'
    FROM public.authorized_order_items oi
    LEFT JOIN public.authorized_orders o ON o.id=oi.order_id
    WHERE o.id IS NULL OR oi.empresa_id IS DISTINCT FROM o.empresa_id
    UNION ALL
    SELECT 'invoice/order header link tenant does not match both parents'
    FROM public.invoice_order_matches iom
    LEFT JOIN public.invoices i ON i.id=iom.invoice_id
    LEFT JOIN public.authorized_orders o ON o.id=iom.authorized_order_id
    WHERE i.id IS NULL OR o.id IS NULL OR iom.empresa_id IS DISTINCT FROM i.empresa_id
       OR iom.empresa_id IS DISTINCT FROM o.empresa_id
    UNION ALL
    SELECT 'non-finite or non-positive item match quantity'
    FROM public.invoice_item_matches m
    WHERE m.quantity_matched IS NULL OR m.quantity_matched <= 0
       OR m.quantity_matched IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    UNION ALL
    SELECT 'documented invoice-line quantity exceeded'
    FROM public.invoice_items l
    WHERE (l.quantity IS NULL AND EXISTS (SELECT 1 FROM public.invoice_item_matches m WHERE m.invoice_item_id=l.id))
       OR (l.quantity IS NOT NULL AND l.quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      AND (SELECT coalesce(sum(m.quantity_matched),0) FROM public.invoice_item_matches m WHERE m.invoice_item_id=l.id) > l.quantity)
    UNION ALL
    SELECT 'authorized-order quantity exceeded or malformed'
    FROM public.authorized_order_items oi
    WHERE oi.quantity IS NULL OR oi.quantity <= 0
       OR oi.quantity IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       OR oi.quantity_invoiced IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       OR (SELECT coalesce(sum(m.quantity_matched),0) FROM public.invoice_item_matches m WHERE m.order_item_id=oi.id) > oi.quantity
    UNION ALL
    SELECT 'quantity_invoiced counter drift'
    FROM public.authorized_order_items oi
    WHERE oi.quantity_invoiced IS DISTINCT FROM
      (SELECT coalesce(sum(m.quantity_matched),0) FROM public.invoice_item_matches m WHERE m.order_item_id=oi.id)
    UNION ALL
    SELECT 'non-finite source invoice quantity or amount'
    FROM public.invoice_items l
    WHERE l.quantity IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       OR l.unit_price IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       OR l.subtotal IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    UNION ALL
    SELECT 'non-finite authorized-order source amount'
    FROM public.authorized_order_items oi
    WHERE oi.unit_price IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
       OR oi.total_price IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  ) violations;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice reconciliation migration preflight failed: %; repair and verify existing data before retrying', v_bad;
  END IF;
END;
$preflight$;

-- Extensión para normalizar descripciones (tildes). Estándar en Supabase.
CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";

-- --------------------------------------------------------------------------
-- Helpers puros (réplica SQL de lib/invoice-item-reconcile.ts).
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoice_match_normalize_unit(p_unit text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN v IS NULL OR v = '' THEN NULL
    WHEN v IN ('unidad','unidades','unid','unids','u') THEN 'un'
    WHEN v IN ('bolsa','bolsas','saco','sacos') THEN 'bolsa'
    WHEN v IN ('kg','kilo','kilos') THEN 'kg'
    WHEN v IN ('g','gramo','gramos') THEN 'g'
    WHEN v IN ('tonelada','toneladas','t') THEN 'tonelada'
    WHEN v IN ('l','lt','litro','litros') THEN 'l'
    WHEN v IN ('ml','mililitro','mililitros') THEN 'ml'
    WHEN v IN ('m','metro','metros') THEN 'm'
    WHEN v IN ('m2','m²','metrocuadrado') THEN 'm2'
    WHEN v IN ('m3','m³','metrocubico') THEN 'm3'
    WHEN v IN ('barra','barras') THEN 'barra'
    WHEN v IN ('balde','baldes') THEN 'balde'
    WHEN v IN ('caja','cajas') THEN 'caja'
    WHEN v IN ('paquete','paquetes') THEN 'paquete'
    WHEN v IN ('rollo','rollos') THEN 'rollo'
    WHEN v IN ('pallet','pallets') THEN 'pallet'
    WHEN v IN ('tambor','tambores') THEN 'tambor'
    WHEN v IN ('bidon','bidones','bidón') THEN 'bidon'
    WHEN v = 'gl' THEN 'gl'
    WHEN v IN ('par','pares') THEN 'par'
    ELSE v
  END
  FROM (SELECT NULLIF(replace(lower(trim(BOTH FROM COALESCE(p_unit, ''))), '.', ''), '') AS v) s;
$$;

CREATE OR REPLACE FUNCTION public.invoice_match_units_compatible(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT na IS NOT NULL AND nb IS NOT NULL AND na = nb
  FROM (SELECT public.invoice_match_normalize_unit(p_a) AS na,
               public.invoice_match_normalize_unit(p_b) AS nb) s;
$$;

CREATE OR REPLACE FUNCTION public.invoice_match_normalize_description(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(lower(extensions.unaccent(COALESCE(p_value, ''))), '[^a-z0-9]+', ' ', 'g'),
             '\s+', ' ', 'g'),
           '^ | $', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.invoice_match_descriptions_match(p_invoice_desc text, p_order_desc text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_a text := public.invoice_match_normalize_description(p_invoice_desc);
  v_b text := public.invoice_match_normalize_description(p_order_desc);
  v_wa text[];
  v_wb text[];
  v_shorter text[];
  v_longer text[];
  v_w text;
BEGIN
  IF v_a IS NULL OR v_a = '' OR v_b IS NULL OR v_b = '' THEN
    RETURN false;
  END IF;
  IF v_a = v_b THEN
    RETURN true;
  END IF;
  SELECT array_agg(w) INTO v_wa FROM (SELECT unnest(string_to_array(v_a, ' ')) AS w) s WHERE char_length(w) > 2;
  SELECT array_agg(w) INTO v_wb FROM (SELECT unnest(string_to_array(v_b, ' ')) AS w) s WHERE char_length(w) > 2;
  IF v_wa IS NULL OR v_wb IS NULL OR array_length(v_wa, 1) = 0 OR array_length(v_wb, 1) = 0 THEN
    RETURN false;
  END IF;
  IF array_length(v_wa, 1) <= array_length(v_wb, 1) THEN
    v_shorter := v_wa; v_longer := v_wb;
  ELSE
    v_shorter := v_wb; v_longer := v_wa;
  END IF;
  FOREACH v_w IN ARRAY v_shorter LOOP
    IF NOT (v_w = ANY (v_longer)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

DO $match_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.invoice_item_matches m
    JOIN public.invoice_items l ON l.id=m.invoice_item_id
    JOIN public.authorized_order_items oi ON oi.id=m.order_item_id
    JOIN public.invoice_order_matches iom ON iom.invoice_id=l.invoice_id
    WHERE NOT public.invoice_match_units_compatible(l.unit,oi.unit)
       OR (NOT (
             (SELECT count(*) FROM public.invoice_items x WHERE x.invoice_id=l.invoice_id AND x.empresa_id=l.empresa_id)=1
             AND
             (SELECT count(*) FROM public.authorized_order_items x WHERE x.order_id=iom.authorized_order_id AND x.empresa_id=iom.empresa_id)=1
           ) AND NOT public.invoice_match_descriptions_match(l.product_description,oi.product))
  ) OR EXISTS (
    SELECT 1 FROM public.invoice_items l
    WHERE (l.quantity IS NOT NULL AND l.quantity <= 0)
       OR (l.unit_price IS NOT NULL AND l.unit_price < 0)
       OR (l.subtotal IS NOT NULL AND l.subtotal < 0)
  ) OR EXISTS (
    SELECT 1 FROM public.authorized_order_items oi
    WHERE (oi.unit_price IS NOT NULL AND oi.unit_price < 0)
       OR (oi.total_price IS NOT NULL AND oi.total_price < 0)
  ) THEN
    RAISE EXCEPTION 'Invoice reconciliation migration preflight failed: existing item matches violate unit/product rules or source quantities/amounts; repair and verify them before retrying';
  END IF;
END;
$match_preflight$;

-- --------------------------------------------------------------------------
-- RPC 1 — Alta atómica de imputación (H2).
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.log_invoice_item_event(
  p_empresa_id uuid, p_action text, p_invoice_id uuid, p_order_id uuid, p_detail jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id=p_invoice_id AND i.empresa_id=p_empresa_id)
     OR (p_order_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.authorized_orders o WHERE o.id=p_order_id AND o.empresa_id=p_empresa_id
     )) THEN
    RAISE EXCEPTION 'Audit source tenant denied' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.audit_logs(empresa_id,actor_id,actor_type,actor_label,action,invoice_id,authorized_order_id,detail)
  VALUES (p_empresa_id, auth.uid(),
          CASE WHEN auth.role()='service_role' THEN 'system' ELSE 'internal' END,
          CASE WHEN auth.role()='service_role' THEN 'invoice-reconciliation-worker' ELSE NULL END,
          p_action, p_invoice_id, p_order_id, p_detail)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION private.log_invoice_item_event(uuid,text,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Line writes are serialized against approval at the invoice row. Clients may
-- add lines directly only while editable; correction and deletion use RPCs.
CREATE OR REPLACE FUNCTION private.guard_invoice_item_source_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invoice_id uuid;
  v_empresa_id uuid;
  v_status public.invoice_status;
BEGIN
  IF TG_OP='DELETE' THEN
    v_invoice_id := OLD.invoice_id;
    v_empresa_id := OLD.empresa_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
    v_empresa_id := NEW.empresa_id;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id) THEN
    RAISE EXCEPTION 'No se puede mover una línea entre facturas o empresas';
  END IF;
  SELECT i.status, i.empresa_id INTO v_status, v_empresa_id
  FROM public.invoices i WHERE i.id=v_invoice_id AND i.empresa_id=v_empresa_id FOR UPDATE;
  IF NOT FOUND AND TG_OP='DELETE' THEN
    -- An unpaid invoice may be deleted; its FK cascade runs after the parent
    -- row has become invisible. The B11 BEFORE DELETE trigger already blocks
    -- APTO_PARA_PAGO/PAGADO invoices.
    PERFORM private.b11_require_financial_actor(v_empresa_id);
    RETURN OLD;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada o tenant inválido' USING ERRCODE='42501'; END IF;
  PERFORM private.b11_require_financial_actor(v_empresa_id);
  IF v_status NOT IN ('PENDIENTE','MATCH','REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'La factura ya no está en estado editable; las líneas quedan congeladas';
  END IF;
  IF TG_OP <> 'DELETE' AND (
      NEW.quantity IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      OR NEW.unit_price IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      OR NEW.subtotal IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) THEN
    RAISE EXCEPTION 'La cantidad y los importes deben ser valores numéricos finitos';
  END IF;
  IF TG_OP <> 'DELETE' AND ((NEW.quantity IS NOT NULL AND NEW.quantity <= 0)
      OR (NEW.unit_price IS NOT NULL AND NEW.unit_price < 0)
      OR (NEW.subtotal IS NOT NULL AND NEW.subtotal < 0)) THEN
    RAISE EXCEPTION 'La cantidad debe ser positiva y los importes no pueden ser negativos';
  END IF;
  IF TG_OP='INSERT' AND EXISTS (
    SELECT 1 FROM public.invoice_item_matches m
    JOIN public.invoice_items l ON l.id=m.invoice_item_id
    JOIN public.authorized_order_items oi ON oi.id=m.order_item_id
    WHERE l.invoice_id=v_invoice_id
      AND NOT public.invoice_match_descriptions_match(l.product_description,oi.product)
  ) THEN
    RAISE EXCEPTION 'Quite la imputación por producto único antes de agregar otra línea a la factura';
  END IF;
  IF TG_OP <> 'DELETE' AND (
      (NEW.quantity IS NOT NULL AND NEW.quantity <> round(NEW.quantity,2))
      OR (NEW.unit_price IS NOT NULL AND NEW.unit_price <> round(NEW.unit_price,4))
      OR (NEW.subtotal IS NOT NULL AND NEW.subtotal <> round(NEW.subtotal,2))) THEN
    RAISE EXCEPTION 'La cantidad admite hasta 2 decimales, el precio 4 y el subtotal 2';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_invoice_item_source_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER r3_invoice_item_source_write
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_item_source_write();

CREATE OR REPLACE FUNCTION private.guard_financial_parent_tenant_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'No se puede mover una entidad financiera entre empresas';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_financial_parent_tenant_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER r3_invoice_tenant_identity
BEFORE UPDATE OF empresa_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION private.guard_financial_parent_tenant_identity();
CREATE TRIGGER r3_authorized_order_tenant_identity
BEFORE UPDATE OF empresa_id ON public.authorized_orders
FOR EACH ROW EXECUTE FUNCTION private.guard_financial_parent_tenant_identity();

-- The legacy tenant-derivation trigger validates the OC against empresa_id,
-- but a service_role insert (or an RLS row with a guessed invoice UUID) could
-- still pair that tenant's OC with another tenant's invoice. Verify both
-- parents while holding them in the canonical invoice -> order lock order.
CREATE OR REPLACE FUNCTION private.guard_invoice_order_match_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_invoice_empresa uuid; v_order_empresa uuid;
BEGIN
  SELECT i.empresa_id INTO v_invoice_empresa
  FROM public.invoices i WHERE i.id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'La factura y el vínculo deben pertenecer a la misma empresa' USING ERRCODE='42501';
  END IF;
  SELECT o.empresa_id INTO v_order_empresa
  FROM public.authorized_orders o WHERE o.id=NEW.authorized_order_id FOR UPDATE;
  IF NOT FOUND OR v_order_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'La OC y el vínculo deben pertenecer a la misma empresa' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_invoice_order_match_tenant() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zzz_r3_invoice_order_match_tenant
BEFORE INSERT ON public.invoice_order_matches
FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_order_match_tenant();

-- The order-line counter is derived from matches; clients cannot forge it or
-- lower source quantity below current allocations. Description/unit/parent
-- edits require removing existing matches first.
CREATE OR REPLACE FUNCTION private.guard_authorized_order_item_match_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_matched numeric; v_order_empresa uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.invoice_item_matches m WHERE m.order_item_id=OLD.id) THEN
      RAISE EXCEPTION 'Quite las imputaciones antes de eliminar el ítem de OC';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0
     OR NEW.quantity IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     OR NEW.unit_price IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     OR NEW.total_price IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     OR (NEW.unit_price IS NOT NULL AND NEW.unit_price < 0)
     OR (NEW.total_price IS NOT NULL AND NEW.total_price < 0) THEN
    RAISE EXCEPTION 'La cantidad y los importes de la OC deben ser positivos y finitos';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
      RAISE EXCEPTION 'No se puede mover un ítem de OC a otra empresa';
    END IF;
    SELECT o.empresa_id INTO v_order_empresa FROM public.authorized_orders o
    WHERE o.id=NEW.order_id;
    IF NOT FOUND OR v_order_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La orden autorizada no pertenece a la empresa del ítem' USING ERRCODE='42501';
    END IF;
    IF NEW.order_id IS DISTINCT FROM OLD.order_id
       AND EXISTS (SELECT 1 FROM public.invoice_item_matches m WHERE m.order_item_id=OLD.id) THEN
      RAISE EXCEPTION 'Quite las imputaciones antes de mover el ítem a otra OC';
    END IF;
    SELECT coalesce(sum(m.quantity_matched),0) INTO v_matched
    FROM public.invoice_item_matches m WHERE m.order_item_id=OLD.id;
    IF NEW.quantity < v_matched THEN
      RAISE EXCEPTION 'La cantidad de OC no puede quedar debajo de lo ya imputado (%)', v_matched;
    END IF;
    IF NEW.quantity_invoiced IS DISTINCT FROM OLD.quantity_invoiced
       AND NEW.quantity_invoiced IS DISTINCT FROM v_matched THEN
      RAISE EXCEPTION 'quantity_invoiced es derivado; solo puede coincidir con las imputaciones persistidas';
    END IF;
    IF (NEW.product IS DISTINCT FROM OLD.product OR NEW.unit IS DISTINCT FROM OLD.unit
        OR NEW.order_id IS DISTINCT FROM OLD.order_id)
       AND EXISTS (SELECT 1 FROM public.invoice_item_matches m WHERE m.order_item_id=OLD.id) THEN
      RAISE EXCEPTION 'Quite las imputaciones antes de cambiar producto, unidad u OC del ítem';
    END IF;
  ELSE
    SELECT o.empresa_id INTO v_order_empresa FROM public.authorized_orders o
    WHERE o.id=NEW.order_id FOR UPDATE;
    IF NOT FOUND OR v_order_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La orden autorizada no pertenece a la empresa del ítem' USING ERRCODE='42501';
    END IF;
    IF NEW.quantity_invoiced IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'quantity_invoiced se calcula a partir de las imputaciones';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.invoice_item_matches m
      JOIN public.invoice_items l ON l.id=m.invoice_item_id
      JOIN public.authorized_order_items oi ON oi.id=m.order_item_id
      WHERE oi.order_id=NEW.order_id
        AND NOT public.invoice_match_descriptions_match(l.product_description,oi.product)
    ) THEN
      RAISE EXCEPTION 'Quite la imputación por producto único antes de agregar otra línea a la OC';
    END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    SELECT o.empresa_id INTO v_order_empresa FROM public.authorized_orders o WHERE o.id=NEW.order_id;
    IF NOT FOUND OR v_order_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La orden autorizada no pertenece a la empresa del ítem' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_authorized_order_item_match_source() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER r3_authorized_order_item_match_source
BEFORE INSERT OR UPDATE OR DELETE ON public.authorized_order_items
FOR EACH ROW EXECUTE FUNCTION private.guard_authorized_order_item_match_source();

CREATE OR REPLACE FUNCTION public.create_invoice_item_match(
  p_empresa_id uuid,
  p_invoice_id uuid,
  p_expected_order_id uuid,
  p_invoice_item_id uuid,
  p_order_item_id uuid,
  p_quantity numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status public.invoice_status;
  v_inv_empresa uuid;
  v_link_order uuid;
  v_parent_empresa uuid;
  v_line_invoice uuid;
  v_line_empresa uuid;
  v_line_desc text;
  v_line_qty numeric;
  v_line_unit text;
  v_ord_order uuid;
  v_ord_empresa uuid;
  v_ord_product text;
  v_ord_qty numeric;
  v_ord_unit text;
  v_ord_invoiced numeric;
  v_nlines integer;
  v_norder integer;
  v_matched numeric;
  v_dup_id uuid;
  v_dup_qty numeric;
  v_match_id uuid;
BEGIN
  -- 0. Actor y tenant (gate B11 canónico; service_role = worker con empresa explícita).
  PERFORM private.b11_require_financial_actor(p_empresa_id);

  IF p_quantity IS NULL OR p_quantity <= 0
     OR p_quantity IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'La cantidad imputada debe ser mayor a cero';
  END IF;
  IF p_quantity <> round(p_quantity,2) THEN
    RAISE EXCEPTION 'La cantidad imputada admite hasta 2 decimales';
  END IF;

  -- 1. Lock factura (orden #1): empresa + estado DESPUÉS del lock.
  SELECT i.status, i.empresa_id INTO v_status, v_inv_empresa
  FROM public.invoices i WHERE i.id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada: no se puede imputar por ítem';
  END IF;
  IF v_inv_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'La factura no pertenece a esta empresa';
  END IF;
  IF v_status NOT IN ('PENDIENTE', 'MATCH', 'REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'La factura ya no está en estado editable; la conciliación por ítem queda congelada';
  END IF;

  -- 2. Lock vínculo factura↔OC (orden #2). Sin vínculo verificable no hay imputación.
  SELECT m.authorized_order_id INTO v_link_order
  FROM public.invoice_order_matches m
  WHERE m.invoice_id = p_invoice_id AND m.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La factura no tiene una OC vinculada: no se puede imputar por ítem';
  END IF;
  IF v_link_order IS DISTINCT FROM p_expected_order_id THEN
    RAISE EXCEPTION 'La OC vinculada cambió; actualizá la conciliación antes de imputar';
  END IF;

  -- The parent lock serializes this path with AOI INSERT and B11 relationship
  -- changes; every writer then locks child lines/order items in stable order.
  SELECT o.empresa_id INTO v_parent_empresa FROM public.authorized_orders o
  WHERE o.id=v_link_order FOR UPDATE;
  IF NOT FOUND OR v_parent_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'La OC vinculada no pertenece a esta empresa' USING ERRCODE='42501';
  END IF;

  -- 3. Lock línea after parent order: exact invoice↔line ownership.
  SELECT l.invoice_id, l.empresa_id, l.product_description, l.quantity, l.unit
  INTO v_line_invoice, v_line_empresa, v_line_desc, v_line_qty, v_line_unit
  FROM public.invoice_items l
  WHERE l.id = p_invoice_item_id AND l.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La línea no existe o no pertenece a esta empresa';
  END IF;
  IF v_line_invoice IS DISTINCT FROM p_invoice_id THEN
    RAISE EXCEPTION 'La línea no pertenece a esta factura';
  END IF;

  -- 4. Lock ítem OC (orden #4): pertenencia exacta a la OC vinculada.
  SELECT o.order_id, o.empresa_id, o.product, o.quantity, o.unit, o.quantity_invoiced
  INTO v_ord_order, v_ord_empresa, v_ord_product, v_ord_qty, v_ord_unit, v_ord_invoiced
  FROM public.authorized_order_items o
  WHERE o.id = p_order_item_id AND o.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ítem de OC no existe o no pertenece a esta empresa';
  END IF;
  IF v_ord_order IS DISTINCT FROM v_link_order THEN
    RAISE EXCEPTION 'El ítem pertenece a otra OC: solo se puede imputar a la OC vinculada a esta factura';
  END IF;

  -- 5. Unidad compatible (misma regla TS).
  IF NOT public.invoice_match_units_compatible(v_line_unit, v_ord_unit) THEN
    RAISE EXCEPTION 'La unidad de la línea de factura no coincide con la de la OC';
  END IF;

  -- 6. Producto (salvo 1:1 inequívoco real).
  SELECT count(*) INTO v_nlines FROM public.invoice_items
  WHERE invoice_id = p_invoice_id AND empresa_id = p_empresa_id;
  SELECT count(*) INTO v_norder FROM public.authorized_order_items
  WHERE order_id = v_link_order AND empresa_id = p_empresa_id;
  IF NOT (v_nlines = 1 AND v_norder = 1)
     AND NOT public.invoice_match_descriptions_match(v_line_desc, v_ord_product) THEN
    RAISE EXCEPTION 'El producto de la línea no corresponde al ítem de OC';
  END IF;

  -- 7. Duplicado idempotente ANTES que los topes: un reintento idéntico es
  -- idempotencia, no exceso (mismo orden que la vía TS). Misma cantidad →
  -- éxito con el id existente; distinta cantidad → error.
  SELECT m.id, m.quantity_matched INTO v_dup_id, v_dup_qty
  FROM public.invoice_item_matches m
  WHERE m.invoice_item_id = p_invoice_item_id AND m.order_item_id = p_order_item_id;
  IF FOUND THEN
    IF v_dup_qty IS NOT DISTINCT FROM p_quantity THEN
      RETURN jsonb_build_object('ok', true, 'match_id', v_dup_id, 'duplicate', true);
    END IF;
    RAISE EXCEPTION 'Esa línea ya está imputada a ese ítem de OC';
  END IF;

  -- 8. Cantidad documentada (invariante documental, lectura post-lock).
  IF v_line_qty IS NULL THEN
    RAISE EXCEPTION 'La línea no tiene cantidad documentada; no se puede imputar';
  END IF;
  SELECT coalesce(sum(m.quantity_matched), 0) INTO v_matched
  FROM public.invoice_item_matches m WHERE m.invoice_item_id = p_invoice_item_id;
  IF v_matched + p_quantity > v_line_qty THEN
    RAISE EXCEPTION 'La imputación supera la cantidad documentada de la línea (%)', v_line_qty;
  END IF;

  -- 9. Remanente (invariante OC; quantity_invoiced vigente al lock, trigger recalcula en-txn).
  IF p_quantity > (v_ord_qty - coalesce(v_ord_invoiced, 0)) THEN
    RAISE EXCEPTION 'La cantidad supera el remanente de la OC';
  END IF;

  -- 10. Insert (el trigger canónico recalcula quantity_invoiced en esta misma txn).
  -- Ante carrera de inserción simultánea (unique_violation), re-leer: si el
  -- ganador dejó un duplicado idéntico, éxito idempotente; si no, error.
  BEGIN
    INSERT INTO public.invoice_item_matches (invoice_item_id, order_item_id, empresa_id, quantity_matched)
    VALUES (p_invoice_item_id, p_order_item_id, p_empresa_id, p_quantity)
    RETURNING id INTO v_match_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT m.id, m.quantity_matched INTO v_dup_id, v_dup_qty
    FROM public.invoice_item_matches m
    WHERE m.invoice_item_id = p_invoice_item_id AND m.order_item_id = p_order_item_id;
    IF FOUND AND v_dup_qty IS NOT DISTINCT FROM p_quantity THEN
      RETURN jsonb_build_object('ok', true, 'match_id', v_dup_id, 'duplicate', true);
    END IF;
    RAISE;
  END;

  PERFORM private.log_invoice_item_event(
    p_empresa_id, 'invoice.item_matched', p_invoice_id, v_link_order,
    jsonb_build_object('match_id', v_match_id, 'quantity', p_quantity, 'via', 'rpc'));

  RETURN jsonb_build_object('ok', true, 'match_id', v_match_id, 'duplicate', false);
END;
$function$;

-- --------------------------------------------------------------------------
-- RPC 2 — Corrección atómica de línea in-place (H3).
-- Sin DELETE+INSERT: el id se preserva, los matches sobreviven y todo ocurre
-- en una sola transacción (éxito total o rollback total; nunca "restaurado").
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.correct_invoice_item(
  p_empresa_id uuid,
  p_invoice_item_id uuid,
  p_description text,
  p_quantity numeric,
  p_unit text,
  p_unit_price numeric,
  p_subtotal numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invoice_id uuid;
  v_link_order uuid;
  v_parent_empresa uuid;
  v_status public.invoice_status;
  v_inv_empresa uuid;
  v_new_desc text;
  v_new_unit text;
  v_line_count integer;
  v_total_matched numeric;
  v_kept integer := 0;
  v_dropped integer := 0;
  r record;
  v_ocount integer;
  v_single boolean;
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);

  -- Validación de entradas (réplica de cleanLine en TS).
  v_new_desc := btrim(COALESCE(p_description, ''));
  IF v_new_desc = '' OR char_length(v_new_desc) > 500 THEN
    RAISE EXCEPTION 'La línea necesita una descripción válida';
  END IF;
  IF p_quantity IS NOT NULL AND p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad de la línea debe ser mayor a cero';
  END IF;
  IF p_quantity IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_unit_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_subtotal IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
    RAISE EXCEPTION 'La cantidad y los importes deben ser valores numéricos finitos';
  END IF;
  IF (p_quantity IS NOT NULL AND p_quantity <> round(p_quantity,2))
     OR (p_unit_price IS NOT NULL AND p_unit_price <> round(p_unit_price,4))
     OR (p_subtotal IS NOT NULL AND p_subtotal <> round(p_subtotal,2)) THEN
    RAISE EXCEPTION 'La cantidad admite hasta 2 decimales, el precio 4 y el subtotal 2';
  END IF;
  v_new_unit := NULLIF(btrim(COALESCE(p_unit, '')), '');
  IF v_new_unit IS NOT NULL AND char_length(v_new_unit) > 60 THEN
    RAISE EXCEPTION 'La unidad de la línea no es válida';
  END IF;
  IF p_unit_price IS NOT NULL AND p_unit_price < 0 THEN
    RAISE EXCEPTION 'El precio unitario no puede ser negativo';
  END IF;
  IF p_subtotal IS NOT NULL AND p_subtotal < 0 THEN
    RAISE EXCEPTION 'El subtotal no puede ser negativo';
  END IF;

  -- Titularidad previa (lectura sin lock para ubicar la factura).
  SELECT l.invoice_id INTO v_invoice_id
  FROM public.invoice_items l
  WHERE l.id = p_invoice_item_id AND l.empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Línea no encontrada';
  END IF;

  -- 1. Lock factura (orden #1): empresa + estado DESPUÉS del lock.
  SELECT i.status, i.empresa_id INTO v_status, v_inv_empresa
  FROM public.invoices i WHERE i.id = v_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF v_inv_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'La factura no pertenece a esta empresa';
  END IF;
  IF v_status NOT IN ('PENDIENTE', 'MATCH', 'REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'La factura ya no está en estado editable; las líneas quedan congeladas';
  END IF;

  SELECT iom.authorized_order_id INTO v_link_order
  FROM public.invoice_order_matches iom
  WHERE iom.invoice_id=v_invoice_id AND iom.empresa_id=p_empresa_id FOR UPDATE;
  IF FOUND THEN
    SELECT o.empresa_id INTO v_parent_empresa FROM public.authorized_orders o
    WHERE o.id=v_link_order FOR UPDATE;
    IF NOT FOUND OR v_parent_empresa IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'La OC vinculada no pertenece a esta empresa' USING ERRCODE='42501';
    END IF;
  END IF;

  -- 2. Lock line, then every target order item in stable order before any
  -- trigger-driven counter updates. This matches create/unmatch lock order.
  PERFORM l.id FROM public.invoice_items l
  WHERE l.id=p_invoice_item_id AND l.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea no encontrada'; END IF;
  PERFORM oi.id FROM public.authorized_order_items oi
  JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
  WHERE m.invoice_item_id=p_invoice_item_id
  ORDER BY oi.id FOR UPDATE OF oi;

  -- Update in-place (same id: no FK cascade).
  UPDATE public.invoice_items
  SET product_description = v_new_desc,
      quantity = p_quantity,
      unit = v_new_unit,
      unit_price = p_unit_price,
      subtotal = p_subtotal
  WHERE id = p_invoice_item_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Línea no encontrada';
  END IF;

  -- 3. Revalidación de matches existentes contra los valores corregidos.
  SELECT count(*) INTO v_line_count FROM public.invoice_items
  WHERE invoice_id = v_invoice_id AND empresa_id = p_empresa_id;
  SELECT coalesce(sum(m.quantity_matched), 0) INTO v_total_matched
  FROM public.invoice_item_matches m WHERE m.invoice_item_id = p_invoice_item_id;
  IF p_quantity IS NULL AND v_total_matched > 0 THEN
    DELETE FROM public.invoice_item_matches WHERE invoice_item_id = p_invoice_item_id;
    GET DIAGNOSTICS v_dropped = ROW_COUNT;
    v_total_matched := 0;
  END IF;
  IF p_quantity IS NOT NULL AND v_total_matched > p_quantity THEN
    RAISE EXCEPTION 'La corrección dejaría la línea sobre-imputada: quitá imputaciones antes de reducir la cantidad';
  END IF;

  FOR r IN
    SELECT m.id AS match_id, m.order_item_id, o.order_id, o.product, o.unit, o.empresa_id AS ord_empresa
    FROM public.invoice_item_matches m
    JOIN public.authorized_order_items o ON o.id = m.order_item_id
    WHERE m.invoice_item_id = p_invoice_item_id
  LOOP
    IF r.ord_empresa IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'Imputación inconsistente entre empresas: se requiere revisión manual';
    END IF;
    SELECT count(*) INTO v_ocount FROM public.authorized_order_items
    WHERE order_id = r.order_id AND empresa_id = p_empresa_id;
    v_single := (v_line_count = 1 AND v_ocount = 1);
    IF public.invoice_match_units_compatible(v_new_unit, r.unit)
       AND (v_single OR public.invoice_match_descriptions_match(v_new_desc, r.product)) THEN
      v_kept := v_kept + 1;
    ELSE
      -- Baja explícita y auditada (el trigger recalcula en-txn). Sin CASCADE.
      DELETE FROM public.invoice_item_matches WHERE id = r.match_id;
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;

  PERFORM private.log_invoice_item_event(
    p_empresa_id, 'invoice.item_corrected', v_invoice_id, NULL,
    jsonb_build_object('item_id', p_invoice_item_id, 'matches_kept', v_kept,
                       'matches_dropped', v_dropped, 'via', 'rpc'));

  RETURN jsonb_build_object('ok', true, 'item_id', p_invoice_item_id,
                            'matches_kept', v_kept, 'matches_dropped', v_dropped);
END;
$function$;

-- Atomic header unmatch. Lock invoice first to agree with create/correct and
-- B11 approval, then clear item allocations before dropping their parent link.
CREATE OR REPLACE FUNCTION public.unmatch_invoice_order(
  p_empresa_id uuid,
  p_invoice_id uuid,
  p_expected_match_id uuid,
  p_expected_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status public.invoice_status;
  v_inv_empresa uuid;
  v_link_id uuid;
  v_order_id uuid;
  v_deleted integer := 0;
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);
  SELECT i.status, i.empresa_id INTO v_status, v_inv_empresa
  FROM public.invoices i WHERE i.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Factura no encontrada o no pertenece a esta empresa' USING ERRCODE='42501';
  END IF;
  IF v_status NOT IN ('PENDIENTE','MATCH','REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'La factura ya no está en estado editable; no se puede desvincular';
  END IF;
  SELECT iom.id, iom.authorized_order_id INTO v_link_id, v_order_id
  FROM public.invoice_order_matches iom
  WHERE iom.invoice_id=p_invoice_id AND iom.empresa_id=p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',true,'already_unmatched',true,'deleted_item_matches',0);
  END IF;
  IF v_link_id IS DISTINCT FROM p_expected_match_id OR v_order_id IS DISTINCT FROM p_expected_order_id THEN
    RAISE EXCEPTION 'El vínculo factura/OC cambió; actualizá la pantalla antes de desvincular';
  END IF;
  PERFORM o.id FROM public.authorized_orders o
  WHERE o.id=v_order_id AND o.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La OC vinculada no pertenece a esta empresa' USING ERRCODE='42501'; END IF;

  -- Lock child rows and their order-item targets in stable order before DELETE;
  -- the canonical AFTER trigger then recomputes each cached counter in-txn.
  PERFORM l.id FROM public.invoice_items l
  WHERE l.invoice_id=p_invoice_id AND l.empresa_id=p_empresa_id
  ORDER BY l.id FOR UPDATE;
  PERFORM oi.id FROM public.authorized_order_items oi
  JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
  JOIN public.invoice_items l ON l.id=m.invoice_item_id
  WHERE l.invoice_id=p_invoice_id AND m.empresa_id=p_empresa_id
  ORDER BY oi.id FOR UPDATE OF oi;
  DELETE FROM public.invoice_item_matches m
  USING public.invoice_items l
  WHERE m.invoice_item_id=l.id AND l.invoice_id=p_invoice_id AND m.empresa_id=p_empresa_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.invoice_order_matches iom WHERE iom.id=v_link_id;

  PERFORM private.log_invoice_item_event(
    p_empresa_id, 'invoice.order_unmatched', p_invoice_id, v_order_id,
    jsonb_build_object('link_id',v_link_id,'deleted_item_matches',v_deleted,'via','rpc'));
  RETURN jsonb_build_object('ok',true,'already_unmatched',false,'deleted_item_matches',v_deleted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_invoice_item(
  p_empresa_id uuid,
  p_invoice_id uuid,
  p_invoice_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status public.invoice_status;
  v_invoice_empresa uuid;
  v_line_empresa uuid;
  v_link_order uuid;
  v_deleted integer := 0;
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);
  SELECT i.status, i.empresa_id INTO v_status, v_invoice_empresa
  FROM public.invoices i WHERE i.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Factura no encontrada o no pertenece a esta empresa' USING ERRCODE='42501';
  END IF;
  IF v_status NOT IN ('PENDIENTE','MATCH','REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'La factura ya no está en estado editable; las líneas quedan congeladas';
  END IF;
  SELECT iom.authorized_order_id INTO v_link_order
  FROM public.invoice_order_matches iom
  WHERE iom.invoice_id=p_invoice_id AND iom.empresa_id=p_empresa_id FOR UPDATE;
  IF FOUND THEN
    PERFORM o.id FROM public.authorized_orders o
    WHERE o.id=v_link_order AND o.empresa_id=p_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La OC vinculada no pertenece a esta empresa' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT l.empresa_id INTO v_line_empresa FROM public.invoice_items l
  WHERE l.id=p_invoice_item_id AND l.invoice_id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_line_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Línea no encontrada o no pertenece a esta factura' USING ERRCODE='42501';
  END IF;
  PERFORM oi.id FROM public.authorized_order_items oi
  JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
  WHERE m.invoice_item_id=p_invoice_item_id AND m.empresa_id=p_empresa_id
  ORDER BY oi.id FOR UPDATE OF oi;
  SELECT count(*) INTO v_deleted FROM public.invoice_item_matches m
  WHERE m.invoice_item_id=p_invoice_item_id;
  DELETE FROM public.invoice_items l WHERE l.id=p_invoice_item_id AND l.invoice_id=p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea no encontrada'; END IF;
  PERFORM private.log_invoice_item_event(
    p_empresa_id, 'invoice.item_deleted', p_invoice_id, NULL,
    jsonb_build_object('item_id',p_invoice_item_id,'deleted_matches',v_deleted,'via','rpc'));
  RETURN jsonb_build_object('ok',true,'item_id',p_invoice_item_id,'deleted_matches',v_deleted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_invoice_item_match(
  p_empresa_id uuid,
  p_invoice_id uuid,
  p_invoice_item_match_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_status public.invoice_status;
  v_invoice_empresa uuid;
  v_link_order uuid;
  v_line_id uuid;
  v_order_item_id uuid;
  v_match_empresa uuid;
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);
  SELECT i.status,i.empresa_id INTO v_status,v_invoice_empresa
  FROM public.invoices i WHERE i.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Factura no encontrada o no pertenece a esta empresa' USING ERRCODE='42501';
  END IF;
  IF v_status NOT IN ('PENDIENTE','MATCH','REQUIERE_REVISION') THEN
    RAISE EXCEPTION 'La factura ya no está en estado editable; las líneas quedan congeladas';
  END IF;
  SELECT iom.authorized_order_id INTO v_link_order
  FROM public.invoice_order_matches iom
  WHERE iom.invoice_id=p_invoice_id AND iom.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no tiene una OC vinculada'; END IF;
  PERFORM o.id FROM public.authorized_orders o
  WHERE o.id=v_link_order AND o.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La OC vinculada no pertenece a esta empresa' USING ERRCODE='42501'; END IF;
  SELECT m.invoice_item_id,m.order_item_id,m.empresa_id
  INTO v_line_id,v_order_item_id,v_match_empresa
  FROM public.invoice_item_matches m
  WHERE m.id=p_invoice_item_match_id AND m.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND OR v_match_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Imputación no encontrada o tenant inválido' USING ERRCODE='42501';
  END IF;
  PERFORM l.id FROM public.invoice_items l
  WHERE l.id=v_line_id AND l.invoice_id=p_invoice_id AND l.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La línea no pertenece a esta factura'; END IF;
  PERFORM oi.id FROM public.authorized_order_items oi
  WHERE oi.id=v_order_item_id AND oi.order_id=v_link_order AND oi.empresa_id=p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El ítem de OC no pertenece al vínculo vigente'; END IF;
  DELETE FROM public.invoice_item_matches m WHERE m.id=p_invoice_item_match_id;
  PERFORM private.log_invoice_item_event(
    p_empresa_id,'invoice.item_unmatched',p_invoice_id,v_link_order,
    jsonb_build_object('match_id',p_invoice_item_match_id,'via','rpc'));
  RETURN jsonb_build_object('ok',true,'match_id',p_invoice_item_match_id);
END;
$function$;

-- El borrado completo de una factura no puede repartirse entre requests: una
-- aprobación o ejecución de OP concurrente debe hacer commit completa o fallar
-- completa. El mismo orden OP -> factura lo usa ejecutar_orden_pago_atomica.
CREATE OR REPLACE FUNCTION public.delete_invoice(
  p_empresa_id uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invoice_empresa uuid;
  v_status public.invoice_status;
  v_attachment_id uuid;
  v_cleanup_bucket text;
  v_cleanup_path text;
  v_attachment record;
  v_op record;
  v_locked_ops uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_internal_role(ARRAY['admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar una factura' USING ERRCODE='42501';
  END IF;

  -- OP first, ordered by ID. A concurrent payment execution either completes
  -- before these locks (and is rejected below), or waits for this transaction.
  FOR v_op IN
    SELECT po.id, po.status
    FROM public.payment_order_invoices poi
    JOIN public.payment_orders po ON po.id=poi.payment_order_id
    WHERE poi.invoice_id=p_invoice_id AND poi.empresa_id=p_empresa_id
    ORDER BY po.id
    FOR UPDATE OF po
  LOOP
    IF v_op.status='EJECUTADA' THEN
      RAISE EXCEPTION 'No se puede eliminar una factura vinculada a una OP ejecutada' USING ERRCODE='55000';
    END IF;
    v_locked_ops := pg_catalog.array_append(v_locked_ops,v_op.id);
  END LOOP;

  SELECT i.empresa_id,i.status,i.attachment_id
    INTO v_invoice_empresa,v_status,v_attachment_id
  FROM public.invoices i
  WHERE i.id=p_invoice_id
  FOR UPDATE;
  IF NOT FOUND OR v_invoice_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Factura no encontrada o no pertenece a esta empresa' USING ERRCODE='42501';
  END IF;
  IF v_status IN ('APTO_PARA_PAGO','PAGADO') THEN
    RAISE EXCEPTION 'No se puede eliminar una factura apta para pago o pagada' USING ERRCODE='55000';
  END IF;

  -- Serialize attachment cleanup with concurrent FK references. Shared
  -- attachments remain present, and the caller removes Storage only if this
  -- transaction reports that it actually deleted the metadata row.
  IF v_attachment_id IS NOT NULL THEN
    SELECT a.id,a.bucket,a.path INTO v_attachment
    FROM public.attachments a
    WHERE a.id=v_attachment_id AND a.empresa_id=p_empresa_id
    FOR UPDATE;
  END IF;

  -- A link through another OP may have committed between the initial OP scan
  -- and our invoice lock. Do not acquire its OP lock after the invoice lock:
  -- abort and let the caller retry with the complete ordered lock set.
  IF EXISTS (
    SELECT 1
    FROM public.payment_order_invoices poi
    WHERE poi.invoice_id=p_invoice_id
      AND (poi.empresa_id IS DISTINCT FROM p_empresa_id
        OR NOT (poi.payment_order_id=ANY(v_locked_ops)))
  ) THEN
    RAISE EXCEPTION 'Los vínculos de OP cambiaron durante el borrado; reintente' USING ERRCODE='40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_order_invoices poi
    JOIN public.payment_orders po ON po.id=poi.payment_order_id
    WHERE poi.invoice_id=p_invoice_id AND poi.empresa_id=p_empresa_id
      AND po.status='EJECUTADA'
  ) THEN
    RAISE EXCEPTION 'No se puede eliminar una factura vinculada a una OP ejecutada' USING ERRCODE='55000';
  END IF;

  -- All cleanup and the parent deletion share this transaction. Cascaded line,
  -- header-match, item-match and exception deletion also completes atomically.
  DELETE FROM public.payment_order_invoices poi
  WHERE poi.invoice_id=p_invoice_id AND poi.empresa_id=p_empresa_id;
  DELETE FROM public.invoice_exceptions e
  WHERE e.invoice_id=p_invoice_id AND e.empresa_id=p_empresa_id;
  DELETE FROM public.audit_logs a
  WHERE a.invoice_id=p_invoice_id
    AND (a.empresa_id=p_empresa_id OR a.empresa_id IS NULL);
  DELETE FROM public.invoices i
  WHERE i.id=p_invoice_id AND i.empresa_id=p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura cambió durante el borrado' USING ERRCODE='40001'; END IF;

  IF v_attachment.id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.attachment_id=v_attachment.id) THEN
    BEGIN
      DELETE FROM public.attachments a
      WHERE a.id=v_attachment.id AND a.empresa_id=p_empresa_id
      RETURNING a.bucket,a.path INTO v_cleanup_bucket,v_cleanup_path;
    EXCEPTION WHEN foreign_key_violation OR raise_exception THEN
      -- Other durable evidence can reference this attachment. Preserve it and
      -- allow the invoice deletion to commit with no Storage cleanup request.
      v_cleanup_bucket := NULL;
      v_cleanup_path := NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok',true,'attachment_id',v_attachment_id,
    'cleanup_bucket',v_cleanup_bucket,'cleanup_path',v_cleanup_path);
END;
$function$;

-- A claimed job is never made claimable again after its invoice_id checkpoint
-- exists. If the worker dies after creating the invoice, the stale lease goes
-- to manual review and preserves that known invoice instead of duplicating it.
CREATE OR REPLACE FUNCTION public.claim_invoice_job()
RETURNS public.invoice_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_job public.invoice_jobs;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Invoice jobs are service-role only' USING ERRCODE='42501';
  END IF;
  UPDATE public.invoice_jobs j
  SET status='processing', locked_at=pg_catalog.now(), attempts=j.attempts+1,
      updated_at=pg_catalog.now()
  WHERE j.id=(
    SELECT q.id FROM public.invoice_jobs q
    WHERE q.status='queued' AND q.invoice_id IS NULL
    ORDER BY q.created_at,q.id
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING j.* INTO v_job;
  RETURN v_job;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stale_invoice_jobs(
  timeout_minutes integer DEFAULT 15,
  max_attempts integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Invoice jobs are service-role only' USING ERRCODE='42501';
  END IF;
  WITH affected AS (
    UPDATE public.invoice_jobs j
    SET status=CASE
          WHEN j.invoice_id IS NOT NULL THEN 'needs_review'::public.invoice_job_status
          WHEN j.attempts >= max_attempts THEN 'failed'::public.invoice_job_status
          ELSE 'queued'::public.invoice_job_status
        END,
        outcome=CASE WHEN j.invoice_id IS NOT NULL THEN 'needs_manual' ELSE j.outcome END,
        locked_at=NULL,
        message=CASE
          WHEN j.invoice_id IS NOT NULL THEN
            'El worker expiró después de crear la factura. Revisá la factura existente antes de continuar.'
          WHEN j.attempts >= max_attempts THEN
            'Abandonado tras ' || j.attempts || ' intentos (timeout de worker).'
          ELSE j.message
        END,
        error=CASE
          WHEN j.invoice_id IS NOT NULL THEN
            coalesce(j.error,'Worker crash con factura ya creada; no reencolar para evitar duplicados.')
          WHEN j.attempts >= max_attempts THEN
            coalesce(j.error,'Worker crash: locked_at expiró sin finish()')
          ELSE j.error
        END,
        updated_at=pg_catalog.now()
    WHERE j.status='processing'
      AND j.locked_at < pg_catalog.now() - (timeout_minutes || ' minutes')::interval
    RETURNING j.id
  )
  SELECT count(*) INTO v_count FROM affected;
  RETURN coalesce(v_count,0);
END;
$function$;

-- Permisos mínimos (patrón B11): revocar público/anónimo, otorgar a
-- authenticated (JWT con empresa+rol verificados dentro de cada RPC) y
-- service_role (worker con empresa explícita).
REVOKE ALL ON FUNCTION public.invoice_match_normalize_unit(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_match_units_compatible(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_match_normalize_description(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_match_descriptions_match(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_invoice_item_match(uuid, uuid, uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.correct_invoice_item(uuid, uuid, text, numeric, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unmatch_invoice_order(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_invoice_item(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_invoice_item_match(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_invoice(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_invoice_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stale_invoice_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.invoice_item_matches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.invoice_item_matches TO authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.invoice_order_matches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.invoice_order_matches TO authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.invoice_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.invoice_items TO authenticated, service_role;
REVOKE TRUNCATE ON TABLE public.invoice_item_matches, public.invoice_items,
  public.invoice_order_matches, public.authorized_order_items,
  public.invoices, public.authorized_orders FROM PUBLIC, anon, authenticated, service_role;
REVOKE TRIGGER, REFERENCES, MAINTAIN ON TABLE public.invoice_item_matches,
  public.invoice_items, public.invoice_order_matches,
  public.authorized_order_items, public.invoices, public.authorized_orders
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE DELETE ON TABLE public.invoices FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_normalize_unit(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_units_compatible(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_normalize_description(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_descriptions_match(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_item_match(uuid, uuid, uuid, uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_invoice_item(uuid, uuid, text, numeric, text, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unmatch_invoice_order(uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_invoice_item(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_invoice_item_match(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_invoice(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_invoice_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_invoice_jobs(integer, integer) TO service_role;

COMMIT;
