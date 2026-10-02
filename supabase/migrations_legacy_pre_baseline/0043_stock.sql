-- Módulo de Stock / Inventario (Plan PRO)

create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  nombre       text not null,
  descripcion  text,
  unidad       text not null default 'unidad',
  sku          text,
  stock_actual numeric(18,4) not null default 0,
  stock_minimo numeric(18,4) not null default 0,
  activo       boolean not null default true,
  created_by   uuid references auth.users(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (empresa_id, sku)
);

create index idx_productos_empresa on public.productos(empresa_id);
create index idx_productos_activo  on public.productos(empresa_id, activo);

-- tipo: ENTRADA (llega mercadería), SALIDA (se consume/vende), AJUSTE (corrección, cantidad = nuevo total absoluto)
create table if not exists public.stock_movimientos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  producto_id      uuid not null references public.productos(id) on delete cascade,
  tipo             text not null check (tipo in ('ENTRADA','SALIDA','AJUSTE')),
  cantidad         numeric(18,4) not null,
  stock_resultante numeric(18,4) not null,
  referencia_tipo  text,
  referencia_id    uuid,
  notas            text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz default now()
);

create index idx_stock_mov_producto on public.stock_movimientos(producto_id);
create index idx_stock_mov_empresa  on public.stock_movimientos(empresa_id);
create index idx_stock_mov_ref      on public.stock_movimientos(referencia_tipo, referencia_id);

-- RPC atómica: actualiza stock_actual con lock de fila y registra el movimiento.
-- Salidas con stock insuficiente lanzan excepción para que el caller la capture.
create or replace function public.registrar_stock_movimiento(
  p_empresa_id     uuid,
  p_producto_id    uuid,
  p_tipo           text,
  p_cantidad       numeric,
  p_referencia_tipo text default null,
  p_referencia_id  uuid  default null,
  p_notas          text  default null,
  p_created_by     uuid  default null
) returns numeric
language plpgsql
security definer
as $$
declare
  v_stock_actual   numeric;
  v_stock_nuevo    numeric;
begin
  -- Lock de fila para evitar race conditions
  select stock_actual into v_stock_actual
  from public.productos
  where id = p_producto_id and empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  case p_tipo
    when 'ENTRADA' then
      v_stock_nuevo := v_stock_actual + p_cantidad;
    when 'SALIDA' then
      if v_stock_actual < p_cantidad then
        raise exception 'Stock insuficiente: disponible %, solicitado %', v_stock_actual, p_cantidad;
      end if;
      v_stock_nuevo := v_stock_actual - p_cantidad;
    when 'AJUSTE' then
      v_stock_nuevo := p_cantidad; -- absoluto
    else
      raise exception 'Tipo de movimiento inválido: %', p_tipo;
  end case;

  update public.productos
  set stock_actual = v_stock_nuevo, updated_at = now()
  where id = p_producto_id;

  insert into public.stock_movimientos
    (empresa_id, producto_id, tipo, cantidad, stock_resultante, referencia_tipo, referencia_id, notas, created_by)
  values
    (p_empresa_id, p_producto_id, p_tipo, p_cantidad, v_stock_nuevo, p_referencia_tipo, p_referencia_id, p_notas, p_created_by);

  return v_stock_nuevo;
end;
$$;

-- RLS
alter table public.productos         enable row level security;
alter table public.stock_movimientos enable row level security;

create policy "select productos"
  on public.productos for select
  using (empresa_id = public.current_empresa_id());

create policy "insert productos"
  on public.productos for insert
  with check (empresa_id = public.current_empresa_id());

create policy "update productos"
  on public.productos for update
  using (empresa_id = public.current_empresa_id());

create policy "select stock_movimientos"
  on public.stock_movimientos for select
  using (empresa_id = public.current_empresa_id());

create policy "insert stock_movimientos"
  on public.stock_movimientos for insert
  with check (empresa_id = public.current_empresa_id());
