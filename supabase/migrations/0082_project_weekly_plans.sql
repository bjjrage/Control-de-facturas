-- ============================================================================
-- 0082_project_weekly_plans.sql
-- Plan Semanal de Obra / Lookahead Operacional
-- Permite definir metas de avance físico por partida (cantidad o puntos porcentuales)
-- y explota la demanda determinística de materiales, deduciendo stock disponible
-- en obra y órdenes de compra en tránsito para calcular caja requerida.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_weekly_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMMITTED', 'CLOSED')),
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_weekly_plan_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_proj_dates
  ON public.project_weekly_plans(project_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_empresa
  ON public.project_weekly_plans(empresa_id);

-- RLS en project_weekly_plans
ALTER TABLE public.project_weekly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_weekly_plans_empresa_isolation"
  ON public.project_weekly_plans
  FOR ALL
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());

CREATE TABLE IF NOT EXISTS public.project_weekly_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.project_weekly_plans(id) ON DELETE CASCADE,
    budget_item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
    front_label TEXT,
    input_mode TEXT NOT NULL CHECK (input_mode IN ('QUANTITY', 'CONTRACT_PERCENTAGE_POINTS')),
    input_value NUMERIC(14, 4) NOT NULL CHECK (input_value >= 0),
    target_quantity NUMERIC(14, 4) NOT NULL CHECK (target_quantity >= 0),
    unit TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, budget_item_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_plan_items_plan
  ON public.project_weekly_plan_items(plan_id);

CREATE INDEX IF NOT EXISTS idx_weekly_plan_items_budget_item
  ON public.project_weekly_plan_items(budget_item_id);

-- RLS en project_weekly_plan_items con herencia de empresa_id a través del plan
ALTER TABLE public.project_weekly_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_weekly_plan_items_empresa_isolation"
  ON public.project_weekly_plan_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.project_weekly_plans p
      WHERE p.id = project_weekly_plan_items.plan_id
        AND p.empresa_id = public.current_empresa_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_weekly_plans p
      WHERE p.id = project_weekly_plan_items.plan_id
        AND p.empresa_id = public.current_empresa_id()
    )
  );
