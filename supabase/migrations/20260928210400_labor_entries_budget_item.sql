-- Costeo, fase 6: los partes diarios de personal se imputan a una partida y
-- a una categoría de jornal, para comparar el costo real de mano de obra
-- contra el presupuestado por partida. Ambas columnas nullable: los partes
-- viejos quedan sin imputar.

ALTER TABLE public.daily_labor_entries
  ADD COLUMN IF NOT EXISTS budget_item_id UUID REFERENCES public.budget_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labor_rate_id UUID REFERENCES public.labor_rates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_labor_entries_budget_item
  ON public.daily_labor_entries(project_id, budget_item_id);
