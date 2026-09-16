-- =============================================================================
-- 0090_quotation_acceptance_work_orders.sql
--
-- Flujo completo de aceptación electrónica de cotizaciones (proformas) y
-- generación automática de Órdenes de Trabajo internas.
--
-- MODELO:
--   Cotización = sales_documents con doc_type='PROFORMA'. No se crea tabla
--   nueva de cotizaciones para no duplicar la lógica de totales/ítems/
--   clientes/contadores que ya existe (0020_sales.sql).
--
--   - sales_documents.acceptance_status gobierna el flujo con el cliente:
--       DRAFT -> PENDING_ACCEPTANCE -> ACCEPTED | REJECTED | EXPIRED
--     Es ortogonal a sales_documents.status (BORRADOR/EMITIDA/...), que
--     sigue gobernando cobranza. Solo PROFORMA usa aceptación.
--
--   - sales_documents.quotation_version (int, desde 1) es el "quotation_version"
--     del link seguro. Cada edición sustancial del documento o de sus ítems
--     lo incrementa y deja obsoletos los links de versiones anteriores, para
--     que el cliente nunca acepte una versión desactualizada.
--
--   - sales_quotation_tokens es el link seguro. Una fila = un link con:
--       quotation_id (sales_document_id), quotation_version, tenant_id
--       (empresa_id), token único seguro (gen_random_bytes 32 hex),
--       fecha de creación (created_at), expiración opcional (expires_at),
--       estado (derivado: revoked_at null + vigencia + versión).
--
--   - sales_quotation_events es la auditoría append-only del flujo
--     (SENT/VIEWED/ACCEPTED/REJECTED/REVOKED/EXPIRED/WORK_ORDER_CREATED/...).
--
--   - work_orders + work_order_items es el documento INTERNO generado
--     automáticamente al aceptar. Nunca se expone al portal del cliente:
--     el portal solo lee sales_documents + items + empresa/cliente. La OT
--     tiene código propio OT-YYYY-XXXX por empresa (doc_code_counters).
--
-- SEGURIDAD:
--   - Portal público sin login: usa service_role + validación explícita del
--     token en código/RPC (mismo patrón que /cotizar/[token], /avance/[token],
--     /certificados/[token]). Sin políticas para anon: RLS deniega por defecto.
--   - accept_quotation / reject_quotation / log_quotation_view son
--     SECURITY DEFINER con search_path=public fijo y GRANT solo a
--     anon/authenticated/service_role. Toda la validación (tenant, versión,
--     expiración, estado, idempotencia) ocurre dentro del RPC.
--   - RLS interno: administracion/admin (mismo que ventas). Sin DELETE en
--     eventos (append-only) ni en tokens aceptados (se revocan, no se borran).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Estados de aceptación + OT
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.quotation_acceptance_status AS ENUM (
    'DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'REJECTED', 'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.work_order_status AS ENUM (
    'PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Columnas de aceptación en sales_documents (solo tienen sentido en PROFORMA)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS quotation_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS acceptance_status public.quotation_acceptance_status NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS acceptance_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by_name text,
  ADD COLUMN IF NOT EXISTS accepted_by_doc text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Backfill defensivo por si el DEFAULT no aplicó en filas viejas.
UPDATE public.sales_documents SET quotation_version = 1 WHERE quotation_version IS NULL;
UPDATE public.sales_documents SET acceptance_status = 'DRAFT' WHERE acceptance_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_documents_acceptance
  ON public.sales_documents(acceptance_status) WHERE doc_type = 'PROFORMA';
CREATE INDEX IF NOT EXISTS idx_sales_documents_quotation_version
  ON public.sales_documents(id, quotation_version);

-- ---------------------------------------------------------------------------
-- 3. Links seguros de cotización
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_quotation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sales_document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  quotation_version int NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_to_email text,
  sent_at timestamptz,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_quotation_tokens_doc ON public.sales_quotation_tokens(sales_document_id);
CREATE INDEX IF NOT EXISTS idx_quotation_tokens_empresa ON public.sales_quotation_tokens(empresa_id);
CREATE INDEX IF NOT EXISTS idx_quotation_tokens_token ON public.sales_quotation_tokens(token);

-- ---------------------------------------------------------------------------
-- 4. Eventos de auditoría del flujo (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_quotation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sales_document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.sales_quotation_tokens(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED',
    'REVOKED', 'EXPIRED', 'VERSION_SUPERSEDED', 'WORK_ORDER_CREATED'
  )),
  actor_label text,
  actor_ip text,
  actor_user_agent text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_events_doc ON public.sales_quotation_events(sales_document_id);
CREATE INDEX IF NOT EXISTS idx_quotation_events_empresa ON public.sales_quotation_events(empresa_id);
CREATE INDEX IF NOT EXISTS idx_quotation_events_type ON public.sales_quotation_events(event_type);

-- ---------------------------------------------------------------------------
-- 5. Órdenes de Trabajo internas (documento interno, nunca visible al cliente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  code text NOT NULL,
  sales_document_id uuid NOT NULL UNIQUE REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  currency public.currency_code NOT NULL DEFAULT 'PYG',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status public.work_order_status NOT NULL DEFAULT 'PENDIENTE',
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, code)
);
CREATE INDEX IF NOT EXISTS idx_work_orders_empresa ON public.work_orders(empresa_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_client ON public.work_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_quotation ON public.work_orders(sales_document_id);

CREATE TABLE IF NOT EXISTS public.work_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  vat_rate int NOT NULL DEFAULT 10 CHECK (vat_rate IN (0, 5, 10)),
  line_total numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_items_order ON public.work_order_items(work_order_id);

-- Contador OT por empresa (reusa doc_code_counters; formato OT-YYYY-XXXX).
INSERT INTO public.doc_code_counters (empresa_id, doc_type, last_number)
SELECT e.id, 'OT', 0 FROM public.empresas e
ON CONFLICT (empresa_id, doc_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. empresa_id automático + códigos + updated_at (patrón 0011/0020/0027)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_quotation_token_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := COALESCE(
      (SELECT empresa_id FROM public.sales_documents WHERE id = NEW.sales_document_id),
      public.current_empresa_id());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_quotation_tokens_empresa ON public.sales_quotation_tokens;
CREATE TRIGGER trg_quotation_tokens_empresa BEFORE INSERT ON public.sales_quotation_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_quotation_token_empresa();

CREATE OR REPLACE FUNCTION public.set_quotation_event_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := COALESCE(
      (SELECT empresa_id FROM public.sales_documents WHERE id = NEW.sales_document_id),
      public.current_empresa_id());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_quotation_events_empresa ON public.sales_quotation_events;
CREATE TRIGGER trg_quotation_events_empresa BEFORE INSERT ON public.sales_quotation_events
  FOR EACH ROW EXECUTE FUNCTION public.set_quotation_event_empresa();

CREATE OR REPLACE FUNCTION public.set_work_order_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := COALESCE(
      (SELECT empresa_id FROM public.sales_documents WHERE id = NEW.sales_document_id),
      public.current_empresa_id());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_work_orders_empresa ON public.work_orders;
CREATE TRIGGER trg_work_orders_empresa BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_work_order_empresa();

CREATE OR REPLACE FUNCTION public.set_work_order_item_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := COALESCE(
      (SELECT empresa_id FROM public.work_orders WHERE id = NEW.work_order_id),
      public.current_empresa_id());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_work_order_items_empresa ON public.work_order_items;
CREATE TRIGGER trg_work_order_items_empresa BEFORE INSERT ON public.work_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_work_order_item_empresa();

-- Código OT-YYYY-XXXX. Nombre con 'z' para correr DESPUÉS del trigger de empresa.
CREATE OR REPLACE FUNCTION public.set_work_order_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.next_doc_code(NEW.empresa_id, 'OT');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_work_orders_zcode ON public.work_orders;
CREATE TRIGGER trg_work_orders_zcode BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_work_order_code();

DROP TRIGGER IF EXISTS trg_work_orders_updated ON public.work_orders;
CREATE TRIGGER trg_work_orders_updated BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Versionado: cualquier edición sustancial invalida links anteriores
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_quotation_version_on_doc_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Solo PROFORMA versiona. Si el cambio es solo de aceptación/estado de
  -- cobranza (o el propio bump desde ítems), no se suma de nuevo.
  IF NEW.doc_type IS DISTINCT FROM 'PROFORMA' THEN RETURN NEW; END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR COALESCE(NEW.notes, '') IS DISTINCT FROM COALESCE(OLD.notes, '')
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date THEN
    NEW.quotation_version := COALESCE(OLD.quotation_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sales_documents_version_bump ON public.sales_documents;
CREATE TRIGGER trg_sales_documents_version_bump BEFORE UPDATE ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION public.bump_quotation_version_on_doc_update();

CREATE OR REPLACE FUNCTION public.bump_quotation_version_on_item_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc uuid;
BEGIN
  v_doc := COALESCE(NEW.sales_document_id, OLD.sales_document_id);
  UPDATE public.sales_documents
    SET quotation_version = COALESCE(quotation_version, 1) + 1
    WHERE id = v_doc AND doc_type = 'PROFORMA'
      AND acceptance_status IN ('DRAFT', 'PENDING_ACCEPTANCE');
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sales_items_version_bump ON public.sales_document_items;
CREATE TRIGGER trg_sales_items_version_bump
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_document_items
  FOR EACH ROW EXECUTE FUNCTION public.bump_quotation_version_on_item_change();

-- ---------------------------------------------------------------------------
-- 8. RPCs del portal público (SECURITY DEFINER, invocables por anon)
-- ---------------------------------------------------------------------------

-- Vista de auditoría (best-effort, nunca rompe la página pública).
CREATE OR REPLACE FUNCTION public.log_quotation_view(
  p_token text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok public.sales_quotation_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_tok FROM public.sales_quotation_tokens WHERE token = p_token;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.sales_quotation_events
    (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent)
  VALUES (v_tok.empresa_id, v_tok.sales_document_id, v_tok.id, 'VIEWED', 'cliente', p_ip, p_user_agent);
END;
$$;
REVOKE ALL ON FUNCTION public.log_quotation_view(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_quotation_view(text, text, text) TO anon, authenticated, service_role;

-- Aceptación electrónica: el cliente acepta la COTIZACIÓN; la OT se genera
-- adentro, atómica e idempotente. Nunca expone la OT al cliente.
CREATE OR REPLACE FUNCTION public.accept_quotation(
  p_token text,
  p_acceptor_name text,
  p_acceptor_doc text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tok public.sales_quotation_tokens%ROWTYPE;
  v_doc public.sales_documents%ROWTYPE;
  v_wo public.work_orders%ROWTYPE;
  v_name text;
  v_exp timestamptz;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'Enlace inválido.';
  END IF;
  v_name := btrim(COALESCE(p_acceptor_name, ''));
  IF char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'Indicá tu nombre y apellido para aceptar.';
  END IF;

  SELECT * INTO v_tok FROM public.sales_quotation_tokens WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace inválido.'; END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Este enlace fue revocado. Pedí un nuevo enlace a la empresa.'; END IF;

  SELECT * INTO v_doc FROM public.sales_documents WHERE id = v_tok.sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada.'; END IF;
  IF v_doc.doc_type IS DISTINCT FROM 'PROFORMA' THEN RAISE EXCEPTION 'Este documento no es una cotización.'; END IF;

  -- Idempotencia: si ya fue aceptada, devolver la OT existente sin duplicar.
  IF v_doc.acceptance_status = 'ACCEPTED' THEN
    SELECT * INTO v_wo FROM public.work_orders WHERE sales_document_id = v_doc.id;
    RETURN jsonb_build_object(
      'sales_document_id', v_doc.id,
      'work_order_id', CASE WHEN v_wo.id IS NULL THEN NULL ELSE v_wo.id END,
      'already_accepted', true);
  END IF;

  IF v_doc.acceptance_status = 'REJECTED' THEN RAISE EXCEPTION 'Esta cotización ya fue rechazada.'; END IF;
  IF v_doc.acceptance_status = 'DRAFT' THEN RAISE EXCEPTION 'Esta cotización todavía no está habilitada para aceptar.'; END IF;

  -- Expiración: vale la más restrictiva entre link y documento.
  v_exp := LEAST(
    COALESCE(v_tok.expires_at, v_doc.acceptance_expires_at, now() + interval '1 second'),
    COALESCE(v_doc.acceptance_expires_at, v_tok.expires_at, now() + interval '1 second'));
  -- Si ambas son NULL, no hay vencimiento: el LEAST de arriba daría now()+1s,
  -- así que se recalcula correctamente acá.
  IF v_tok.expires_at IS NULL AND v_doc.acceptance_expires_at IS NULL THEN v_exp := NULL; END IF;
  IF v_exp IS NOT NULL AND now() > v_exp THEN
    IF v_doc.acceptance_status = 'PENDING_ACCEPTANCE' THEN
      UPDATE public.sales_documents SET acceptance_status = 'EXPIRED' WHERE id = v_doc.id;
      INSERT INTO public.sales_quotation_events
        (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent, detail)
      VALUES (v_doc.empresa_id, v_doc.id, v_tok.id, 'EXPIRED', 'sistema', p_ip, p_user_agent,
        jsonb_build_object('reason', 'expired_on_accept_attempt'));
    END IF;
    RAISE EXCEPTION 'Esta cotización venció. Contactá a la empresa para pedir una nueva.';
  END IF;

  IF v_doc.acceptance_status = 'EXPIRED' THEN
    RAISE EXCEPTION 'Esta cotización venció. Contactá a la empresa para pedir una nueva.';
  END IF;
  IF v_doc.acceptance_status <> 'PENDING_ACCEPTANCE' THEN
    RAISE EXCEPTION 'Esta cotización no está pendiente de aceptación.';
  END IF;

  -- Versión: el link congela la versión ofrecida; si el ERP la editó después,
  -- el cliente no puede aceptar la versión vieja.
  IF v_tok.quotation_version IS DISTINCT FROM v_doc.quotation_version THEN
    RAISE EXCEPTION 'La cotización fue actualizada por la empresa. Pedí el nuevo enlace antes de aceptar.';
  END IF;

  UPDATE public.sales_documents SET
    acceptance_status = 'ACCEPTED',
    accepted_at = now(),
    accepted_by_name = v_name,
    accepted_by_doc = NULLIF(btrim(COALESCE(p_acceptor_doc, '')), ''),
    rejection_reason = NULL,
    rejected_at = NULL
  WHERE id = v_doc.id;

  INSERT INTO public.sales_quotation_events
    (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent, detail)
  VALUES (v_doc.empresa_id, v_doc.id, v_tok.id, 'ACCEPTED', v_name, p_ip, p_user_agent,
    jsonb_build_object('acceptor_doc', p_acceptor_doc, 'notes', p_notes, 'quotation_version', v_doc.quotation_version));

  -- OT interna, idempotente por UNIQUE(sales_document_id).
  SELECT * INTO v_wo FROM public.work_orders WHERE sales_document_id = v_doc.id;
  IF NOT FOUND THEN
    INSERT INTO public.work_orders
      (empresa_id, sales_document_id, client_id, currency, subtotal, vat_amount, total, status, notes)
    VALUES (
      v_doc.empresa_id, v_doc.id, v_doc.client_id, v_doc.currency,
      v_doc.subtotal, v_doc.vat_amount, v_doc.total, 'PENDIENTE',
      'Generada automáticamente por aceptación electrónica de ' || v_doc.code
        || ' v' || v_doc.quotation_version || ' por ' || v_name || '.'
        || CASE WHEN p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN ' Comentario del cliente: ' || btrim(p_notes) ELSE '' END)
    RETURNING * INTO v_wo;

    INSERT INTO public.work_order_items
      (empresa_id, work_order_id, description, quantity, unit_price, vat_rate, line_total)
    SELECT v_doc.empresa_id, v_wo.id, description, quantity, unit_price, vat_rate, line_total
    FROM public.sales_document_items WHERE sales_document_id = v_doc.id ORDER BY created_at;

    INSERT INTO public.sales_quotation_events
      (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent, detail)
    VALUES (v_doc.empresa_id, v_doc.id, v_tok.id, 'WORK_ORDER_CREATED', 'sistema', NULL, NULL,
      jsonb_build_object('work_order_id', v_wo.id, 'work_order_code', v_wo.code));
  END IF;

  RETURN jsonb_build_object(
    'sales_document_id', v_doc.id,
    'work_order_id', v_wo.id,
    'already_accepted', false);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_quotation(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_quotation(text, text, text, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_quotation(
  p_token text,
  p_reason text DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tok public.sales_quotation_tokens%ROWTYPE;
  v_doc public.sales_documents%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN RAISE EXCEPTION 'Enlace inválido.'; END IF;
  SELECT * INTO v_tok FROM public.sales_quotation_tokens WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace inválido.'; END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Este enlace fue revocado.'; END IF;

  SELECT * INTO v_doc FROM public.sales_documents WHERE id = v_tok.sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada.'; END IF;
  IF v_doc.acceptance_status = 'ACCEPTED' THEN RAISE EXCEPTION 'Esta cotización ya fue aceptada y no se puede rechazar.'; END IF;
  IF v_doc.acceptance_status = 'REJECTED' THEN
    RETURN jsonb_build_object('sales_document_id', v_doc.id, 'already_rejected', true);
  END IF;
  IF v_doc.acceptance_status <> 'PENDING_ACCEPTANCE' THEN
    RAISE EXCEPTION 'Esta cotización no está pendiente de aceptación.';
  END IF;
  IF v_tok.quotation_version IS DISTINCT FROM v_doc.quotation_version THEN
    RAISE EXCEPTION 'La cotización fue actualizada por la empresa. Pedí el nuevo enlace.';
  END IF;

  UPDATE public.sales_documents SET
    acceptance_status = 'REJECTED',
    rejected_at = now(),
    rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = v_doc.id;

  INSERT INTO public.sales_quotation_events
    (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent, detail)
  VALUES (v_doc.empresa_id, v_doc.id, v_tok.id, 'REJECTED',
    COALESCE(NULLIF(btrim(COALESCE(p_actor_name, '')), ''), 'cliente'), p_ip, p_user_agent,
    jsonb_build_object('reason', p_reason, 'quotation_version', v_doc.quotation_version));

  RETURN jsonb_build_object('sales_document_id', v_doc.id, 'already_rejected', false);
END;
$$;
REVOKE ALL ON FUNCTION public.reject_quotation(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_quotation(text, text, text, text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. RLS interno (portal público NO lee tablas directo: usa service_role/RPC)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_quotation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotation_tokens_rw ON public.sales_quotation_tokens FOR ALL USING (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
) WITH CHECK (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);

-- Eventos: lectura interna + inserción interna; el portal escribe vía RPC
-- (SECURITY DEFINER bypasea RLS), nunca con INSERT directo.
CREATE POLICY quotation_events_select ON public.sales_quotation_events FOR SELECT USING (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);
CREATE POLICY quotation_events_insert ON public.sales_quotation_events FOR INSERT WITH CHECK (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);

CREATE POLICY work_orders_rw ON public.work_orders FOR ALL USING (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
) WITH CHECK (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);

CREATE POLICY work_order_items_rw ON public.work_order_items FOR ALL USING (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
) WITH CHECK (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);
