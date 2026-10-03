-- Stock — Fase 2: valorización con costo promedio ponderado (CPP).
--
-- Cada producto lleva un costo_promedio en la moneda de la empresa, por unidad
-- de compra. Las ENTRADA lo recalculan ponderando con el precio de compra; las
-- SALIDA salen al CPP vigente (no lo mueven); los AJUSTE pueden revalorizar.
--
-- Regla única para el valor de un movimiento:
--   costo_total = (stock_nuevo * cpp_nuevo) - (stock_previo * cpp_previo)
-- es decir, cuánto cambió el valor del inventario. Sale + en ENTRADA,
-- - en SALIDA, y ± en AJUSTE.

alter table public.productos
  add column if not exists costo_promedio numeric(18,4) not null default 0;

alter table public.stock_movimientos
  add column if not exists costo_unitario            numeric(18,4),
  add column if not exists costo_total               numeric(18,2),
  add column if not exists costo_promedio_resultante numeric(18,4);

-- RPC: ahora acepta p_costo_unitario (precio de compra en ENTRADA, o costo de
-- revalorización en AJUSTE). Si no se pasa, el CPP no cambia.
--
-- Agregar un parámetro cambia la firma, así que CREATE OR REPLACE crearía una
-- sobrecarga en vez de reemplazar. Borramos la versión de 8 args primero.
drop function if exists public.registrar_stock_movimiento(
  uuid, uuid, text, numeric, text, uuid, text, uuid
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
  p_costo_unitario  numeric default null
) returns numeric
language plpgsql
security definer
as $$
declare
  v_stock_actual   numeric;
  v_costo_promedio numeric;
  v_stock_nuevo    numeric;
  v_costo_nuevo    numeric;
  v_costo_mov      numeric;   -- costo_unitario que se registra en el movimiento
  v_costo_total    numeric;
begin
  -- Lock de fila para evitar race conditions
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
      v_costo_nuevo := v_costo_promedio;              -- la salida no mueve el CPP
      v_costo_mov   := v_costo_promedio;

    when 'AJUSTE' then
      v_stock_nuevo := p_cantidad;                    -- absoluto
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
     referencia_tipo, referencia_id, notas, created_by)
  values
    (p_empresa_id, p_producto_id, p_tipo, p_cantidad, v_stock_nuevo,
     round(v_costo_mov, 4), round(v_costo_total, 2), round(v_costo_nuevo, 4),
     p_referencia_tipo, p_referencia_id, p_notas, p_created_by);

  return v_stock_nuevo;
end;
$$;
