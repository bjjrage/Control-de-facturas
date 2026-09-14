-- ============================================================================
-- 0081_stock_por_proyecto_security_invoker.sql
-- Hardening: Aplicar security_invoker = true a la vista stock_por_proyecto
--            para asegurar que respete las políticas RLS del invocador y
--            eliminar la alerta de security_definer_view en Security Advisor.
-- ============================================================================

CREATE OR REPLACE VIEW public.stock_por_proyecto
WITH (security_invoker = true) AS
SELECT
  m.empresa_id,
  m.project_id,
  m.producto_id,
  p.nombre                                                                   AS producto,
  p.unidad,
  p.costo_promedio,
  sum(CASE WHEN m.tipo = 'ENTRADA' THEN m.cantidad      ELSE 0 END)          AS qty_comprada,
  sum(CASE WHEN m.tipo = 'SALIDA'  THEN m.cantidad      ELSE 0 END)          AS qty_consumida,
  sum(CASE WHEN m.tipo = 'ENTRADA' THEN  m.cantidad
           WHEN m.tipo = 'SALIDA'  THEN -m.cantidad
           ELSE 0 END)                                                        AS qty_disponible,
  sum(CASE WHEN m.tipo = 'ENTRADA' THEN coalesce( m.costo_total, 0) ELSE 0 END) AS costo_comprado,
  sum(CASE WHEN m.tipo = 'SALIDA'  THEN coalesce(-m.costo_total, 0) ELSE 0 END) AS costo_consumido
FROM public.stock_movimientos m
JOIN public.productos p ON p.id = m.producto_id
WHERE m.project_id IS NOT NULL
  AND m.tipo IN ('ENTRADA', 'SALIDA')
GROUP BY
  m.empresa_id, m.project_id, m.producto_id,
  p.nombre, p.unidad, p.costo_promedio;
