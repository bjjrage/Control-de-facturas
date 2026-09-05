-- =============================================================================
-- 0030_construccion_caterpillar.sql
--
-- Módulo Construcción — Caterpillar. Partes diarios de personal y gestión de
-- subcontratistas con portal público (sin login) para carga de certificados.
--
-- DECISIONES DE DISEÑO (corrigen el prompt original del artifact):
--   1. retention_amount/net_payable NO pueden ser GENERATED ALWAYS AS con
--      subquery a otra tabla (Postgres no lo permite — solo columnas de la
--      misma fila). Se copia retention_pct del contrato al certificado en el
--      momento de crearlo (denormalizado): además de resolver el problema de
--      SQL, es semánticamente correcto — si el contrato cambia su % de
--      retención después, los certificados ya emitidos no deben recalcularse.
--   2. public_token vive en subcontractor_contracts, no en cada certificado.
--      El subcontratista necesita UN link persistente para ver su historial y
--      cargar certificados nuevos en cualquier momento, no uno por certificado.
--   3. El portal público (/certificados/[token]) sigue el mismo patrón ya
--      establecido en /cotizar/[token]: usa el cliente service-role
--      server-side y filtra por token en la query — no hay políticas RLS
--      para el rol anon. Evita inventar un mecanismo nuevo de acceso público.
--   4. RLS interna con current_empresa_id() (patrón correcto ya usado en
--      projects/budget_items/execution_entries), nunca el patrón inline sin
--      scoping que tiene payment_orders (leak pre-existente, aparte).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Partes diarios de personal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_labor_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entry_date       date NOT NULL,
  worker_name      text NOT NULL,
  hours            numeric(6,2) NOT NULL CHECK (hours > 0),
  hourly_cost      numeric(12,2) NOT NULL DEFAULT 0,
  labor_cost       numeric(14,2) GENERATED ALWAYS AS (ROUND(hours * hourly_cost, 2)) STORED,
  task_description text,
  recorded_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Catálogo de subcontratistas (por empresa, reutilizable entre proyectos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subcontractors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  name          text NOT NULL,
  ruc           text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  specialty     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subcontractors_empresa_ruc
  ON public.subcontractors(empresa_id, ruc) WHERE ruc IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Contratos de subcontratista por proyecto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subcontractor_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontractor_id   uuid NOT NULL REFERENCES public.subcontractors(id),
  budget_item_id     uuid REFERENCES public.budget_items(id) ON DELETE SET NULL,
  contracted_amount  numeric(18,2) NOT NULL CHECK (contracted_amount > 0),
  retention_pct      numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (retention_pct >= 0 AND retention_pct <= 100),
  description        text,
  signed_date        date,
  status             text NOT NULL DEFAULT 'ACTIVO' CHECK (status IN ('ACTIVO', 'CERRADO', 'CANCELADO')),
  -- Un solo link persistente para el portal del subcontratista — no uno por
  -- certificado. Visita el mismo link cuantas veces necesite.
  public_token       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Certificados de avance del subcontratista
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subcontractor_certificates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id        uuid NOT NULL REFERENCES public.subcontractor_contracts(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  certificate_number int NOT NULL,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  period_start       date,
  period_end         date,
  claimed_pct        numeric(5,2) NOT NULL CHECK (claimed_pct >= 0 AND claimed_pct <= 100),
  claimed_amount     numeric(18,2) NOT NULL CHECK (claimed_amount >= 0),
  approved_pct       numeric(5,2) CHECK (approved_pct IS NULL OR (approved_pct >= 0 AND approved_pct <= 100)),
  approved_amount    numeric(18,2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
  -- Copiado del contrato al crear el certificado (ver decisión de diseño #1).
  retention_pct      numeric(5,2) NOT NULL,
  retention_amount   numeric(18,2) GENERATED ALWAYS AS
                      (ROUND(COALESCE(approved_amount, 0) * retention_pct / 100, 2)) STORED,
  net_payable        numeric(18,2) GENERATED ALWAYS AS
                      (COALESCE(approved_amount, 0) - ROUND(COALESCE(approved_amount, 0) * retention_pct / 100, 2)) STORED,
  status             text NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'PAGADO')),
  ai_flags           jsonb,
  notes              text,
  submitted_by_portal boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, certificate_number)
);

-- ---------------------------------------------------------------------------
-- 5. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_labor_entries_project        ON public.daily_labor_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_subcontractors_empresa       ON public.subcontractors(empresa_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_project ON public.subcontractor_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_subcontractor ON public.subcontractor_contracts(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_token ON public.subcontractor_contracts(public_token);
CREATE INDEX IF NOT EXISTS idx_subcontractor_certificates_contract ON public.subcontractor_certificates(contract_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_certificates_project  ON public.subcontractor_certificates(project_id);

-- ---------------------------------------------------------------------------
-- 6. empresa_id automático en subcontractors (tabla raíz, patrón 0011)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_subcontractors_empresa BEFORE INSERT ON public.subcontractors
  FOR EACH ROW EXECUTE FUNCTION public.set_empresa_id_from_caller();

-- ---------------------------------------------------------------------------
-- 7. RLS — todas scoped por empresa vía current_empresa_id()
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_labor_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractor_contracts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractor_certificates ENABLE ROW LEVEL SECURITY;

-- daily_labor_entries (scoped vía project_id -> projects.empresa_id)
CREATE POLICY labor_entries_select ON public.daily_labor_entries
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY labor_entries_insert ON public.daily_labor_entries
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY labor_entries_update ON public.daily_labor_entries
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY labor_entries_delete ON public.daily_labor_entries
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

-- subcontractors
CREATE POLICY subcontractors_select ON public.subcontractors
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY subcontractors_insert ON public.subcontractors
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY subcontractors_update ON public.subcontractors
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

-- subcontractor_contracts (scoped vía project_id -> projects.empresa_id)
CREATE POLICY subcontractor_contracts_select ON public.subcontractor_contracts
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY subcontractor_contracts_insert ON public.subcontractor_contracts
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY subcontractor_contracts_update ON public.subcontractor_contracts
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

-- subcontractor_certificates (scoped vía project_id -> projects.empresa_id).
-- El acceso público (portal, sin login) NO pasa por RLS — usa el cliente
-- service-role server-side y filtra por contracts.public_token, igual que
-- el portal de RFQs existente (/cotizar/[token]).
CREATE POLICY subcontractor_certificates_select ON public.subcontractor_certificates
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY subcontractor_certificates_update ON public.subcontractor_certificates
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
-- Sin política INSERT para el rol autenticado normal: los certificados se
-- crean desde el portal público (service role, bypassa RLS) o desde una
-- server action interna que también usa el cliente autenticado del admin
-- (cubierto por administracion/admin abajo, para el caso de carga manual).
CREATE POLICY subcontractor_certificates_insert ON public.subcontractor_certificates
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
