-- Permite registrar cuántas unidades base contiene cada unidad de stock.
-- Ejemplo: unidad="bolsa", contenido_por_unidad=25, unidad_base="kg"
-- → stock_actual (bolsas) × contenido_por_unidad = total en kg

alter table public.productos
  add column if not exists contenido_por_unidad numeric(18,4),
  add column if not exists unidad_base text;
