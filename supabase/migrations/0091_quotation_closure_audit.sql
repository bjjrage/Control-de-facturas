-- =============================================================================
-- 0091_quotation_closure_audit.sql — Auditoría de cierre del flujo de aceptación
--
-- Responde a la auditoría de cierre (12 puntos) sobre 0090. 0090 queda como
-- historia; este delta corrige lo observado. Nada de 0090/0091 se aplicó aún
-- a producción: ambas deben certificarse primero en un entorno seguro/branch.
--
-- PUNTO 1 — ACCEPTANCE RECORD explícito e inmutable:
--   sales_quotation_acceptances: una fila por cotización aceptada con
--   quotation_id, quotation_version, tenant_id, accepted_at, customer_id,
--   customer_name snapshot, total/subtotal/vat/currency snapshots,
--   canal, recipient_email, IP, user_agent, token_id + token_prefix
--   (referencia SIN el secreto), items_snapshot jsonb inmutable y
--   work_order_id. UNIQUE(sales_document_id) = una sola aceptación por
--   cotización (idempotencia a nivel constraint, además del RPC).
--   Append-only: RLS solo SELECT+INSERT interno, sin UPDATE/DELETE.
--
-- PUNTO 2 — TOKEN SECURITY (hash, no plaintext):
--   0090 guardaba el magic token en texto plano. 0091 migra a:
--   URL = token aleatorio 256-bit base64url (generado en app, nunca en DB);
--   DB = solo token_hash (sha256 hex) + token_prefix (8 chars, correlación de
--   soporte, insuficiente para adivinar). Lookup siempre por hash. Los links
--   generados bajo 0090 siguen funcionando (hash retrocalculado) pero el
--   plaintext se elimina con DROP COLUMN. El raw solo existe en memoria en el
--   instante de creación (se muestra una vez) y jamás se loguea.
--
-- PUNTOS 7/8 — SEMÁNTICA DE EMAIL Y COPIADO:
--   'SENT' se renombra a 'EMAIL_PREPARED' (mailto: compuesto ≠ email enviado;
--   no existe provider SMTP en el repo). Filas históricas 'SENT' se migran.
--   Nuevo evento 'LINK_COPIED' (copiar ≠ entregar). Nunca se registra
--   EMAIL_SENT: no podemos comprobar envío.
--
-- PUNTO 5/6 — WORKFLOW INTERNO DE LA OT por configuración:
--   work_order_routing_policies con jerarquía PROJECT → CLIENT →
--   TENANT_DEFAULT → SYSTEM_DEFAULT, sin personas hardcodeadas (solo
--   user_role como responsable). La OT resuelve al aceptar:
--   RESPONSIBLE_APPROVAL → PENDING_INTERNAL_APPROVAL (requiere aprobación
--   interna por rol), DIRECT_TO_PRODUCTION → READY_FOR_PRODUCTION.
--
-- PUNTO 10 — CIERRE DE CARRERA V1 vs V2:
--   Guards a nivel DB que prohíben edición sustancial de documentos e ítems
--   de una PROFORMA ACCEPTED. Combinado con SELECT ... FOR UPDATE + chequeo
--   de versión dentro del RPC: si la aceptación commitea primero, la edición
--   concurrente aborta; si la edición commitea primero, la versión ya no
--   coincide y la aceptación se rechaza. No hay ventana de aceptación
--   superseded.
--
-- PUNTO 4 — DOBLE ACEPTACIÓN:
--   UNIQUE(sales_quotation_acceptances.sales_document_id) +
--   UNIQUE(work_orders.sales_document_id, ya en 0090) + RPC con
--   INSERT ... ON CONFLICT DO NOTHING + retorno idempotente.
--
-- PUNTO 11 — SIN EFECTOS COLATERALES:
--   accept_quotation solo escribe: sales_documents (flag de aceptación),
--   work_orders + work_order_items, sales_quotation_acceptances,
--   sales_quotation_events. No toca stock, compras/OC, facturas, SIFEN ni
--   tesorería/contabilidad. Verificable por inspección del cuerpo + smoke.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipos de workflow de OT
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.work_order_approval_mode AS ENUM (
    'RESPONSIBLE_APPROVAL', 'DIRECT_TO_PRODUCTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.work_order_workflow_status AS ENUM (
    'PENDING_INTERNAL_APPROVAL', 'READY_FOR_PRODUCTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Tokens: hash + prefix, eliminar plaintext (PUNTO 2)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_quotation_tokens
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS token_prefix text,
  ADD COLUMN IF NOT EXISTS prepared_for_email text,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz;

-- Backfill de hashes desde los plaintext de 0090 (links previos siguen
-- válidos vía hash; el secreto se elimina abajo). Requiere pgcrypto (0001).
UPDATE public.sales_quotation_tokens
  SET token_hash = encode(digest(token, 'sha256'), 'hex'),
      token_prefix = left(token, 8)
  WHERE token_hash IS NULL;

-- Renombre semántico: lo que se registraba como "enviado" era un mailto
-- preparado (PUNTO 7). Migrar datos primero, renombrar después.
UPDATE public.sales_quotation_tokens
  SET prepared_for_email = sent_to_email,
      prepared_at = sent_at
  WHERE prepared_for_email IS NULL;

ALTER TABLE public.sales_quotation_tokens
  ALTER COLUMN token_hash SET NOT NULL,
  ALTER COLUMN token_prefix SET NOT NULL,
  ADD CONSTRAINT sales_quotation_tokens_hash_format
    CHECK (token_hash ~ '^[0-9a-f]{64}$');

-- El secreto reutilizable sale de la DB. Junto con la columna cae su
-- DEFAULT generador (gen_random_bytes): los tokens se generan en app.
ALTER TABLE public.sales_quotation_tokens DROP COLUMN IF EXISTS token;
ALTER TABLE public.sales_quotation_tokens DROP COLUMN IF EXISTS sent_to_email;
ALTER TABLE public.sales_quotation_tokens DROP COLUMN IF EXISTS sent_at;

DROP INDEX IF EXISTS public.idx_quotation_tokens_token;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_tokens_hash ON public.sales_quotation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_quotation_tokens_hash ON public.sales_quotation_tokens(token_hash);

-- ---------------------------------------------------------------------------
-- 3. Eventos: SENT → EMAIL_PREPARED + nuevos tipos (PUNTOS 7/8)
-- ---------------------------------------------------------------------------
UPDATE public.sales_quotation_events
  SET event_type = 'EMAIL_PREPARED'
  WHERE event_type = 'SENT';

ALTER TABLE public.sales_quotation_events
  DROP CONSTRAINT IF EXISTS sales_quotation_events_event_type_check;
ALTER TABLE public.sales_quotation_events
  ADD CONSTRAINT sales_quotation_events_type_allowed
    CHECK (event_type IN (
      'CREATED', 'EMAIL_PREPARED', 'LINK_COPIED', 'VIEWED', 'ACCEPTED',
      'REJECTED', 'REVOKED', 'EXPIRED', 'VERSION_SUPERSEDED',
      'WORK_ORDER_CREATED', 'WORKFLOW_RESOLVED', 'OT_STATUS_CHANGED'
    ));

-- ---------------------------------------------------------------------------
-- 4. Acceptance record explícito e inmutable (PUNTO 1 + PUNTO 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_quotation_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sales_document_id uuid NOT NULL UNIQUE REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  quotation_version int NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  client_name_snapshot text NOT NULL,
  subtotal_snapshot numeric(14,2) NOT NULL,
  vat_snapshot numeric(14,2) NOT NULL,
  total_snapshot numeric(14,2) NOT NULL,
  currency_snapshot public.currency_code NOT NULL,
  channel text NOT NULL DEFAULT 'PORTAL' CHECK (channel = 'PORTAL'),
  recipient_email text,
  acceptor_name text NOT NULL,
  acceptor_doc text,
  acceptor_notes text,
  ip text,
  user_agent text,
  token_id uuid REFERENCES public.sales_quotation_tokens(id) ON DELETE SET NULL,
  token_prefix text,
  items_snapshot jsonb NOT NULL,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_acceptances_empresa ON public.sales_quotation_acceptances(empresa_id);
CREATE INDEX IF NOT EXISTS idx_quotation_acceptances_client ON public.sales_quotation_acceptances(client_id);
CREATE INDEX IF NOT EXISTS idx_quotation_acceptances_token ON public.sales_quotation_acceptances(token_id);

CREATE OR REPLACE FUNCTION public.set_quotation_acceptance_empresa()
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
DROP TRIGGER IF EXISTS trg_quotation_acceptances_empresa ON public.sales_quotation_acceptances;
CREATE TRIGGER trg_quotation_acceptances_empresa BEFORE INSERT ON public.sales_quotation_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.set_quotation_acceptance_empresa();

-- ---------------------------------------------------------------------------
-- 5. Políticas de routing de OT por configuración (PUNTOS 5/6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_order_routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('TENANT_DEFAULT', 'CLIENT', 'PROJECT')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  mode public.work_order_approval_mode NOT NULL,
  responsible_role public.user_role NOT NULL DEFAULT 'administracion',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routing_scope_coherence CHECK (
    (scope = 'TENANT_DEFAULT' AND client_id IS NULL AND project_id IS NULL) OR
    (scope = 'CLIENT' AND client_id IS NOT NULL AND project_id IS NULL) OR
    (scope = 'PROJECT' AND project_id IS NOT NULL)
  )
);
-- Un default por tenant, una regla por cliente, una por proyecto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_tenant_default
  ON public.work_order_routing_policies(empresa_id) WHERE scope = 'TENANT_DEFAULT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_client
  ON public.work_order_routing_policies(empresa_id, client_id) WHERE scope = 'CLIENT';
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_project
  ON public.work_order_routing_policies(empresa_id, project_id) WHERE scope = 'PROJECT';
CREATE INDEX IF NOT EXISTS idx_routing_empresa ON public.work_order_routing_policies(empresa_id);

-- Default por tenant: DIRECT_TO_PRODUCTION (cero fricción para la operatoria
-- actual). Quien quiera control interno crea reglas CLIENT/PROJECT o cambia
-- el default a RESPONSIBLE_APPROVAL. Sin personas hardcodeadas.
INSERT INTO public.work_order_routing_policies (empresa_id, scope, mode, responsible_role)
SELECT e.id, 'TENANT_DEFAULT', 'DIRECT_TO_PRODUCTION', 'administracion'
FROM public.empresas e
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_routing_policy_empresa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.empresa_id IS NULL THEN
    NEW.empresa_id := COALESCE(
      (SELECT empresa_id FROM public.clients WHERE id = NEW.client_id),
      (SELECT empresa_id FROM public.projects WHERE id = NEW.project_id),
      public.current_empresa_id());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_routing_policies_empresa ON public.work_order_routing_policies;
CREATE TRIGGER trg_routing_policies_empresa BEFORE INSERT ON public.work_order_routing_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_routing_policy_empresa();

DROP TRIGGER IF EXISTS trg_routing_policies_updated ON public.work_order_routing_policies;
CREATE TRIGGER trg_routing_policies_updated BEFORE UPDATE ON public.work_order_routing_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Resolución jerárquica: PROJECT → CLIENT → TENANT_DEFAULT → SYSTEM_DEFAULT.
CREATE OR REPLACE FUNCTION public.resolve_work_order_policy(
  p_empresa_id uuid, p_client_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS TABLE (
  mode public.work_order_approval_mode,
  policy_id uuid,
  scope text,
  responsible_role public.user_role
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  -- Columnas calificadas con alias: mode/scope/responsible_role también son
  -- nombres de parámetros OUT y sin calificar PL/pgSQL los sustituiría.
  IF p_project_id IS NOT NULL THEN
    SELECT p.mode, p.id, p.scope, p.responsible_role INTO r
    FROM public.work_order_routing_policies p
    WHERE p.empresa_id = p_empresa_id AND p.scope = 'PROJECT' AND p.project_id = p_project_id;
    IF FOUND THEN mode := r.mode; policy_id := r.id; scope := r.scope; responsible_role := r.responsible_role; RETURN NEXT; RETURN; END IF;
  END IF;
  SELECT p.mode, p.id, p.scope, p.responsible_role INTO r
  FROM public.work_order_routing_policies p
  WHERE p.empresa_id = p_empresa_id AND p.scope = 'CLIENT' AND p.client_id = p_client_id;
  IF FOUND THEN mode := r.mode; policy_id := r.id; scope := r.scope; responsible_role := r.responsible_role; RETURN NEXT; RETURN; END IF;
  SELECT p.mode, p.id, p.scope, p.responsible_role INTO r
  FROM public.work_order_routing_policies p
  WHERE p.empresa_id = p_empresa_id AND p.scope = 'TENANT_DEFAULT';
  IF FOUND THEN mode := r.mode; policy_id := r.id; scope := r.scope; responsible_role := r.responsible_role; RETURN NEXT; RETURN; END IF;
  mode := 'DIRECT_TO_PRODUCTION'; policy_id := NULL; scope := 'SYSTEM_DEFAULT'; responsible_role := 'administracion';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_work_order_policy(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_policy(uuid, uuid, uuid) TO authenticated, service_role;

-- Columnas de workflow en la OT (internas, nunca expuestas al portal).
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_mode public.work_order_approval_mode NOT NULL DEFAULT 'DIRECT_TO_PRODUCTION',
  ADD COLUMN IF NOT EXISTS workflow_status public.work_order_workflow_status NOT NULL DEFAULT 'PENDING_INTERNAL_APPROVAL',
  ADD COLUMN IF NOT EXISTS responsible_role public.user_role NOT NULL DEFAULT 'administracion',
  ADD COLUMN IF NOT EXISTS routing_policy_id uuid REFERENCES public.work_order_routing_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_workflow ON public.work_orders(workflow_status);
CREATE INDEX IF NOT EXISTS idx_work_orders_project ON public.work_orders(project_id);

-- ---------------------------------------------------------------------------
-- 6. Guards anti-edición post-aceptación (PUNTO 10, cierre de carrera)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_accepted_quotation_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.doc_type IS DISTINCT FROM 'PROFORMA' THEN RETURN NEW; END IF;
  IF OLD.acceptance_status IS DISTINCT FROM 'ACCEPTED' THEN RETURN NEW; END IF;
  -- Cambios de cobranza/estado (EMITIDA/ANULADA...) siguen permitidos: la
  -- inmutabilidad cubre el contenido comercial aceptado, no el ciclo de vida.
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR COALESCE(NEW.notes, '') IS DISTINCT FROM COALESCE(OLD.notes, '')
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.quotation_version IS DISTINCT FROM OLD.quotation_version THEN
    RAISE EXCEPTION 'Cotización aceptada (%) es inmutable: genere una nueva proforma para cambios.', OLD.code;
  END IF;
  RETURN NEW;
END;
$$;
-- Nombre con 'a' < 'v': corre ANTES del bump de versión en el mismo UPDATE.
DROP TRIGGER IF EXISTS trg_sales_documents_accepted_guard ON public.sales_documents;
CREATE TRIGGER trg_sales_documents_accepted_guard BEFORE UPDATE ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_accepted_quotation_immutable();

CREATE OR REPLACE FUNCTION public.guard_accepted_quotation_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status public.quotation_acceptance_status;
DECLARE v_doc uuid;
BEGIN
  v_doc := COALESCE(NEW.sales_document_id, OLD.sales_document_id);
  SELECT acceptance_status INTO v_status
  FROM public.sales_documents WHERE id = v_doc AND doc_type = 'PROFORMA';
  IF v_status = 'ACCEPTED' THEN
    RAISE EXCEPTION 'Ítems de cotización aceptada son inmutables (doc %).', v_doc;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_sales_items_accepted_guard ON public.sales_document_items;
CREATE TRIGGER trg_sales_items_accepted_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.sales_document_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_accepted_quotation_items();

-- ---------------------------------------------------------------------------
-- 7. RPCs públicos reescritos: lookup por hash + acceptance record (P.1-4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_quotation_view(
  p_token_hash text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok public.sales_quotation_tokens%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  SELECT * INTO v_tok FROM public.sales_quotation_tokens WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.sales_quotation_events
    (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent)
  VALUES (v_tok.empresa_id, v_tok.sales_document_id, v_tok.id, 'VIEWED', 'cliente', p_ip, p_user_agent);
END;
$$;
REVOKE ALL ON FUNCTION public.log_quotation_view(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_quotation_view(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_quotation(
  p_token_hash text,
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
  v_acc public.sales_quotation_acceptances%ROWTYPE;
  v_client_name text;
  v_items_snap jsonb;
  v_pol record;
  v_wf public.work_order_workflow_status;
  v_wo_created boolean := false;
  v_name text;
  v_exp timestamptz;
BEGIN
  -- Fail closed: hash malformado = enlace inválido, sin distinguir motivos.
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Enlace inválido.';
  END IF;
  v_name := btrim(COALESCE(p_acceptor_name, ''));
  IF char_length(v_name) < 2 OR char_length(v_name) > 200 THEN
    RAISE EXCEPTION 'Indicá tu nombre y apellido para aceptar.';
  END IF;

  -- Orden de bloqueo fijo token → documento: serializa aceptaciones
  -- concurrentes del mismo link en el lock del documento.
  SELECT * INTO v_tok FROM public.sales_quotation_tokens WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace inválido.'; END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Este enlace fue revocado. Pedí un nuevo enlace a la empresa.'; END IF;

  SELECT * INTO v_doc FROM public.sales_documents WHERE id = v_tok.sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada.'; END IF;
  -- Tenant isolation: el token solo puede resolver su propio documento.
  IF v_tok.empresa_id IS DISTINCT FROM v_doc.empresa_id THEN
    RAISE EXCEPTION 'Enlace inválido.';
  END IF;
  IF v_doc.doc_type IS DISTINCT FROM 'PROFORMA' THEN RAISE EXCEPTION 'Este documento no es una cotización.'; END IF;

  -- Idempotencia de lectura: ya aceptada → devolver lo existente.
  IF v_doc.acceptance_status = 'ACCEPTED' THEN
    SELECT * INTO v_wo FROM public.work_orders WHERE sales_document_id = v_doc.id;
    SELECT * INTO v_acc FROM public.sales_quotation_acceptances WHERE sales_document_id = v_doc.id;
    RETURN jsonb_build_object(
      'sales_document_id', v_doc.id,
      'work_order_id', CASE WHEN v_wo.id IS NULL THEN NULL ELSE v_wo.id END,
      'acceptance_id', CASE WHEN v_acc.id IS NULL THEN NULL ELSE v_acc.id END,
      'already_accepted', true);
  END IF;

  IF v_doc.acceptance_status = 'REJECTED' THEN
    RAISE EXCEPTION 'Esta cotización fue rechazada. Pedí a la empresa un nuevo ciclo de cotización.';
  END IF;
  IF v_doc.acceptance_status = 'DRAFT' THEN RAISE EXCEPTION 'Esta cotización todavía no está habilitada para aceptar.'; END IF;

  v_exp := LEAST(
    COALESCE(v_tok.expires_at, v_doc.acceptance_expires_at, now() + interval '1 second'),
    COALESCE(v_doc.acceptance_expires_at, v_tok.expires_at, now() + interval '1 second'));
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

  -- Versión congelada: el chequeo ocurre DENTRO de la transacción con el
  -- lock del documento ya tomado, así que una edición concurrente o bien
  -- commiteó antes (versión distinta → rechazo) o espera al lock y luego
  -- aborta en el guard de inmutabilidad. Sin ventana superseded.
  IF v_tok.quotation_version IS DISTINCT FROM v_doc.quotation_version THEN
    RAISE EXCEPTION 'La cotización fue actualizada por la empresa. Pedí el nuevo enlace antes de aceptar.';
  END IF;

  SELECT name INTO v_client_name FROM public.clients WHERE id = v_doc.client_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'description', description, 'quantity', quantity, 'unit_price', unit_price,
      'vat_rate', vat_rate, 'line_total', line_total) ORDER BY created_at), '[]'::jsonb)
    INTO v_items_snap
  FROM public.sales_document_items WHERE sales_document_id = v_doc.id;

  UPDATE public.sales_documents SET
    acceptance_status = 'ACCEPTED',
    accepted_at = now(),
    accepted_by_name = v_name,
    accepted_by_doc = NULLIF(btrim(COALESCE(p_acceptor_doc, '')), ''),
    rejection_reason = NULL,
    rejected_at = NULL
  WHERE id = v_doc.id;

  -- OT interna idempotente: UNIQUE(sales_document_id) + ON CONFLICT como
  -- backstop de concurrencia además de la serialización por locks.
  INSERT INTO public.work_orders
    (empresa_id, sales_document_id, client_id, currency, subtotal, vat_amount, total, status, notes)
  VALUES (
    v_doc.empresa_id, v_doc.id, v_doc.client_id, v_doc.currency,
    v_doc.subtotal, v_doc.vat_amount, v_doc.total, 'PENDIENTE',
    'Generada automáticamente por aceptación electrónica de ' || v_doc.code
      || ' v' || v_doc.quotation_version || ' por ' || v_name || '.'
      || CASE WHEN p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN ' Comentario del cliente: ' || btrim(p_notes) ELSE '' END)
  ON CONFLICT (sales_document_id) DO NOTHING
  RETURNING * INTO v_wo;
  IF FOUND THEN
    v_wo_created := true;
    INSERT INTO public.work_order_items
      (empresa_id, work_order_id, description, quantity, unit_price, vat_rate, line_total)
    SELECT v_doc.empresa_id, v_wo.id, description, quantity, unit_price, vat_rate, line_total
    FROM public.sales_document_items WHERE sales_document_id = v_doc.id ORDER BY created_at;
  ELSE
    SELECT * INTO v_wo FROM public.work_orders WHERE sales_document_id = v_doc.id;
  END IF;

  -- Acceptance record explícito: UNIQUE(sales_document_id) garantiza una
  -- sola aceptación por cotización aunque dos requests corran en paralelo.
  INSERT INTO public.sales_quotation_acceptances (
    empresa_id, sales_document_id, quotation_version, client_id, client_name_snapshot,
    subtotal_snapshot, vat_snapshot, total_snapshot, currency_snapshot, channel,
    recipient_email, acceptor_name, acceptor_doc, acceptor_notes, ip, user_agent,
    token_id, token_prefix, items_snapshot, work_order_id
  ) VALUES (
    v_doc.empresa_id, v_doc.id, v_doc.quotation_version, v_doc.client_id,
    COALESCE(v_client_name, '—'),
    v_doc.subtotal, v_doc.vat_amount, v_doc.total, v_doc.currency, 'PORTAL',
    v_tok.prepared_for_email, v_name,
    NULLIF(btrim(COALESCE(p_acceptor_doc, '')), ''),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_ip, p_user_agent, v_tok.id, v_tok.token_prefix, v_items_snap, v_wo.id)
  ON CONFLICT (sales_document_id) DO NOTHING
  RETURNING * INTO v_acc;
  IF NOT FOUND THEN
    SELECT * INTO v_acc FROM public.sales_quotation_acceptances WHERE sales_document_id = v_doc.id;
  END IF;

  -- Workflow interno resuelto por configuración (nunca hardcodea personas).
  SELECT * INTO v_pol FROM public.resolve_work_order_policy(v_doc.empresa_id, v_doc.client_id, NULL);
  v_wf := CASE WHEN v_pol.mode = 'RESPONSIBLE_APPROVAL'
    THEN 'PENDING_INTERNAL_APPROVAL'::public.work_order_workflow_status
    ELSE 'READY_FOR_PRODUCTION'::public.work_order_workflow_status END;
  UPDATE public.work_orders SET
    approval_mode = v_pol.mode,
    workflow_status = v_wf,
    responsible_role = v_pol.responsible_role,
    routing_policy_id = v_pol.policy_id
  WHERE id = v_wo.id;

  INSERT INTO public.sales_quotation_events
    (empresa_id, sales_document_id, token_id, event_type, actor_label, actor_ip, actor_user_agent, detail)
  VALUES
    (v_doc.empresa_id, v_doc.id, v_tok.id, 'ACCEPTED', v_name, p_ip, p_user_agent,
      jsonb_build_object('acceptance_id', v_acc.id, 'acceptor_doc', p_acceptor_doc,
        'quotation_version', v_doc.quotation_version)),
    (v_doc.empresa_id, v_doc.id, v_tok.id, 'WORK_ORDER_CREATED', 'sistema', NULL, NULL,
      jsonb_build_object('work_order_id', v_wo.id, 'work_order_code', v_wo.code,
        'acceptance_id', v_acc.id)),
    (v_doc.empresa_id, v_doc.id, v_tok.id, 'WORKFLOW_RESOLVED', 'sistema', NULL, NULL,
      jsonb_build_object('work_order_id', v_wo.id, 'mode', v_pol.mode,
        'workflow_status', v_wf, 'policy_scope', v_pol.scope,
        'responsible_role', v_pol.responsible_role));

  RETURN jsonb_build_object(
    'sales_document_id', v_doc.id,
    'work_order_id', v_wo.id,
    'acceptance_id', v_acc.id,
    'workflow_status', v_wf,
    'already_accepted', false);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_quotation(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_quotation(text, text, text, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_quotation(
  p_token_hash text,
  p_reason text DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tok public.sales_quotation_tokens%ROWTYPE;
  v_doc public.sales_documents%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Enlace inválido.'; END IF;
  SELECT * INTO v_tok FROM public.sales_quotation_tokens WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enlace inválido.'; END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Este enlace fue revocado.'; END IF;

  SELECT * INTO v_doc FROM public.sales_documents WHERE id = v_tok.sales_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada.'; END IF;
  IF v_tok.empresa_id IS DISTINCT FROM v_doc.empresa_id THEN
    RAISE EXCEPTION 'Enlace inválido.';
  END IF;
  -- El rechazo nunca crea OT: esta función no inserta en work_orders ni en
  -- sales_quotation_acceptances. Verificable por inspección.
  IF v_doc.acceptance_status = 'ACCEPTED' THEN RAISE EXCEPTION 'Esta cotización ya fue aceptada y no se puede rechazar.'; END IF;
  IF EXISTS (SELECT 1 FROM public.work_orders WHERE sales_document_id = v_doc.id) THEN
    RAISE EXCEPTION 'Esta cotización ya generó una Orden de Trabajo y no se puede rechazar.';
  END IF;
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
-- 8. RLS de tablas nuevas (portal público: sin policies anon → denegado)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_quotation_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_routing_policies ENABLE ROW LEVEL SECURITY;

-- Acceptance record: lectura + inserción interna (el portal inserta vía RPC
-- SECURITY DEFINER). Sin UPDATE ni DELETE: append-only/inmutable.
CREATE POLICY quotation_acceptances_select ON public.sales_quotation_acceptances FOR SELECT USING (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);
CREATE POLICY quotation_acceptances_insert ON public.sales_quotation_acceptances FOR INSERT WITH CHECK (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);

CREATE POLICY routing_policies_rw ON public.work_order_routing_policies FOR ALL USING (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
) WITH CHECK (
  empresa_id = public.current_empresa_id()
  AND public.is_internal_role(array['administracion','admin']::public.user_role[])
);
