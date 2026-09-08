-- Stock — Fase 4: depósitos / ubicaciones.
--
-- Hasta ahora productos.stock_actual era un único número global. En una
-- constructora el material vive en el depósito central y en el pañol de cada
-- obra. Esta migración agrega el desglose por depósito SIN romper nada:
--   - productos.stock_actual sigue siendo el total global (suma de depósitos)
--   - costo_promedio sigue siendo global (un costo por producto en la empresa)
--   - stock_por_deposito lleva la cantidad en cada ubicación
--   - la RPC mantiene ambos en sincronía
--
-- El stock existente se asigna a un "Depósito central" creado por empresa.

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.depositos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  nombre       text not null,
  es_principal boolean not null default false,
  -- Si el depósito es el pañol de una obra puntual
  project_id   uuid references public.projects(id) on delete set null,
  activo       boolean not null default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (empresa_id, nombre)
);

create index if not exists idx_depositos_empresa on public.depositos(empresa_id, activo);

create table if not exists public.stock_por_deposito (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  producto_id  uuid not null references public.productos(id) on delete cascade,
  deposito_id  uuid not null references public.depositos(id) on delete cascade,
  stock_actual numeric(18,4) not null default 0,
  updated_at   timestamptz default now(),
  unique (producto_id, deposito_id)
);

create index if not exists idx_stock_por_deposito_prod on public.stock_por_deposito(producto_id);
create index if not exists idx_stock_por_deposito_dep  on public.stock_por_deposito(deposito_id);

-- Movimientos: en qué depósito ocurre (y el destino, si es TRANSFERENCIA)
alter table public.stock_movimientos
  add column if not exists deposito_id         uuid references public.depositos(id) on delete set null,
  add column if not exists deposito_destino_id uuid references public.depositos(id) on delete set null;

create index if not exists idx_stock_mov_deposito on public.stock_movimientos(deposito_id);

-- Nuevo tipo de movimiento: TRANSFERENCIA (entre depósitos, no toca el total global)
alter table public.stock_movimientos drop constraint if exists stock_movimientos_tipo_check;
alter table public.stock_movimientos
  add constraint stock_movimientos_tipo_check
  check (tipo in ('ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA'));

-- ---------------------------------------------------------------------------
-- 2. Backfill: un depósito central por empresa + el stock existente adentro
-- ---------------------------------------------------------------------------
insert into public.depositos (empresa_id, nombre, es_principal)
select distinct empresa_id, 'Depósito central', true
from public.productos
on conflict (empresa_id, nombre) do nothing;

insert into public.stock_por_deposito (empresa_id, producto_id, deposito_id, stock_actual)
select p.empresa_id, p.id, d.id, p.stock_actual
from public.productos p
join public.depositos d on d.empresa_id = p.empresa_id and d.es_principal
where p.stock_actual <> 0
on conflict (producto_id, deposito_id) do nothing;

-- Movimientos históricos: quedan en el depósito principal de su empresa
update public.stock_movimientos m
set deposito_id = d.id
from public.depositos d
where d.empresa_id = m.empresa_id and d.es_principal and m.deposito_id is null;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.depositos          enable row level security;
alter table public.stock_por_deposito enable row level security;

create policy "select depositos" on public.depositos for select
  using (empresa_id = public.current_empresa_id());
create policy "insert depositos" on public.depositos for insert
  with check (empresa_id = public.current_empresa_id());
create policy "update depositos" on public.depositos for update
  using (empresa_id = public.current_empresa_id());
create policy "delete depositos" on public.depositos for delete
  using (empresa_id = public.current_empresa_id());

create policy "select stock_por_deposito" on public.stock_por_deposito for select
  using (empresa_id = public.current_empresa_id());
-- escritura solo vía RPC (security definer); sin políticas de insert/update directas

-- ---------------------------------------------------------------------------
-- 4. RPC con soporte de depósito. La firma vuelve a cambiar: dropeamos la de
--    11 args (creada en 0048) antes de recrear.
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_stock_movimiento(
  uuid, uuid, text, numeric, text, uuid, text, uuid, numeric, uuid, uuid
);

