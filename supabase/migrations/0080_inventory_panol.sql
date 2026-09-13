-- ============================================================================
-- 0080_inventory_panol.sql
--
-- Inventario / pañol / consumo canónico para construcción.
--
-- Esta migración es aditiva. El modelo legacy (productos, depositos,
-- stock_por_deposito, stock_movimientos y oc_recepciones) sigue disponible para
-- las pantallas existentes. El nuevo modelo es la fuente de verdad para los
-- flujos nuevos: el saldo físico vive en inventory_balances por ubicación y el
-- stock global se deriva de esos saldos; nunca se incrementa por separado.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Ubicaciones y saldos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  location_type       text NOT NULL CHECK (location_type IN ('CENTRAL', 'PROJECT', 'AUXILIARY')),
  name                text NOT NULL CHECK (length(trim(name)) > 0),
  project_id          uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
  parent_location_id  uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  is_primary          boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_locations_project_type_check
    CHECK (location_type <> 'PROJECT' OR project_id IS NOT NULL),
  CONSTRAINT inventory_locations_not_self_parent
    CHECK (parent_location_id IS NULL OR parent_location_id <> id),
  UNIQUE (empresa_id, name)
);

CREATE INDEX IF NOT EXISTS idx_inventory_locations_empresa
  ON public.inventory_locations(empresa_id, active, name);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_project
  ON public.inventory_locations(project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_one_primary_central
  ON public.inventory_locations(empresa_id)
  WHERE location_type = 'CENTRAL' AND is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_one_project_primary
  ON public.inventory_locations(empresa_id, project_id)
  WHERE location_type = 'PROJECT' AND is_primary;

CREATE TABLE IF NOT EXISTS public.inventory_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id    uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  location_id    uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  cost_currency  public.currency_code NOT NULL,
  quantity       numeric(18,4) NOT NULL CHECK (quantity >= 0),
  total_cost     numeric(20,6) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, producto_id, location_id, cost_currency)
);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_product
  ON public.inventory_balances(empresa_id, producto_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_location
  ON public.inventory_balances(empresa_id, location_id);

-- ---------------------------------------------------------------------------
-- 2. Libro append-only de movimientos y costos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id              uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  quantity                 numeric(18,4) NOT NULL CHECK (quantity <> 0),
  unit                     text NOT NULL CHECK (length(trim(unit)) > 0),
  movement_type             text NOT NULL CHECK (
    movement_type IN ('RECEIPT', 'TRANSFER', 'CONSUMPTION', 'RETURN', 'ADJUSTMENT')
  ),
  from_location_id          uuid REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  to_location_id            uuid REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  project_id                uuid REFERENCES public.projects(id) ON DELETE RESTRICT,
  budget_item_id            uuid REFERENCES public.budget_items(id) ON DELETE RESTRICT,
  source_type               text NOT NULL DEFAULT 'MANUAL',
  source_id                 uuid,
  source_line_id            uuid,
  status                    text NOT NULL DEFAULT 'CONFIRMED'
                            CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOIDED')),
  idempotency_key           text NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  cost_currency             public.currency_code,
  unit_cost                 numeric(20,6) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  cost_total                numeric(20,6),
  exchange_rate_to_company  numeric(20,8) CHECK (
    exchange_rate_to_company IS NULL OR exchange_rate_to_company > 0
  ),
  cost_total_company        numeric(20,6),
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  confirmed_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_shape_check CHECK (
    (movement_type = 'RECEIPT'
      AND from_location_id IS NULL AND to_location_id IS NOT NULL AND quantity > 0)
    OR (movement_type = 'TRANSFER'
      AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL
      AND from_location_id <> to_location_id AND quantity > 0)
    OR (movement_type = 'CONSUMPTION'
      AND from_location_id IS NOT NULL AND to_location_id IS NULL
      AND quantity > 0 AND project_id IS NOT NULL AND budget_item_id IS NOT NULL)
    OR (movement_type = 'RETURN'
      AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL
      AND from_location_id <> to_location_id AND quantity > 0)
    OR (movement_type = 'ADJUSTMENT'
      AND ((quantity > 0 AND from_location_id IS NULL AND to_location_id IS NOT NULL)
        OR (quantity < 0 AND from_location_id IS NOT NULL AND to_location_id IS NULL)))
  ),
  CONSTRAINT inventory_movements_consumption_budget_check CHECK (
    movement_type = 'CONSUMPTION' OR budget_item_id IS NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_idempotency
  ON public.inventory_movements(empresa_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_source_once
  ON public.inventory_movements(
    empresa_id, source_type, source_id, source_line_id, movement_type
  )
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created
  ON public.inventory_movements(empresa_id, producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_location_created
  ON public.inventory_movements(empresa_id, from_location_id, to_location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_budget
  ON public.inventory_movements(empresa_id, project_id, budget_item_id)
  WHERE budget_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_movement_costs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  movement_id              uuid NOT NULL REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  quantity                 numeric(18,4) NOT NULL CHECK (quantity > 0),
  cost_currency             public.currency_code NOT NULL,
  unit_cost                 numeric(20,6) NOT NULL CHECK (unit_cost >= 0),
  total_cost                numeric(20,6) NOT NULL CHECK (total_cost >= 0),
  exchange_rate_to_company  numeric(20,8) CHECK (
    exchange_rate_to_company IS NULL OR exchange_rate_to_company > 0
  ),
  total_cost_company        numeric(20,6),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movement_costs_movement
  ON public.inventory_movement_costs(empresa_id, movement_id);

-- Confirmed movements are immutable. Reversals are new movements.
CREATE OR REPLACE FUNCTION public.prevent_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Los movimientos de inventario confirmados son inmutables; use una reversión o ajuste';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_movements_immutable ON public.inventory_movements;
CREATE TRIGGER trg_inventory_movements_immutable
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_movement_mutation();

-- ---------------------------------------------------------------------------
-- 3. Recepción y rendición del pañol
-- ---------------------------------------------------------------------------

ALTER TABLE public.oc_recepciones
  ADD COLUMN IF NOT EXISTS delivery_location_id uuid
    REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS remision_number text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.oc_recepciones
  DROP CONSTRAINT IF EXISTS oc_recepciones_status_check;
ALTER TABLE public.oc_recepciones
  ADD CONSTRAINT oc_recepciones_status_check
  CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOIDED'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_recepciones_idempotency
  ON public.oc_recepciones(empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oc_recepciones_delivery_location
  ON public.oc_recepciones(empresa_id, delivery_location_id);

ALTER TABLE public.oc_recepcion_items
  ADD COLUMN IF NOT EXISTS inventory_movement_id uuid
    REFERENCES public.inventory_movements(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_recepcion_item_inventory_movement
  ON public.oc_recepcion_items(inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_receipt_evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  receipt_id         uuid NOT NULL REFERENCES public.oc_recepciones(id) ON DELETE CASCADE,
  storage_bucket     text NOT NULL,
  storage_path       text NOT NULL,
  file_name          text NOT NULL,
  mime_type          text,
  size_bytes         bigint,
  sha256             text,
  uploaded_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_inventory_receipt_evidence_receipt
  ON public.inventory_receipt_evidence(empresa_id, receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_receipt_evidence_sha256
  ON public.inventory_receipt_evidence(receipt_id, sha256)
  WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.warehouse_portal_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  location_id   uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  token_hint    text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  expires_at    timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_warehouse_portal_links_location
  ON public.warehouse_portal_links(empresa_id, location_id, active);

CREATE TABLE IF NOT EXISTS public.warehouse_submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  location_id        uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  portal_link_id     uuid REFERENCES public.warehouse_portal_links(id) ON DELETE SET NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  remision_number    text,
  notes              text,
  status             text NOT NULL DEFAULT 'UPLOADED'
                     CHECK (status IN ('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'READY', 'CONFIRMED', 'VOIDED')),
  processing_error   text,
  submitted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  processing_started_at timestamptz,
  processed_at       timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (location_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_submissions_empresa_status
  ON public.warehouse_submissions(empresa_id, status, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_submissions_project_period
  ON public.warehouse_submissions(empresa_id, project_id, period_end DESC);

CREATE TABLE IF NOT EXISTS public.warehouse_submission_evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  submission_id      uuid NOT NULL REFERENCES public.warehouse_submissions(id) ON DELETE CASCADE,
  storage_bucket     text NOT NULL,
  storage_path       text NOT NULL,
  file_name          text NOT NULL,
  mime_type          text,
  size_bytes         bigint,
  sha256             text,
  uploaded_external  boolean NOT NULL DEFAULT false,
  extraction_status  text NOT NULL DEFAULT 'NOT_PROCESSED'
                     CHECK (extraction_status IN ('NOT_PROCESSED', 'PROCESSING', 'PROPOSED', 'FAILED', 'REVIEWED')),
  extraction_result  jsonb,
  extraction_error   text,
  confidence         numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  uploaded_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_submission_evidence_submission
  ON public.warehouse_submission_evidence(empresa_id, submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_submission_evidence_sha256
  ON public.warehouse_submission_evidence(submission_id, sha256)
  WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.warehouse_submission_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  submission_id      uuid NOT NULL REFERENCES public.warehouse_submissions(id) ON DELETE CASCADE,
  line_number        integer NOT NULL CHECK (line_number > 0),
  raw_description    text NOT NULL,
  producto_id        uuid REFERENCES public.productos(id) ON DELETE RESTRICT,
  quantity           numeric(18,4) CHECK (quantity IS NULL OR quantity > 0),
  unit               text,
  budget_item_id     uuid REFERENCES public.budget_items(id) ON DELETE RESTRICT,
  state              text NOT NULL DEFAULT 'PROPOSED'
                     CHECK (state IN ('PROPOSED', 'CONFIRMED', 'REJECTED')),
  uncertainty_reason text,
  confidence         numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_evidence_id uuid REFERENCES public.warehouse_submission_evidence(id) ON DELETE SET NULL,
  inventory_movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_submission_lines_submission
  ON public.warehouse_submission_lines(empresa_id, submission_id, state);

-- Puente de lectura no destructivo desde el inventario legacy. Reutilizamos
-- los UUID de depositos cuando existen para que las pantallas actuales puedan
-- seguir mostrando el desglose. El costo legacy ya estaba expresado en la
-- moneda operativa de la empresa; no se hace ninguna conversión FX.
INSERT INTO public.inventory_locations (
  id, empresa_id, location_type, name, project_id, is_primary, active
)
SELECT
  d.id,
  d.empresa_id,
  CASE WHEN d.project_id IS NULL THEN 'CENTRAL' ELSE 'PROJECT' END,
  d.nombre,
  d.project_id,
  d.es_principal,
  d.activo
FROM public.depositos d
ON CONFLICT DO NOTHING;

INSERT INTO public.inventory_balances (
  empresa_id, producto_id, location_id, cost_currency, quantity, total_cost
)
SELECT
  s.empresa_id,
  s.producto_id,
  s.deposito_id,
  'PYG'::public.currency_code,
  greatest(0, s.stock_actual),
  greatest(0, s.stock_actual * coalesce(p.costo_promedio, 0))
FROM public.stock_por_deposito s
JOIN public.productos p ON p.id = s.producto_id AND p.empresa_id = s.empresa_id
JOIN public.inventory_locations l ON l.id = s.deposito_id AND l.empresa_id = s.empresa_id
WHERE s.stock_actual > 0
ON CONFLICT (empresa_id, producto_id, location_id, cost_currency) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('warehouse-evidence', 'warehouse-evidence', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'internal read warehouse evidence'
  ) THEN
    CREATE POLICY "internal read warehouse evidence" ON storage.objects FOR SELECT
      USING (
        bucket_id = 'warehouse-evidence'
        AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Validaciones de tenant y referencias cruzadas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_inventory_location_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND (public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM NEW.empresa_id) THEN
    RAISE EXCEPTION 'La ubicación no pertenece al tenant de la sesión';
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.projects WHERE id = NEW.project_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'El proyecto no pertenece a la empresa de la ubicación';
    END IF;
  END IF;

  IF NEW.parent_location_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa
    FROM public.inventory_locations WHERE id = NEW.parent_location_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La ubicación padre no pertenece a la misma empresa';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inventory_location_tenant ON public.inventory_locations;
CREATE TRIGGER trg_validate_inventory_location_tenant
  BEFORE INSERT OR UPDATE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_location_tenant();

CREATE OR REPLACE FUNCTION public.validate_oc_receipt_inventory_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
BEGIN
  IF NEW.delivery_location_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.inventory_locations
    WHERE id = NEW.delivery_location_id AND active;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La ubicación de entrega no pertenece al tenant o está inactiva';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_oc_receipt_inventory_location ON public.oc_recepciones;
CREATE TRIGGER trg_validate_oc_receipt_inventory_location
  BEFORE INSERT OR UPDATE ON public.oc_recepciones
  FOR EACH ROW EXECUTE FUNCTION public.validate_oc_receipt_inventory_location();

CREATE OR REPLACE FUNCTION public.validate_inventory_balance_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa_producto uuid;
  v_empresa_location uuid;
BEGIN
  SELECT empresa_id INTO v_empresa_producto FROM public.productos WHERE id = NEW.producto_id;
  SELECT empresa_id INTO v_empresa_location FROM public.inventory_locations WHERE id = NEW.location_id;
  IF v_empresa_producto IS NULL OR v_empresa_location IS NULL
     OR v_empresa_producto IS DISTINCT FROM NEW.empresa_id
     OR v_empresa_location IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'El saldo referencia datos de otro tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inventory_balance_tenant ON public.inventory_balances;
CREATE TRIGGER trg_validate_inventory_balance_tenant
  BEFORE INSERT OR UPDATE ON public.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_balance_tenant();

CREATE OR REPLACE FUNCTION public.validate_inventory_movement_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
  v_budget_project uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND (public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM NEW.empresa_id) THEN
    RAISE EXCEPTION 'El movimiento no pertenece al tenant de la sesión';
  END IF;

  SELECT empresa_id INTO v_empresa FROM public.productos WHERE id = NEW.producto_id;
  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'El material no pertenece a la empresa del movimiento';
  END IF;

  IF NEW.from_location_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.inventory_locations WHERE id = NEW.from_location_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La ubicación origen no pertenece a la empresa';
    END IF;
  END IF;
  IF NEW.to_location_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.inventory_locations WHERE id = NEW.to_location_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La ubicación destino no pertenece a la empresa';
    END IF;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.projects WHERE id = NEW.project_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'El proyecto no pertenece a la empresa';
    END IF;
  END IF;
  IF NEW.budget_item_id IS NOT NULL THEN
    SELECT p.empresa_id, bi.project_id INTO v_empresa, v_budget_project
    FROM public.budget_items bi
    JOIN public.projects p ON p.id = bi.project_id
    WHERE bi.id = NEW.budget_item_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id
       OR v_budget_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'La partida no pertenece a la empresa';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inventory_movement_tenant ON public.inventory_movements;
CREATE TRIGGER trg_validate_inventory_movement_tenant
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_movement_tenant();

CREATE OR REPLACE FUNCTION public.validate_inventory_movement_cost_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_empresa FROM public.inventory_movements WHERE id = NEW.movement_id;
  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'El detalle de costo no pertenece al tenant del movimiento';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inventory_movement_cost_tenant ON public.inventory_movement_costs;
CREATE TRIGGER trg_validate_inventory_movement_cost_tenant
  BEFORE INSERT ON public.inventory_movement_costs
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_movement_cost_tenant();

CREATE OR REPLACE FUNCTION public.validate_warehouse_portal_link_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
BEGIN
  SELECT empresa_id INTO v_empresa
  FROM public.inventory_locations
  WHERE id = NEW.location_id
    AND active
    AND location_type = 'PROJECT'
    AND project_id IS NOT NULL;
  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'El link del pañol no referencia una ubicación del tenant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_warehouse_portal_link_tenant ON public.warehouse_portal_links;
CREATE TRIGGER trg_validate_warehouse_portal_link_tenant
  BEFORE INSERT OR UPDATE ON public.warehouse_portal_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_portal_link_tenant();

CREATE OR REPLACE FUNCTION public.validate_warehouse_submission_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
  v_location_project uuid;
BEGIN
  SELECT empresa_id, project_id INTO v_empresa, v_location_project
  FROM public.inventory_locations WHERE id = NEW.location_id;
  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id
     OR v_location_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'La rendición no coincide con la ubicación/proyecto del tenant';
  END IF;
  SELECT empresa_id INTO v_empresa FROM public.projects WHERE id = NEW.project_id;
  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'El proyecto de la rendición no pertenece al tenant';
  END IF;
  IF NEW.portal_link_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.warehouse_portal_links
    WHERE id = NEW.portal_link_id AND location_id = NEW.location_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'El link del portal no corresponde a la ubicación';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_warehouse_submission_tenant ON public.warehouse_submissions;
CREATE TRIGGER trg_validate_warehouse_submission_tenant
  BEFORE INSERT OR UPDATE ON public.warehouse_submissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_submission_tenant();

CREATE OR REPLACE FUNCTION public.validate_warehouse_submission_line_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa uuid;
  v_project uuid;
BEGIN
  SELECT empresa_id, project_id INTO v_empresa, v_project
  FROM public.warehouse_submissions WHERE id = NEW.submission_id;
  IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'La línea de rendición no pertenece al tenant';
  END IF;
  IF NEW.producto_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.productos WHERE id = NEW.producto_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'El material de la rendición no pertenece al tenant';
    END IF;
  END IF;
  IF NEW.budget_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_items
    WHERE id = NEW.budget_item_id AND project_id = v_project
  ) THEN
    RAISE EXCEPTION 'La partida de la rendición no pertenece a la obra';
  END IF;
  IF NEW.source_evidence_id IS NOT NULL THEN
    SELECT empresa_id INTO v_empresa FROM public.warehouse_submission_evidence
    WHERE id = NEW.source_evidence_id AND submission_id = NEW.submission_id;
    IF v_empresa IS NULL OR v_empresa IS DISTINCT FROM NEW.empresa_id THEN
      RAISE EXCEPTION 'La evidencia no pertenece a la rendición';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_warehouse_submission_line_tenant ON public.warehouse_submission_lines;
CREATE TRIGGER trg_validate_warehouse_submission_line_tenant
  BEFORE INSERT OR UPDATE ON public.warehouse_submission_lines
  FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_submission_line_tenant();

CREATE OR REPLACE FUNCTION public.sync_inventory_legacy_projection(
  p_empresa_id uuid,
  p_producto_id uuid,
  p_location_ids uuid[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- productos.stock_actual remains a compatibility projection only. The
  -- canonical quantity is always the sum of inventory_balances.
  UPDATE public.productos
  SET stock_actual = (
    SELECT coalesce(sum(quantity), 0)
    FROM public.inventory_balances
    WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
  ), updated_at = now()
  WHERE id = p_producto_id AND empresa_id = p_empresa_id;

  -- Keep old per-deposito screens coherent where the canonical location was
  -- backfilled from the legacy deposito UUID. New canonical locations simply
  -- have no legacy row and remain canonical-only.
  INSERT INTO public.stock_por_deposito (empresa_id, producto_id, deposito_id, stock_actual)
  SELECT
    p_empresa_id, p_producto_id, d.id,
    coalesce((SELECT sum(b.quantity)
              FROM public.inventory_balances b
              WHERE b.empresa_id = p_empresa_id
                AND b.producto_id = p_producto_id
                AND b.location_id = d.id), 0)
  FROM public.depositos d
  WHERE d.empresa_id = p_empresa_id AND d.id = ANY(p_location_ids)
  ON CONFLICT (producto_id, deposito_id) DO UPDATE
    SET stock_actual = EXCLUDED.stock_actual;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC atómica e idempotente de movimientos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_post_movement(
  p_empresa_id               uuid,
  p_producto_id              uuid,
  p_quantity                 numeric,
  p_unit                     text,
  p_movement_type             text,
  p_from_location_id         uuid DEFAULT NULL,
  p_to_location_id           uuid DEFAULT NULL,
  p_project_id               uuid DEFAULT NULL,
  p_budget_item_id           uuid DEFAULT NULL,
  p_source_type              text DEFAULT 'MANUAL',
  p_source_id                uuid DEFAULT NULL,
  p_source_line_id           uuid DEFAULT NULL,
  p_idempotency_key          text DEFAULT NULL,
  p_cost_currency             public.currency_code DEFAULT NULL,
  p_unit_cost                 numeric DEFAULT NULL,
  p_exchange_rate_to_company  numeric DEFAULT NULL,
  p_created_by                uuid DEFAULT NULL,
  p_metadata                 jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type                text := upper(trim(p_movement_type));
  v_source_type         text := coalesce(nullif(trim(p_source_type), ''), 'MANUAL');
  v_idempotency_key     text := nullif(trim(p_idempotency_key), '');
  v_existing            record;
  v_movement_id         uuid;
  v_product_unit        text;
  v_product_empresa     uuid;
  v_location_empresa    uuid;
  v_from_project        uuid;
  v_to_project          uuid;
  v_from_type           text;
  v_to_type             text;
  v_context_project     uuid := p_project_id;
  v_currency             public.currency_code := p_cost_currency;
  v_order_currency      public.currency_code;
  v_receipt_location    uuid;
  v_receipt_order       uuid;
  v_receipt_product     uuid;
  v_receipt_quantity    numeric;
  v_cost_unit            numeric;
  v_total_cost           numeric := 0;
  v_total_cost_company   numeric;
  v_remaining             numeric;
  v_take                  numeric;
  v_cost_take             numeric;
  v_currency_count        integer;
  v_currency_text         text;
  v_cost_quantity         numeric;
  v_balance               record;
  v_balance_unit_cost     numeric;
  v_had_balance           boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'Acceso denegado: tenant inválido';
    END IF;
    IF NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'No tenés permisos para registrar movimientos de inventario';
    END IF;
  END IF;

  IF v_type NOT IN ('RECEIPT', 'TRANSFER', 'CONSUMPTION', 'RETURN', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_movement_type;
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 OR (v_type <> 'ADJUSTMENT' AND p_quantity < 0) THEN
    RAISE EXCEPTION 'La cantidad del movimiento no es válida';
  END IF;
  IF v_type = 'RECEIPT' AND (p_from_location_id IS NOT NULL OR p_to_location_id IS NULL) THEN
    RAISE EXCEPTION 'Una recepción necesita solo ubicación destino';
  ELSIF v_type = 'TRANSFER' AND (p_from_location_id IS NULL OR p_to_location_id IS NULL
      OR p_from_location_id = p_to_location_id) THEN
    RAISE EXCEPTION 'Una transferencia necesita origen y destino distintos';
  ELSIF v_type = 'CONSUMPTION' AND (p_from_location_id IS NULL OR p_to_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Un consumo necesita solo ubicación origen';
  ELSIF v_type = 'RETURN' AND (p_from_location_id IS NULL OR p_to_location_id IS NULL
      OR p_from_location_id = p_to_location_id) THEN
    RAISE EXCEPTION 'RETURN necesita origen y destino distintos';
  ELSIF v_type = 'ADJUSTMENT' AND (
      (p_quantity > 0 AND (p_from_location_id IS NOT NULL OR p_to_location_id IS NULL))
      OR (p_quantity < 0 AND (p_from_location_id IS NULL OR p_to_location_id IS NOT NULL))
    ) THEN
    RAISE EXCEPTION 'La forma del ajuste no es válida';
  END IF;
  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN
    RAISE EXCEPTION 'La unidad del movimiento es obligatoria';
  END IF;
  IF v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'La idempotency_key es obligatoria';
  END IF;
  -- Serializa reintentos concurrentes de la misma operación antes de leer el
  -- libro. Así la restricción única es una última defensa y no el mecanismo
  -- normal de idempotencia.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_empresa_id::text || ':' || v_idempotency_key, 0)
  );
  IF p_source_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_empresa_id::text || ':' || v_source_type || ':' || p_source_id::text
          || ':' || coalesce(p_source_line_id::text, ''),
        0
      )
    );
  END IF;
  IF p_exchange_rate_to_company IS NOT NULL AND p_exchange_rate_to_company <= 0 THEN
    RAISE EXCEPTION 'El tipo de cambio debe ser mayor a cero';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'El costo unitario no puede ser negativo';
  END IF;

  -- Retry seguro: primero por clave explícita y luego por origen canónico.
  SELECT * INTO v_existing
  FROM public.inventory_movements
  WHERE empresa_id = p_empresa_id AND idempotency_key = v_idempotency_key;
  IF FOUND THEN
    IF v_existing.producto_id IS DISTINCT FROM p_producto_id
       OR v_existing.quantity IS DISTINCT FROM p_quantity
       OR v_existing.movement_type IS DISTINCT FROM v_type
       OR v_existing.from_location_id IS DISTINCT FROM p_from_location_id
       OR v_existing.to_location_id IS DISTINCT FROM p_to_location_id
       OR (p_project_id IS NOT NULL AND v_existing.project_id IS DISTINCT FROM p_project_id)
       OR (p_budget_item_id IS NOT NULL AND v_existing.budget_item_id IS DISTINCT FROM p_budget_item_id) THEN
      RAISE EXCEPTION 'La idempotency_key ya fue usada para otra operación';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.inventory_movements
    WHERE empresa_id = p_empresa_id
      AND source_type = v_source_type
      AND source_id = p_source_id
      AND source_line_id IS NOT DISTINCT FROM p_source_line_id
      AND movement_type = v_type;
    IF FOUND THEN
      IF v_existing.producto_id IS DISTINCT FROM p_producto_id
         OR v_existing.quantity IS DISTINCT FROM p_quantity
         OR v_existing.from_location_id IS DISTINCT FROM p_from_location_id
         OR v_existing.to_location_id IS DISTINCT FROM p_to_location_id
         OR (p_project_id IS NOT NULL AND v_existing.project_id IS DISTINCT FROM p_project_id)
         OR (p_budget_item_id IS NOT NULL AND v_existing.budget_item_id IS DISTINCT FROM p_budget_item_id) THEN
        RAISE EXCEPTION 'El origen ya fue aplicado con otra operación';
      END IF;
      RETURN v_existing.id;
    END IF;
  END IF;

  SELECT empresa_id, unidad INTO v_product_empresa, v_product_unit
  FROM public.productos
  WHERE id = p_producto_id;
  IF v_product_empresa IS NULL OR v_product_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'El material no pertenece a la empresa';
  END IF;
  IF trim(v_product_unit) <> trim(p_unit) THEN
    RAISE EXCEPTION 'La unidad no coincide con la unidad del material';
  END IF;

  IF p_from_location_id IS NOT NULL THEN
    SELECT empresa_id, project_id, location_type
      INTO v_location_empresa, v_from_project, v_from_type
    FROM public.inventory_locations
    WHERE id = p_from_location_id AND active;
    IF v_location_empresa IS NULL OR v_location_empresa IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'La ubicación origen no pertenece a la empresa o está inactiva';
    END IF;
  END IF;
  IF p_to_location_id IS NOT NULL THEN
    SELECT empresa_id, project_id, location_type
      INTO v_location_empresa, v_to_project, v_to_type
    FROM public.inventory_locations
    WHERE id = p_to_location_id AND active;
    IF v_location_empresa IS NULL OR v_location_empresa IS DISTINCT FROM p_empresa_id THEN
      RAISE EXCEPTION 'La ubicación destino no pertenece a la empresa o está inactiva';
    END IF;
  END IF;

  -- Un receipt canónico queda vinculado a la OC, su tenant, ítem y moneda real.
  IF v_type = 'RECEIPT' AND v_source_type = 'OC_RECEPCION' AND p_source_id IS NOT NULL THEN
    SELECT r.order_id, r.delivery_location_id, oi.currency, ri.producto_id, ri.cantidad_recibida
      INTO v_receipt_order, v_receipt_location, v_order_currency,
           v_receipt_product, v_receipt_quantity
    FROM public.oc_recepciones r
    JOIN public.oc_recepcion_items ri ON ri.recepcion_id = r.id
    JOIN public.authorized_orders oi ON oi.id = r.order_id
    WHERE r.id = p_source_id
      AND ri.id = p_source_line_id
      AND r.empresa_id = p_empresa_id
      AND oi.empresa_id = p_empresa_id
      AND ri.empresa_id = p_empresa_id;
    IF v_receipt_order IS NULL THEN
      RAISE EXCEPTION 'La recepción o su línea no pertenece a la empresa';
    END IF;
    IF v_receipt_product IS DISTINCT FROM p_producto_id
       OR p_quantity > v_receipt_quantity THEN
      RAISE EXCEPTION 'La línea de recepción no coincide con el material o cantidad';
    END IF;
    IF v_receipt_location IS NOT NULL AND v_receipt_location IS DISTINCT FROM p_to_location_id THEN
      RAISE EXCEPTION 'La ubicación no coincide con la recepción';
    END IF;
    v_context_project := coalesce(v_context_project,
      (SELECT project_id FROM public.authorized_orders WHERE id = v_receipt_order));
    v_currency := coalesce(v_currency, v_order_currency);
  END IF;

  IF v_to_project IS NOT NULL AND v_type IN ('RECEIPT', 'RETURN') THEN
    IF v_context_project IS NULL THEN v_context_project := v_to_project; END IF;
    IF v_context_project IS DISTINCT FROM v_to_project THEN
      RAISE EXCEPTION 'El proyecto contextual no coincide con la ubicación destino';
    END IF;
  END IF;
  IF v_type = 'CONSUMPTION' THEN
    IF v_context_project IS NULL OR p_budget_item_id IS NULL THEN
      RAISE EXCEPTION 'El consumo requiere proyecto y partida presupuestaria';
    END IF;
    IF v_from_project IS DISTINCT FROM v_context_project THEN
      RAISE EXCEPTION 'El consumo debe salir del pañol de la obra indicada';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.budget_items bi
      JOIN public.projects pr ON pr.id = bi.project_id
      WHERE bi.id = p_budget_item_id
        AND bi.project_id = v_context_project
        AND pr.empresa_id = p_empresa_id
    ) THEN
      RAISE EXCEPTION 'La partida no pertenece al proyecto y tenant indicados';
    END IF;
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa';
  END IF;
  IF p_budget_item_id IS NOT NULL AND v_type <> 'CONSUMPTION' THEN
    RAISE EXCEPTION 'Solo el consumo puede imputarse a una partida';
  END IF;

  IF v_type = 'RECEIPT' AND (v_currency IS NULL OR p_unit_cost IS NULL) THEN
    RAISE EXCEPTION 'La recepción necesita costo y moneda de compra explícitos';
  END IF;
  IF v_type = 'ADJUSTMENT' AND (v_currency IS NULL OR p_unit_cost IS NULL) THEN
    RAISE EXCEPTION 'El ajuste necesita costo y moneda explicitos';
  END IF;

  INSERT INTO public.inventory_movements (
    empresa_id, producto_id, quantity, unit, movement_type,
    from_location_id, to_location_id, project_id, budget_item_id,
    source_type, source_id, source_line_id, idempotency_key,
    status, created_by, confirmed_by, metadata
  ) VALUES (
    p_empresa_id, p_producto_id, p_quantity, trim(p_unit), v_type,
    p_from_location_id, p_to_location_id, v_context_project, p_budget_item_id,
    v_source_type, p_source_id, p_source_line_id, v_idempotency_key,
    'DRAFT', p_created_by, p_created_by, coalesce(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_movement_id;

  IF v_type = 'RECEIPT' OR (v_type = 'ADJUSTMENT' AND p_quantity > 0) THEN
    v_cost_unit := p_unit_cost;
    v_total_cost := p_quantity * v_cost_unit;
    INSERT INTO public.inventory_balances (
      empresa_id, producto_id, location_id, cost_currency, quantity, total_cost
    ) VALUES (
      p_empresa_id, p_producto_id, p_to_location_id, v_currency, p_quantity, v_total_cost
    )
    ON CONFLICT (empresa_id, producto_id, location_id, cost_currency)
    DO UPDATE SET
      quantity = public.inventory_balances.quantity + EXCLUDED.quantity,
      total_cost = public.inventory_balances.total_cost + EXCLUDED.total_cost,
      updated_at = now();

    INSERT INTO public.inventory_movement_costs (
      empresa_id, movement_id, quantity, cost_currency, unit_cost, total_cost,
      exchange_rate_to_company, total_cost_company
    ) VALUES (
      p_empresa_id, v_movement_id, p_quantity, v_currency, v_cost_unit, v_total_cost,
      p_exchange_rate_to_company,
      CASE WHEN p_exchange_rate_to_company IS NULL THEN NULL
           ELSE v_total_cost * p_exchange_rate_to_company END
    );

  ELSIF v_type = 'ADJUSTMENT' AND p_quantity < 0 THEN
    SELECT quantity, total_cost INTO v_balance
    FROM public.inventory_balances
    WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
      AND location_id = p_from_location_id AND cost_currency = v_currency
    FOR UPDATE;
    IF NOT FOUND OR v_balance.quantity < abs(p_quantity) THEN
      RAISE EXCEPTION 'Stock insuficiente para el ajuste';
    END IF;
    v_cost_unit := CASE WHEN v_balance.quantity = 0 THEN 0
                        ELSE v_balance.total_cost / v_balance.quantity END;
    v_total_cost := abs(p_quantity) * v_cost_unit;
    UPDATE public.inventory_balances
    SET quantity = quantity - abs(p_quantity),
        total_cost = greatest(0, total_cost - v_total_cost), updated_at = now()
    WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
      AND location_id = p_from_location_id AND cost_currency = v_currency;
    INSERT INTO public.inventory_movement_costs (
      empresa_id, movement_id, quantity, cost_currency, unit_cost, total_cost,
      exchange_rate_to_company, total_cost_company
    ) VALUES (
      p_empresa_id, v_movement_id, abs(p_quantity), v_currency, v_cost_unit, v_total_cost,
      p_exchange_rate_to_company,
      CASE WHEN p_exchange_rate_to_company IS NULL THEN NULL
           ELSE v_total_cost * p_exchange_rate_to_company END
    );
    v_total_cost := -v_total_cost;

  ELSE
    -- Transferencias, devoluciones y consumos descargan los saldos por moneda, preservando
    -- el costo real transportado. Si hay varias monedas no se las convierte ni
    -- se las mezcla: el movimiento conserva varias filas de costo.
    v_remaining := p_quantity;
    FOR v_balance IN
      SELECT id, cost_currency, quantity, total_cost
      FROM public.inventory_balances
      WHERE empresa_id = p_empresa_id AND producto_id = p_producto_id
        AND location_id = p_from_location_id AND quantity > 0
      ORDER BY cost_currency::text
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := least(v_remaining, v_balance.quantity);
      v_balance_unit_cost := CASE WHEN v_balance.quantity = 0 THEN 0
                                  ELSE v_balance.total_cost / v_balance.quantity END;
      v_cost_take := CASE WHEN v_take = v_balance.quantity THEN v_balance.total_cost
                          ELSE v_take * v_balance_unit_cost END;

      UPDATE public.inventory_balances
      SET quantity = quantity - v_take,
          total_cost = greatest(0, total_cost - v_cost_take), updated_at = now()
      WHERE id = v_balance.id;

      INSERT INTO public.inventory_movement_costs (
        empresa_id, movement_id, quantity, cost_currency, unit_cost, total_cost,
        exchange_rate_to_company, total_cost_company
      ) VALUES (
        p_empresa_id, v_movement_id, v_take, v_balance.cost_currency,
        v_balance_unit_cost, v_cost_take, NULL, NULL
      );

      IF v_type IN ('TRANSFER', 'RETURN') THEN
        INSERT INTO public.inventory_balances (
          empresa_id, producto_id, location_id, cost_currency, quantity, total_cost
        ) VALUES (
          p_empresa_id, p_producto_id, p_to_location_id, v_balance.cost_currency,
          v_take, v_cost_take
        )
        ON CONFLICT (empresa_id, producto_id, location_id, cost_currency)
        DO UPDATE SET
          quantity = public.inventory_balances.quantity + EXCLUDED.quantity,
          total_cost = public.inventory_balances.total_cost + EXCLUDED.total_cost,
          updated_at = now();
      END IF;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF coalesce(v_remaining, p_quantity) > 0 THEN
      RAISE EXCEPTION 'Stock insuficiente en la ubicación origen: faltan %', v_remaining;
    END IF;

    SELECT coalesce(sum(total_cost), 0), coalesce(sum(quantity), 0),
           count(DISTINCT cost_currency), min(cost_currency::text),
           CASE WHEN count(*) = count(total_cost_company)
                THEN sum(total_cost_company) ELSE NULL END
      INTO v_total_cost, v_cost_quantity, v_currency_count, v_currency_text,
           v_total_cost_company
    FROM public.inventory_movement_costs
    WHERE movement_id = v_movement_id;
  END IF;

  -- RECEIPT/ADJUSTMENT también usan el mismo resumen canónico.
  IF v_type = 'RECEIPT' OR v_type = 'ADJUSTMENT' THEN
    SELECT count(DISTINCT cost_currency), min(cost_currency::text),
           CASE WHEN count(*) = count(total_cost_company)
                THEN sum(total_cost_company) ELSE NULL END
      INTO v_currency_count, v_currency_text, v_total_cost_company
    FROM public.inventory_movement_costs
    WHERE movement_id = v_movement_id;
  END IF;

  IF v_currency_count = 1 THEN
    v_currency := v_currency_text::public.currency_code;
    SELECT sum(total_cost) / NULLIF(sum(quantity), 0)
      INTO v_cost_unit
    FROM public.inventory_movement_costs
    WHERE movement_id = v_movement_id;
  ELSE
    v_currency := NULL;
    v_cost_unit := NULL;
  END IF;

  UPDATE public.inventory_movements
  SET cost_currency = v_currency,
      unit_cost = v_cost_unit,
      cost_total = CASE WHEN v_type = 'ADJUSTMENT' AND p_quantity < 0
                        THEN v_total_cost ELSE abs(v_total_cost) END,
      exchange_rate_to_company = CASE
        WHEN v_type IN ('RECEIPT', 'ADJUSTMENT') AND v_currency_count = 1
          THEN p_exchange_rate_to_company
        ELSE NULL
      END,
      cost_total_company = CASE WHEN v_type = 'ADJUSTMENT' AND p_quantity < 0
                                THEN CASE WHEN v_total_cost_company IS NULL THEN NULL ELSE -v_total_cost_company END
                                ELSE v_total_cost_company END,
      status = 'CONFIRMED', confirmed_by = p_created_by, confirmed_at = now()
  WHERE id = v_movement_id;

  PERFORM public.sync_inventory_legacy_projection(
    p_empresa_id,
    p_producto_id,
    ARRAY[p_from_location_id, p_to_location_id]::uuid[]
  );

  RETURN v_movement_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Wrappers atómicos para recepción y rendición
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_confirm_receipt(
  p_empresa_id          uuid,
  p_receipt_id          uuid,
  p_delivery_location_id uuid DEFAULT NULL,
  p_idempotency_key     text DEFAULT NULL,
  p_confirmed_by        uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
  v_order record;
  v_location uuid := p_delivery_location_id;
  v_item record;
  v_movement uuid;
  v_ids uuid[] := '{}';
  v_key text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar recepción';
    END IF;
  END IF;

  SELECT * INTO v_receipt
  FROM public.oc_recepciones
  WHERE id = p_receipt_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recepción no encontrada'; END IF;
  IF v_receipt.status = 'VOIDED' THEN RAISE EXCEPTION 'La recepción está anulada'; END IF;
  IF v_receipt.status = 'CONFIRMED' THEN
    IF p_delivery_location_id IS NOT NULL
       AND p_delivery_location_id IS DISTINCT FROM v_receipt.delivery_location_id THEN
      RAISE EXCEPTION 'La recepción ya fue confirmada en otra ubicación';
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

  SELECT id, project_id, currency INTO v_order
  FROM public.authorized_orders
  WHERE id = v_receipt.order_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La OC de la recepción no pertenece a la empresa'; END IF;

  v_location := coalesce(v_location, v_receipt.delivery_location_id);
  IF v_location IS NULL THEN
    SELECT il.id INTO v_location
    FROM public.inventory_locations il
    WHERE il.empresa_id = p_empresa_id AND il.active
      AND ((v_order.project_id IS NOT NULL AND il.location_type = 'PROJECT'
            AND il.project_id = v_order.project_id)
        OR (v_order.project_id IS NULL AND il.location_type = 'CENTRAL' AND il.is_primary))
    ORDER BY il.is_primary DESC, il.created_at
    LIMIT 1;
  END IF;
  IF v_location IS NULL THEN
    RAISE EXCEPTION 'La recepción necesita una ubicación de entrega válida';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations
    WHERE id = v_location AND empresa_id = p_empresa_id AND active
  ) THEN
    RAISE EXCEPTION 'La ubicación de entrega no pertenece a la empresa';
  END IF;

  FOR v_item IN
    SELECT ri.id, ri.producto_id, ri.cantidad_recibida, ri.inventory_movement_id,
           oi.unit, oi.unit_price
    FROM public.oc_recepcion_items ri
    JOIN public.authorized_order_items oi ON oi.id = ri.order_item_id
    WHERE ri.recepcion_id = p_receipt_id
      AND ri.empresa_id = p_empresa_id
      AND oi.empresa_id = p_empresa_id
  LOOP
    IF v_item.producto_id IS NULL THEN
      RAISE EXCEPTION 'La línea de recepción % necesita vincularse a un material del catálogo', v_item.id;
    END IF;
    IF v_item.inventory_movement_id IS NOT NULL THEN
      v_ids := array_append(v_ids, v_item.inventory_movement_id);
      CONTINUE;
    END IF;
    v_key := coalesce(nullif(trim(p_idempotency_key), ''), p_receipt_id::text) || ':' || v_item.id::text;
    v_movement := public.inventory_post_movement(
      p_empresa_id := p_empresa_id,
      p_producto_id := v_item.producto_id,
      p_quantity := v_item.cantidad_recibida,
      p_unit := v_item.unit,
      p_movement_type := 'RECEIPT',
      p_to_location_id := v_location,
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
    WHERE id = v_item.id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;

  UPDATE public.oc_recepciones
  SET delivery_location_id = v_location,
      status = 'CONFIRMED', confirmed_by = p_confirmed_by,
      confirmed_at = now(), updated_at = now()
  WHERE id = p_receipt_id;
  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_confirm_warehouse_submission(
  p_empresa_id      uuid,
  p_submission_id   uuid,
  p_confirmed_by    uuid,
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
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar rendición';
    END IF;
  END IF;

  SELECT * INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rendición no encontrada'; END IF;
  IF v_submission.status = 'VOIDED' THEN RAISE EXCEPTION 'La rendición está anulada'; END IF;
  IF v_submission.status = 'CONFIRMED' THEN
    SELECT coalesce(array_agg(inventory_movement_id ORDER BY line_number), '{}') INTO v_ids
    FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id AND inventory_movement_id IS NOT NULL;
    RETURN v_ids;
  END IF;
  IF v_submission.status NOT IN ('READY', 'NEEDS_REVIEW') THEN
    RAISE EXCEPTION 'La rendición todavía no está lista para confirmar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id AND state = 'PROPOSED'
  ) THEN
    RAISE EXCEPTION 'La rendición todavía tiene líneas propuestas sin revisar';
  END IF;

  FOR v_line IN
    SELECT * FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id AND empresa_id = p_empresa_id AND state = 'CONFIRMED'
    ORDER BY line_number
  LOOP
    IF v_line.producto_id IS NULL OR v_line.quantity IS NULL OR v_line.unit IS NULL
       OR v_line.budget_item_id IS NULL THEN
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
    WHERE id = v_line.id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;

  UPDATE public.warehouse_submissions
  SET status = 'CONFIRMED', confirmed_by = p_confirmed_by,
      confirmed_at = now(), updated_at = now(), processing_error = NULL
  WHERE id = p_submission_id;
  RETURN v_ids;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Vistas canónicas: global derivado, por ubicación y por obra
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.inventory_stock_by_location AS
SELECT
  b.empresa_id,
  b.location_id,
  l.name AS location_name,
  l.location_type,
  l.project_id,
  b.producto_id,
  p.nombre AS producto,
  p.unidad,
  b.cost_currency,
  b.quantity,
  b.total_cost,
  b.updated_at
FROM public.inventory_balances b
JOIN public.inventory_locations l ON l.id = b.location_id
JOIN public.productos p ON p.id = b.producto_id
WHERE b.quantity > 0;

CREATE OR REPLACE VIEW public.inventory_stock_global AS
SELECT
  empresa_id, producto_id, producto, unidad, cost_currency,
  sum(quantity) AS quantity, sum(total_cost) AS total_cost
FROM public.inventory_stock_by_location
GROUP BY empresa_id, producto_id, producto, unidad, cost_currency;

CREATE OR REPLACE VIEW public.inventory_stock_global_quantity AS
SELECT empresa_id, producto_id, producto, unidad, sum(quantity) AS quantity
FROM public.inventory_stock_by_location
GROUP BY empresa_id, producto_id, producto, unidad;

CREATE OR REPLACE VIEW public.inventory_stock_by_project AS
SELECT
  empresa_id, project_id, producto_id, producto, unidad, cost_currency,
  sum(quantity) AS quantity, sum(total_cost) AS total_cost
FROM public.inventory_stock_by_location
WHERE project_id IS NOT NULL
GROUP BY empresa_id, project_id, producto_id, producto, unidad, cost_currency;

CREATE VIEW public.inventory_consumption_by_budget AS
SELECT
  m.empresa_id, m.project_id, m.budget_item_id, m.producto_id,
  p.nombre AS producto, p.unidad,
  sum(c.quantity) AS quantity_consumed,
  c.cost_currency,
  sum(c.total_cost) AS cost_consumed,
  sum(c.total_cost_company) AS cost_consumed_company
FROM public.inventory_movements m
JOIN public.productos p ON p.id = m.producto_id
JOIN public.inventory_movement_costs c ON c.movement_id = m.id
WHERE m.movement_type = 'CONSUMPTION' AND m.status = 'CONFIRMED'
GROUP BY m.empresa_id, m.project_id, m.budget_item_id, m.producto_id,
         p.nombre, p.unidad, c.cost_currency;

ALTER VIEW public.inventory_stock_by_location SET (security_invoker = true);
ALTER VIEW public.inventory_stock_global SET (security_invoker = true);
ALTER VIEW public.inventory_stock_global_quantity SET (security_invoker = true);
ALTER VIEW public.inventory_stock_by_project SET (security_invoker = true);
ALTER VIEW public.inventory_consumption_by_budget SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 8. RLS y grants explícitos
-- ---------------------------------------------------------------------------

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movement_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipt_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_portal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_submission_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_submission_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_locations_select ON public.inventory_locations
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY inventory_locations_insert ON public.inventory_locations
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY inventory_locations_update ON public.inventory_locations
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  ) WITH CHECK (empresa_id = public.current_empresa_id());

CREATE POLICY inventory_balances_select ON public.inventory_balances
  FOR SELECT USING (empresa_id = public.current_empresa_id());
CREATE POLICY inventory_movements_select ON public.inventory_movements
  FOR SELECT USING (empresa_id = public.current_empresa_id());
CREATE POLICY inventory_movement_costs_select ON public.inventory_movement_costs
  FOR SELECT USING (empresa_id = public.current_empresa_id());
CREATE POLICY inventory_receipt_evidence_select ON public.inventory_receipt_evidence
  FOR SELECT USING (empresa_id = public.current_empresa_id());

CREATE POLICY warehouse_portal_links_select ON public.warehouse_portal_links
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_portal_links_insert ON public.warehouse_portal_links
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_portal_links_update ON public.warehouse_portal_links
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  ) WITH CHECK (empresa_id = public.current_empresa_id());

CREATE POLICY warehouse_submissions_select ON public.warehouse_submissions
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_submissions_insert ON public.warehouse_submissions
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_submissions_update ON public.warehouse_submissions
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  ) WITH CHECK (empresa_id = public.current_empresa_id());
CREATE POLICY warehouse_submission_evidence_select ON public.warehouse_submission_evidence
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_submission_evidence_insert ON public.warehouse_submission_evidence
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_submission_evidence_update ON public.warehouse_submission_evidence
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  ) WITH CHECK (empresa_id = public.current_empresa_id());
CREATE POLICY warehouse_submission_lines_select ON public.warehouse_submission_lines
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_submission_lines_insert ON public.warehouse_submission_lines
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
CREATE POLICY warehouse_submission_lines_update ON public.warehouse_submission_lines
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  ) WITH CHECK (empresa_id = public.current_empresa_id());

-- Las funciones SECURITY DEFINER nuevas no deben quedar ejecutables por
-- PUBLIC/anon por defecto. Las RPC de negocio se habilitan explícitamente
-- para authenticated y service_role debajo; las demás solo se usan como
-- triggers o desde otra función privilegiada.
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_movement_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_inventory_location_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_oc_receipt_inventory_location() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_inventory_balance_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_inventory_movement_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_inventory_movement_cost_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_warehouse_portal_link_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_warehouse_submission_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_warehouse_submission_line_tenant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_inventory_legacy_projection(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inventory_post_movement(
  uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid,
  text, public.currency_code, numeric, numeric, uuid, jsonb
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inventory_confirm_receipt(uuid, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text) FROM PUBLIC;

GRANT SELECT ON public.inventory_stock_by_location,
  public.inventory_stock_global,
  public.inventory_stock_global_quantity,
  public.inventory_stock_by_project,
  public.inventory_consumption_by_budget
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_post_movement(
  uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid,
  text, public.currency_code, numeric, numeric, uuid, jsonb
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_confirm_receipt(uuid, uuid, uuid, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text)
  TO authenticated, service_role;
