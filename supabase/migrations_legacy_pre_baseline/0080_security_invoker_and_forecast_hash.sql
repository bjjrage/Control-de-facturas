-- ============================================================================
-- 0080_security_invoker_and_forecast_hash.sql
-- Hardening: Multi-tenancy security_invoker en oc_order_item_recibido +
--            Hash determinista de insumos operacionales en corridas de forecast
-- ============================================================================

-- 1. Agregar operational_input_hash en project_progress_forecast_runs
ALTER TABLE project_progress_forecast_runs
  ADD COLUMN IF NOT EXISTS operational_input_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_progress_forecast_runs_hash
  ON project_progress_forecast_runs(project_id, operational_input_hash);

-- 2. Asegurar vista oc_order_item_recibido con security_invoker = true
-- Esto garantiza que las políticas RLS de oc_recepcion_items se evalúen con
-- los permisos del usuario/tenant invocador (PostgreSQL 15+)
CREATE OR REPLACE VIEW public.oc_order_item_recibido
WITH (security_invoker = true) AS
SELECT
    ri.order_item_id,
    ri.empresa_id,
    sum(ri.cantidad_recibida) AS cantidad_recibida_total
FROM public.oc_recepcion_items ri
GROUP BY ri.order_item_id, ri.empresa_id;
