-- ============================================================================
-- PENDING — NO APLICAR SIN APROBACIÓN EXPLÍCITA.
-- ============================================================================
-- Remediation 3 · Final Integrity Hardening (H2 + H3).
--
-- QUÉ ES: propuesta de migración con dos RPC transaccionales mínimas para que
-- la comprobación y escritura de cantidades de conciliación por ítem sean
-- atómicas bajo concurrencia:
--   1. public.create_invoice_item_match(...)  — alta de imputación (H2).
--   2. public.correct_invoice_item(...)       — corrección de línea in-place (H3).
-- más dos helpers puros de correspondencia (unidad / producto) que replican
-- exactamente las reglas de lib/invoice-item-reconcile.ts.
--
-- ESTADO: VERSIONADA LOCALMENTE EN LA BRANCH. NO aplicada en Production, ni en
-- Preview, ni en ninguna instancia compartida. El directorio
-- supabase/migrations_pending/ NO es leído por Supabase CLI (solo aplica
-- supabase/migrations/), por lo que este archivo no puede aplicarse por error
-- con `supabase db push`.
--
-- POR QUÉ ES NECESARIA: la vía actual (check-then-insert en varias queries
-- PostgREST) deja una ventana de carrera: dos inserciones concurrentes pueden
-- leer el mismo remanente e insertar ambas, superando quantity de la OC. La
-- revalidación post-insert solo cubre el vínculo de cabecera, no los topes.
-- No existe mecanismo transaccional reutilizable para matches (verificado:
-- triggers/funciones/constraints/RLS en supabase/migrations). El trigger
-- canónico trg_recompute_order_item_qty se MANTIENE (recalcula SUM en-txn).
--
-- DISEÑO:
-- - SECURITY DEFINER + SET search_path TO '' + todo calificado (patrón
--   inventory_post_manual_movement / B11).
-- - Sin SQL dinámico.
-- - Auth: private.b11_require_financial_actor(p_empresa_id) — service_role
--   (worker) pasa con empresa explícita; JWT pasa solo si empresa del token
--   coincide y rol ∈ {admin, administracion}. Cada fila leída se filtra por
--   empresa_id y se verifica la cadena de titularidad: línea→factura,
--   ítem→OC vinculada. Tenant B inalcanzable en ambas vías.
-- - Orden de locks CONSISTENTE en ambas RPCs (anti-deadlock):
--     invoices → invoice_order_matches → invoice_items → authorized_order_items
--   El vínculo se bloquea ANTES que línea/ítem: si unmatch borró el vínculo,
--   el FOR UPDATE no encuentra fila y se aborta antes de tomar más locks
--   (sin ciclo posible con la vía de desvinculación). La aprobación
--   (mark_invoice_apto_para_pago) ya bloquea la fila de invoices → exclusión
--   mutua real en la carrera inserción-vs-aprobación (se re-verifica estado
--   DESPUÉS del lock).
-- - numeric es exacto: sin épsilon (el 1e-9 vive solo en TS por floats).
-- - Duplicado idéntico (misma cantidad) → éxito idempotente con el id
--   existente (reintentos seguros); distinta cantidad → error 23505-lógico.
-- - Cualquier RAISE revierte TODA la transacción (sin estados parciales).
-- - Auditoría dentro de la misma txn vía public.log_audit_event.
--
-- CUTOVER (requiere aprobación + deploy de esta migración; NO implementado):
--  1. Aplicar esta migración en staging → correr spec PGlite + suite E2E.
--  2. Cambiar createInvoiceItemMatch/insertValidatedItemMatches a llamar las
--     RPC (mantener validación TS como pre-chequeo de mensajes; la RPC manda).
--  3. Reintentar UNA vez ante SQLSTATE 40P01 (deadlock abortado por PG).
--  4. Las vías de borrado (unmatch/delete/corrección-RPC) no cambian.
--
-- ROLLBACK: DROP FUNCTION public.create_invoice_item_match(...),
-- public.correct_invoice_item(...), y helpers. El código TS actual no llama
-- a estas RPC, por lo que revertir es solo no-aplicar.
--
-- VERIFICACIÓN:
-- - Funcional (PostgreSQL real local, PGlite): test/invoice-item-match-rpc-pglite.test.ts
-- - Concurrencia real con locks (2 txns simultáneas): BLOCKED — sin Postgres
--   multitone local (sin binarios pg, docker daemon caído). Pasos en
--   supabase/migrations_pending/README.md §Verificación.
-- ============================================================================

BEGIN;

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

-- --------------------------------------------------------------------------
-- RPC 1 — Alta atómica de imputación (H2).
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_invoice_item_match(
  p_empresa_id uuid,
  p_invoice_id uuid,
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

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad imputada debe ser mayor a cero';
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

  -- 3. Lock línea (orden #3): titularidad exacta factura↔línea.
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

  PERFORM public.log_audit_event(
    'invoice.item_matched', NULL, NULL, p_invoice_id, v_link_order,
    jsonb_build_object('match_id', v_match_id, 'quantity', p_quantity, 'via', 'rpc'),
    'internal', NULL);

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
  v_new_unit := NULLIF(btrim(COALESCE(p_unit, '')), '');
  IF v_new_unit IS NOT NULL AND char_length(v_new_unit) > 60 THEN
    RAISE EXCEPTION 'La unidad de la línea no es válida';
  END IF;
  IF p_unit_price IS NOT NULL AND p_unit_price < 0 THEN
    RAISE EXCEPTION 'El precio unitario no puede ser negativo';
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

  -- 2. Lock línea (orden #2) y actualización in-place (mismo id: sin CASCADE).
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

  PERFORM public.log_audit_event(
    'invoice.item_corrected', NULL, NULL, v_invoice_id, NULL,
    jsonb_build_object('item_id', p_invoice_item_id, 'matches_kept', v_kept,
                       'matches_dropped', v_dropped, 'via', 'rpc'),
    'internal', NULL);

  RETURN jsonb_build_object('ok', true, 'item_id', p_invoice_item_id,
                            'matches_kept', v_kept, 'matches_dropped', v_dropped);
END;
$function$;

-- Permisos mínimos (patrón B11): revocar público/anónimo, otorgar a
-- authenticated (JWT con empresa+rol verificados dentro de cada RPC) y
-- service_role (worker con empresa explícita).
REVOKE ALL ON FUNCTION public.invoice_match_normalize_unit(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_match_units_compatible(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_match_normalize_description(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_match_descriptions_match(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_invoice_item_match(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_invoice_item(uuid, uuid, text, numeric, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_match_normalize_unit(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_units_compatible(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_normalize_description(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_match_descriptions_match(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_item_match(uuid, uuid, uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_invoice_item(uuid, uuid, text, numeric, text, numeric, numeric) TO authenticated, service_role;

COMMIT;
