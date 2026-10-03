-- APU por partida — capas de mano de obra y equipo. Análogas a
-- budget_item_materials pero sin FK a productos: no hay catálogo con costo,
-- así que el costo se carga en la fila (costo_hora).
-- Aplicada en producción el 2026-09-28 vía MCP; archivo agregado después
-- para reconciliar repo ↔ producción (mismo SQL, misma versión).

CREATE TABLE IF NOT EXISTS public.budget_item_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  rol TEXT NOT NULL,
  horas_por_unidad_ejecutada NUMERIC(14,4) NOT NULL CHECK (horas_por_unidad_ejecutada > 0),
  costo_hora NUMERIC(14,2) NOT NULL CHECK (costo_hora >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_item_id, rol)
);

CREATE INDEX IF NOT EXISTS idx_budget_item_labor_lookup
  ON public.budget_item_labor(project_id, budget_item_id);

ALTER TABLE public.budget_item_labor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_item_labor_empresa_isolation"
  ON public.budget_item_labor
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());

REVOKE ALL ON public.budget_item_labor FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_item_labor TO authenticated;

CREATE TABLE IF NOT EXISTS public.budget_item_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  tipo_equipo TEXT NOT NULL,
  horas_por_unidad_ejecutada NUMERIC(14,4) NOT NULL CHECK (horas_por_unidad_ejecutada > 0),
  costo_hora NUMERIC(14,2) NOT NULL CHECK (costo_hora >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_item_id, tipo_equipo)
);

CREATE INDEX IF NOT EXISTS idx_budget_item_equipment_lookup
  ON public.budget_item_equipment(project_id, budget_item_id);

ALTER TABLE public.budget_item_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_item_equipment_empresa_isolation"
  ON public.budget_item_equipment
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());

REVOKE ALL ON public.budget_item_equipment FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budget_item_equipment TO authenticated;