create or replace function public.registrar_stock_movimiento(
  p_empresa_id          uuid,
  p_producto_id         uuid,
  p_tipo                text,
  p_cantidad            numeric,
  p_referencia_tipo     text    default null,
  p_referencia_id       uuid    default null,
  p_notas               text    default null,
  p_created_by          uuid    default null,
  p_costo_unitario      numeric default null,
  p_project_id          uuid    default null,
  p_budget_item_id      uuid    default null,
  p_deposito_id         uuid    default null,
  p_deposito_destino_id uuid    default null
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
  v_deposito_id    uuid;
  v_dep_actual     numeric;
  v_dep_nuevo      numeric;
  v_dep_dest_actual numeric;
begin
  select stock_actual, costo_promedio
    into v_stock_actual, v_costo_promedio
  from public.productos
  where id = p_producto_id and empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  -- Depósito: el indicado, o el principal de la empresa
  v_deposito_id := p_deposito_id;
  if v_deposito_id is null then
    select id into v_deposito_id
    from public.depositos
    where empresa_id = p_empresa_id and es_principal
    limit 1;
  end if;

  -- Saldo actual del producto en ese depósito (con lock)
  select stock_actual into v_dep_actual
  from public.stock_por_deposito
  where producto_id = p_producto_id and deposito_id = v_deposito_id
  for update;
  v_dep_actual := coalesce(v_dep_actual, 0);

  if p_tipo = 'TRANSFERENCIA' then
    if p_deposito_destino_id is null then
      raise exception 'La transferencia necesita un depósito destino';
    end if;
    if v_dep_actual < p_cantidad then
      raise exception 'Stock insuficiente en el depósito origen: disponible %, solicitado %', v_dep_actual, p_cantidad;
    end if;

    update public.stock_por_deposito
    set stock_actual = stock_actual - p_cantidad, updated_at = now()
    where producto_id = p_producto_id and deposito_id = v_deposito_id;

    select stock_actual into v_dep_dest_actual
    from public.stock_por_deposito
    where producto_id = p_producto_id and deposito_id = p_deposito_destino_id
    for update;

    if found then
      update public.stock_por_deposito
      set stock_actual = stock_actual + p_cantidad, updated_at = now()
      where producto_id = p_producto_id and deposito_id = p_deposito_destino_id;
    else
      insert into public.stock_por_deposito (empresa_id, producto_id, deposito_id, stock_actual)
      values (p_empresa_id, p_producto_id, p_deposito_destino_id, p_cantidad);
    end if;

    -- El total global y el CPP no cambian en una transferencia
    v_stock_nuevo := v_stock_actual;
    v_costo_nuevo := v_costo_promedio;
    v_costo_mov   := v_costo_promedio;
    v_costo_total := 0;
    v_dep_nuevo   := v_dep_actual - p_cantidad;

    insert into public.stock_movimientos
      (empresa_id, producto_id, tipo, cantidad, stock_resultante,
       costo_unitario, costo_total, costo_promedio_resultante,
       referencia_tipo, referencia_id, notas, created_by,
       project_id, budget_item_id, deposito_id, deposito_destino_id)
    values
      (p_empresa_id, p_producto_id, 'TRANSFERENCIA', p_cantidad, v_dep_nuevo,
       round(v_costo_mov, 4), 0, round(v_costo_nuevo, 4),
       p_referencia_tipo, p_referencia_id, p_notas, p_created_by,
       p_project_id, p_budget_item_id, v_deposito_id, p_deposito_destino_id);

    return v_stock_actual;
  end if;

  -- ENTRADA / SALIDA / AJUSTE
  case p_tipo
    when 'ENTRADA' then
      v_stock_nuevo := v_stock_actual + p_cantidad;
      v_dep_nuevo   := v_dep_actual + p_cantidad;
      if p_costo_unitario is not null and v_stock_nuevo > 0 then
        v_costo_nuevo := (v_stock_actual * v_costo_promedio + p_cantidad * p_costo_unitario) / v_stock_nuevo;
        v_costo_mov   := p_costo_unitario;
      else
        v_costo_nuevo := v_costo_promedio;
        v_costo_mov   := coalesce(p_costo_unitario, v_costo_promedio);
      end if;

    when 'SALIDA' then
      if v_dep_actual < p_cantidad then
        raise exception 'Stock insuficiente en el depósito: disponible %, solicitado %', v_dep_actual, p_cantidad;
      end if;
      v_stock_nuevo := v_stock_actual - p_cantidad;
      v_dep_nuevo   := v_dep_actual - p_cantidad;
      v_costo_nuevo := v_costo_promedio;
      v_costo_mov   := v_costo_promedio;

    when 'AJUSTE' then
      -- p_cantidad = nuevo total ABSOLUTO en ese depósito
      v_dep_nuevo   := p_cantidad;
      v_stock_nuevo := v_stock_actual + (v_dep_nuevo - v_dep_actual);
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

  -- Upsert del saldo por depósito
  if v_dep_actual = 0 and not exists (
    select 1 from public.stock_por_deposito
    where producto_id = p_producto_id and deposito_id = v_deposito_id
  ) then
    insert into public.stock_por_deposito (empresa_id, producto_id, deposito_id, stock_actual)
    values (p_empresa_id, p_producto_id, v_deposito_id, v_dep_nuevo);
  else
    update public.stock_por_deposito
    set stock_actual = v_dep_nuevo, updated_at = now()
    where producto_id = p_producto_id and deposito_id = v_deposito_id;
  end if;

  insert into public.stock_movimientos
    (empresa_id, producto_id, tipo, cantidad, stock_resultante,
     costo_unitario, costo_total, costo_promedio_resultante,
     referencia_tipo, referencia_id, notas, created_by,
     project_id, budget_item_id, deposito_id)
  values
    (p_empresa_id, p_producto_id, p_tipo, p_cantidad, v_dep_nuevo,
     round(v_costo_mov, 4), round(v_costo_total, 2), round(v_costo_nuevo, 4),
     p_referencia_tipo, p_referencia_id, p_notas, p_created_by,
     p_project_id, p_budget_item_id, v_deposito_id);

  return v_stock_nuevo;
end;
$$;
