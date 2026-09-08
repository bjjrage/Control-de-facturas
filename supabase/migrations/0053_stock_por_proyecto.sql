-- Stock por proyecto: vista que agrega ENTRADA y SALIDA de movimientos
-- imputados a un proyecto específico.
--
-- Permite ver, por cada obra:
--   - cuánto material se compró (ENTRADA con project_id)
--   - cuánto se consumió (SALIDA con project_id)
--   - el saldo disponible para esa obra (comprado - consumido)
--
-- El stock global (productos.stock_actual) NO cambia — sigue siendo uno solo.
-- Esta vista es una "lente contable" sobre los movimientos etiquetados.

-- Garantía: la columna debe existir aunque 0048 haya fallado parcialmente
alter table public.stock_movimientos
  add column if not exists project_id uuid references public.projects(id) on delete set null;

drop view if exists public.stock_por_proyecto;
create view public.stock_por_proyecto as
select
  m.empresa_id,
  m.project_id,
  m.producto_id,
  p.nombre                                                                   as producto,
  p.unidad,
  p.costo_promedio,
  sum(case when m.tipo = 'ENTRADA' then m.cantidad      else 0 end)          as qty_comprada,
  sum(case when m.tipo = 'SALIDA'  then m.cantidad      else 0 end)          as qty_consumida,
  sum(case when m.tipo = 'ENTRADA' then  m.cantidad
           when m.tipo = 'SALIDA'  then -m.cantidad
           else 0 end)                                                        as qty_disponible,
  sum(case when m.tipo = 'ENTRADA' then coalesce( m.costo_total, 0) else 0 end) as costo_comprado,
  sum(case when m.tipo = 'SALIDA'  then coalesce(-m.costo_total, 0) else 0 end) as costo_consumido
from public.stock_movimientos m
join public.productos p on p.id = m.producto_id
where m.project_id is not null
  and m.tipo in ('ENTRADA', 'SALIDA')
group by
  m.empresa_id, m.project_id, m.producto_id,
  p.nombre, p.unidad, p.costo_promedio;
