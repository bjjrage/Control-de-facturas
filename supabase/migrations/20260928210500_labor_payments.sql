-- Costeo: pagos de mano de obra por período (planilla semanal/quincenal/mensual
-- de una cuadrilla) y destajos por partida. Es como se controla la mano de
-- obra propia en obra: se paga a la cuadrilla por período y se compara contra
-- la mano de obra estimada en los APU, a nivel de obra. Un destajo (precio por
-- unidad de trabajo) sí se imputa a su partida.

CREATE TABLE IF NOT EXISTS public.labor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  crew_name TEXT NOT NULL CHECK (length(btrim(crew_name)) > 0),
  modalidad TEXT NOT NULL CHECK (modalidad IN ('SEMANAL', 'QUINCENAL', 'MENSUAL', 'DESTAJO')),
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  budget_item_id UUID REFERENCES public.budget_items(id) ON DELETE SET NULL,
  quantity NUMERIC(18,4) CHECK (quantity IS NULL OR quantity > 0),
  unit_price NUMERIC(18,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from),
  CHECK (modalidad <> 'DESTAJO' OR (budget_item_id IS NOT NULL AND quantity IS NOT NULL AND unit_price IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_labor_payments_project ON public.labor_payments(project_id, period_from);
CREATE INDEX IF NOT EXISTS idx_labor_payments_budget_item ON public.labor_payments(budget_item_id);

ALTER TABLE public.labor_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "labor_payments_empresa_isolation" ON public.labor_payments
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.labor_payments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_payments TO authenticated;
