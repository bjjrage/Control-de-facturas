-- Costeo, fase 1: tabla central de jornales + 4ª pata del APU (subcontrato).
--
-- labor_rates: costo hora por categoría (oficial, ayudante…) con cargas
-- sociales. Las líneas de mano de obra del APU pueden enlazarse a una
-- categoría (labor_rate_id): si está enlazada, manda el costo de la
-- categoría; si no, el costo_hora escrito en la fila (compatibilidad).
--
-- budget_item_subcontracts / apu_template_subcontracts: precio por unidad
-- de partida para la parte subcontratada (conviven con la mano de obra
-- propia en la misma partida).

CREATE TABLE IF NOT EXISTS public.labor_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  costo_hora_base NUMERIC(14,2) NOT NULL CHECK (costo_hora_base >= 0),
  cargas_sociales_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (cargas_sociales_pct >= 0 AND cargas_sociales_pct <= 200),
  costo_hora NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(costo_hora_base * (1 + cargas_sociales_pct / 100), 2)) STORED,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, categoria)
);
ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "labor_rates_empresa_isolation" ON public.labor_rates
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.labor_rates FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_rates TO authenticated;

ALTER TABLE public.budget_item_labor
  ADD COLUMN IF NOT EXISTS labor_rate_id UUID REFERENCES public.labor_rates(id) ON DELETE SET NULL;
ALTER TABLE public.apu_template_labor
  ADD COLUMN IF NOT EXISTS labor_rate_id UUID REFERENCES public.labor_rates(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.budget_item_subcontracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  precio_por_unidad NUMERIC(18,2) NOT NULL CHECK (precio_por_unidad >= 0),
  subcontractor_id UUID REFERENCES public.subcontractors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_item_id, descripcion)
);
CREATE INDEX IF NOT EXISTS idx_budget_item_subcontracts_lookup
  ON public.budget_item_subcontracts(project_id, budget_item_id);
ALTER TABLE public.budget_item_subcontracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_item_subcontracts_empresa_isolation" ON public.budget_item_subcontracts
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.budget_item_subcontracts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_item_subcontracts TO authenticated;

CREATE TABLE IF NOT EXISTS public.apu_template_subcontracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.apu_templates(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  precio_por_unidad NUMERIC(18,2) NOT NULL CHECK (precio_por_unidad >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, descripcion)
);
CREATE INDEX IF NOT EXISTS idx_apu_template_subcontracts_lookup ON public.apu_template_subcontracts(template_id);
ALTER TABLE public.apu_template_subcontracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apu_template_subcontracts_empresa_isolation" ON public.apu_template_subcontracts
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.apu_template_subcontracts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apu_template_subcontracts TO authenticated;
