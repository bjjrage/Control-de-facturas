-- Stock — Fase 3a: imputación del consumo a la obra.
--
-- Una SALIDA de material puede imputarse a un proyecto y, opcionalmente, a un
-- rubro del presupuesto. Así el costo del material consumido se puede comparar
-- contra lo presupuestado (conecta con el módulo Caterpillar).

alter table public.stock_movimientos
  add column if not exists project_id     uuid references public.projects(id)     on delete set null,
  add column if not exists budget_item_id uuid references public.budget_items(id) on delete set null;

create index if not exists idx_stock_mov_project     on public.stock_movimientos(project_id);
create index if not exists idx_stock_mov_budget_item on public.stock_movimientos(budget_item_id);

-- RPC: sumamos p_project_id / p_budget_item_id. La firma vuelve a cambiar, así
-- que dropeamos la versión de 9 args (creada en 0047) antes de recrear.
drop function if exists public.registrar_stock_movimiento(
  uuid, uuid, text, numeric, text, uuid, text, uuid, numeric
);

create or replace function public.registrar_stock_movimiento(
  p_empresa_id      uuid,
  p_producto_id     uuid,
  p_tipo            text,
  p_cantidad        numeric,
  p_referencia_tipo text    default null,
  p_referencia_id   uuid    default null,
  p_notas           text    default null,
  p_created_by      uuid    default null,
  p_costo_unitario  numeric default null,
  p_project_id      uuid    default null,
  p_budget_item_id  uuid    default null
) returns numeric
language plpgsql
security definer
as $$
declare
  v_stock_actual   numeric;
  v_costo_promedio numeric;
  v_stock_nuevo    numeric;
  v_costo_nuevo    numeric;
  v_costo_mov      numeric;
  v_costo_total    numeric;
begin
  select stock_actual, costo_promedio
    into v_stock_actual, v_costo_promedio
  from public.productos
  where id = p_producto_id and empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  case p_tipo
    when 'ENTRADA' then
      v_stock_nuevo := v_stock_actual + p_cantidad;
      if p_costo_unitario is not null and v_stock_nuevo > 0 then
        v_costo_nuevo := (v_stock_actual * v_costo_promedio + p_cantidad * p_costo_unitario) / v_stock_nuevo;
        v_costo_mov   := p_costo_unitario;
      else
        v_costo_nuevo := v_costo_promedio;
        v_costo_mov   := coalesce(p_costo_unitario, v_costo_promedio);
      end if;

    when 'SALIDA' then
      if v_stock_actual < p_cantidad then
        raise exception 'Stock insuficiente: disponible %, solicitado %', v_stock_actual, p_cantidad;
      end if;
      v_stock_nuevo := v_stock_actual - p_cantidad;
      v_costo_nuevo := v_costo_promedio;
      v_costo_mov   := v_costo_promedio;

    when 'AJUSTE' then
      v_stock_nuevo := p_cantidad;
      v_costo_nuevo := coalesce(p_costo_unitario, v_costo_promedio);
      v_costo_mov   := v_costo_nuevo;

    else
      raise exception 'Tipo de movimiento inválido: %', p_tipo;
  end case;

  v_costo_total := (v_stock_nuevo * v_costo_nuevo) - (v_stock_actual * v_costo_promedio);

  update public.productos
  set stock_actual   = v_stock_nuevo,
      costo_promedio = v_costo_nuevo,
      updated_at     = now()
  where id = p_producto_id;

  insert into public.stock_movimientos
    (empresa_id, producto_id, tipo, cantidad, stock_resultante,
     costo_unitario, costo_total, costo_promedio_resultante,
     referencia_tipo, referencia_id, notas, created_by,
     project_id, budget_item_id)
  values
    (p_empresa_id, p_producto_id, p_tipo, p_cantidad, v_stock_nuevo,
     round(v_costo_mov, 4), round(v_costo_total, 2), round(v_costo_nuevo, 4),
     p_referencia_tipo, p_referencia_id, p_notas, p_created_by,
     p_project_id, p_budget_item_id);

  return v_stock_nuevo;
end;
$$;

-- Vista de consumo de materiales por obra y rubro (solo SALIDA imputada).
create or replace view public.stock_consumo_obra as
select
  m.empresa_id,
  m.project_id,
  m.budget_item_id,
  m.producto_id,
  p.nombre                         as producto,
  p.unidad,
  sum(m.cantidad)                  as cantidad,
  sum(coalesce(-m.costo_total, 0)) as costo_total
from public.stock_movimientos m
join public.productos p on p.id = m.producto_id
where m.tipo = 'SALIDA' and m.project_id is not null
group by m.empresa_id, m.project_id, m.budget_item_id, m.producto_id, p.nombre, p.unidad;
