-- =============================================================================
-- 0028_construccion_pro.sql
--
-- Módulo Construcción — Fase 1 (Pro). Gestión de proyectos de obra: cómputo
-- métrico, registro de ejecución en campo, cronograma derivado, compras
-- vinculadas a proyecto.
--
-- DECISIONES DE DISEÑO:
--   1. empresas.plan (enum jerárquico) convive con modulo_compras/modulo_ventas
--      (booleans). No son el mismo eje: los módulos son features on/off
--      independientes, plan es un nivel dentro del módulo construcción.
--   2. RLS usa current_empresa_id() (helper SECURITY DEFINER existente desde
--      0011), NO el patrón inline (SELECT empresa_id FROM profiles WHERE...)
--      que usa payment_orders (0025) — ese patrón además NO filtra por
--      empresa_id ahí, es un leak real pendiente de corregir aparte.
--   3. El progreso de ejecución NUNCA se guarda como campo editable — se
--      deriva en la capa de aplicación desde SUM(execution_entries.quantity_executed)
--      por budget_item. No hay columna "progress" en budget_items a propósito.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Switch de plan por empresa
-- ---------------------------------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'basico'
  CHECK (plan IN ('basico', 'pro', 'caterpillar'));

-- ---------------------------------------------------------------------------
-- 2. Proyectos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  name         text NOT NULL,
  code         text NOT NULL,
  client       text,
  location     text,
  start_date   date,
  end_date     date,
  status       text NOT NULL DEFAULT 'ACTIVO'
               CHECK (status IN ('ACTIVO', 'PAUSADO', 'COMPLETADO', 'CANCELADO')),
  budget_total numeric(18,2) NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, code)
);

-- ---------------------------------------------------------------------------
-- 3. Cómputo métrico (jerárquico: rubros con sub-ítems via parent_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.budget_items(id) ON DELETE CASCADE,
  code        text NOT NULL,
  description text NOT NULL,
  unit        text,
  quantity    numeric(18,4),
  unit_price  numeric(18,2),
  subtotal    numeric(18,2) GENERATED ALWAYS AS
              (ROUND(COALESCE(quantity, 0) * COALESCE(unit_price, 0), 2)) STORED,
  sort_order  integer NOT NULL DEFAULT 0,
  -- Cronograma (Gantt). Si están vacías, el ítem no aparece en el Gantt.
  start_date  date,
  end_date    date,
  depends_on  text,  -- ids de otros budget_items separados por coma
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Ejecución en campo — única fuente de verdad del avance real
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.execution_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_item_id    uuid NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  entry_date        date NOT NULL,
  quantity_executed numeric(18,4) NOT NULL CHECK (quantity_executed > 0),
  notes             text,
  recorded_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. Vincular OCs a proyectos (columna nueva en tabla existente)
-- ---------------------------------------------------------------------------
ALTER TABLE public.authorized_orders
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 6. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_empresa       ON public.projects(empresa_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_project   ON public.budget_items(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_parent    ON public.budget_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_exec_entries_project   ON public.execution_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_exec_entries_item      ON public.execution_entries(budget_item_id);
CREATE INDEX IF NOT EXISTS idx_orders_project         ON public.authorized_orders(project_id);

-- ---------------------------------------------------------------------------
-- 7. empresa_id automático (mismo patrón que el resto del sistema, 0011)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_projects_empresa BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_empresa_id_from_caller();

-- ---------------------------------------------------------------------------
-- 8. RLS — scoped por empresa_id via current_empresa_id(), rol administracion/admin
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_entries ENABLE ROW LEVEL SECURITY;

-- projects
CREATE POLICY projects_select ON public.projects
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY projects_insert ON public.projects
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY projects_update ON public.projects
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY projects_delete ON public.projects
  FOR DELETE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

-- budget_items (scoped via project_id -> projects.empresa_id)
CREATE POLICY budget_items_select ON public.budget_items
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY budget_items_insert ON public.budget_items
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY budget_items_update ON public.budget_items
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY budget_items_delete ON public.budget_items
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

-- execution_entries (scoped via project_id -> projects.empresa_id)
CREATE POLICY exec_entries_select ON public.execution_entries
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY exec_entries_insert ON public.execution_entries
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY exec_entries_update ON public.execution_entries
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY exec_entries_delete ON public.execution_entries
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));
