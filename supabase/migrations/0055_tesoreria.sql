-- Tesorería — Parte A del plan: que el dinero viva en algún lado.
--
-- Hasta ahora el sistema registraba que una factura se pagó (payment_orders) o
-- que un cliente pagó (sales_receipts), pero no de qué cuenta salió ni cuánta
-- plata quedó. Esta migración agrega:
--   - cuentas_financieras: bancos, cajas y tarjetas, cada una con su saldo
--   - movimientos_tesoreria: libro mayor APPEND-ONLY (nunca se hace UPDATE de un
--     movimiento; si hay error se inserta el contra-movimiento)
--   - transferencias: par de movimientos entre cuentas, con tipo de cambio
--
-- El saldo de cada cuenta es materializado y lo mantiene un trigger sobre
-- movimientos_tesoreria — mismo patrón que productos.stock_actual.
-- Invariante: cuentas_financieras.saldo = SUM(movimientos_tesoreria.monto).
--
-- La escritura del libro va SOLO por las RPC security definer (registrar_movimiento_
-- tesoreria / registrar_transferencia), que toman lock de la cuenta antes de
-- validar saldo e insertar.

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.cuentas_financieras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  nombre        text not null,
  tipo          text not null default 'BANCO'
                check (tipo in ('BANCO', 'CAJA', 'TARJETA', 'OTRO')),
  banco         text,
  numero_cuenta text,
  moneda        public.currency_code not null default 'PYG',
  -- Materializado por trigger. No editar a mano.
  saldo         numeric(18,2) not null default 0,
  -- Último saldo confirmado contra extracto bancario (lo llena la conciliación, Parte A6).
  saldo_conciliado numeric(18,2),
  activo        boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create index if not exists idx_cuentas_fin_empresa on public.cuentas_financieras(empresa_id, activo);

-- Libro mayor. monto: POSITIVO entra, NEGATIVO sale.
create table if not exists public.movimientos_tesoreria (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  cuenta_id    uuid not null references public.cuentas_financieras(id) on delete cascade,
  fecha        date not null default current_date,
  monto        numeric(18,2) not null check (monto <> 0),
  tipo         text not null
               check (tipo in ('COBRO', 'PAGO', 'TRANSFERENCIA_IN', 'TRANSFERENCIA_OUT',
                               'INGRESO', 'EGRESO', 'AJUSTE', 'SALDO_INICIAL')),
  -- Obligatorio para los movimientos manuales (INGRESO / EGRESO / AJUSTE / SALDO_INICIAL).
  motivo       text,
  -- Vínculo al documento de origen. A lo sumo uno.
  payment_order_id uuid references public.payment_orders(id) on delete set null,
  sales_receipt_id uuid references public.sales_receipts(id) on delete set null,
  transferencia_id uuid,  -- FK agregada abajo (la tabla se crea después)
  -- Imputación a obra. Habilita el flujo de caja por proyecto (Parte B4).
  project_id   uuid references public.projects(id) on delete set null,
  -- Conciliación bancaria (Parte A6).
  conciliado   boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint movimientos_tesoreria_motivo_manual check (
    tipo not in ('INGRESO', 'EGRESO', 'AJUSTE', 'SALDO_INICIAL')
    or (motivo is not null and length(trim(motivo)) > 0)
  )
);

create index if not exists idx_mov_tes_empresa  on public.movimientos_tesoreria(empresa_id, fecha desc);
create index if not exists idx_mov_tes_cuenta   on public.movimientos_tesoreria(cuenta_id, fecha desc);
create index if not exists idx_mov_tes_project  on public.movimientos_tesoreria(project_id) where project_id is not null;
create index if not exists idx_mov_tes_po       on public.movimientos_tesoreria(payment_order_id) where payment_order_id is not null;
create index if not exists idx_mov_tes_receipt  on public.movimientos_tesoreria(sales_receipt_id) where sales_receipt_id is not null;
create index if not exists idx_mov_tes_no_conc  on public.movimientos_tesoreria(cuenta_id) where not conciliado;

create table if not exists public.transferencias (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  cuenta_origen_id  uuid not null references public.cuentas_financieras(id) on delete cascade,
  cuenta_destino_id uuid not null references public.cuentas_financieras(id) on delete cascade,
  monto_origen    numeric(18,2) not null check (monto_origen > 0),
  monto_destino   numeric(18,2) not null check (monto_destino > 0),
  -- monto_destino / monto_origen cuando difieren las monedas; 1 si es la misma.
  tipo_cambio     numeric(18,6) not null default 1,
  fecha           date not null default current_date,
  motivo          text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (cuenta_origen_id <> cuenta_destino_id)
);

create index if not exists idx_transferencias_empresa on public.transferencias(empresa_id, fecha desc);

alter table public.movimientos_tesoreria
  add constraint movimientos_tesoreria_transferencia_fk
  foreign key (transferencia_id) references public.transferencias(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Trigger de saldo — la única cosa que toca cuentas_financieras.saldo
-- ---------------------------------------------------------------------------
create or replace function public.fn_mov_tesoreria_saldo()
returns trigger
language plpgsql
as $$
begin
  update public.cuentas_financieras
  set saldo = saldo + new.monto,
      updated_at = now()
  where id = new.cuenta_id;
  return new;
end;
$$;

drop trigger if exists trg_mov_tesoreria_saldo on public.movimientos_tesoreria;
create trigger trg_mov_tesoreria_saldo
  after insert on public.movimientos_tesoreria
  for each row execute function public.fn_mov_tesoreria_saldo();

-- ---------------------------------------------------------------------------
-- 3. RLS — lectura por empresa; escritura del libro SOLO por RPC
-- ---------------------------------------------------------------------------
alter table public.cuentas_financieras  enable row level security;
alter table public.movimientos_tesoreria enable row level security;
alter table public.transferencias       enable row level security;

-- cuentas_financieras: master, CRUD normal (el saldo lo protege el flujo, no la RLS)
create policy "select cuentas_fin" on public.cuentas_financieras for select
  using (empresa_id = public.current_empresa_id());
create policy "insert cuentas_fin" on public.cuentas_financieras for insert
  with check (empresa_id = public.current_empresa_id());
create policy "update cuentas_fin" on public.cuentas_financieras for update
  using (empresa_id = public.current_empresa_id());
create policy "delete cuentas_fin" on public.cuentas_financieras for delete
  using (empresa_id = public.current_empresa_id());

-- movimientos_tesoreria y transferencias: solo lectura directa; alta vía RPC
create policy "select mov_tesoreria" on public.movimientos_tesoreria for select
  using (empresa_id = public.current_empresa_id());
create policy "update mov_tesoreria" on public.movimientos_tesoreria for update
  using (empresa_id = public.current_empresa_id());  -- solo para marcar conciliado

create policy "select transferencias" on public.transferencias for select
  using (empresa_id = public.current_empresa_id());

-- ---------------------------------------------------------------------------
-- 4. RPC: registrar un movimiento simple
--    Toma lock de la cuenta, valida saldo si el monto es negativo, inserta.
--    El trigger actualiza el saldo. Devuelve el saldo nuevo.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_movimiento_tesoreria(
  p_empresa_id        uuid,
  p_cuenta_id         uuid,
  p_monto             numeric,       -- + entra, - sale
  p_tipo              text,
  p_fecha             date    default null,
  p_motivo            text    default null,
  p_payment_order_id  uuid    default null,
  p_sales_receipt_id  uuid    default null,
  p_project_id        uuid    default null,
  p_created_by        uuid    default null,
  p_permitir_negativo boolean default false
) returns numeric
language plpgsql
security definer
as $$
declare
  v_saldo   numeric;
  v_moneda  public.currency_code;
begin
  if p_monto = 0 then
    raise exception 'El monto no puede ser cero';
  end if;

  select saldo, moneda into v_saldo, v_moneda
  from public.cuentas_financieras
  where id = p_cuenta_id and empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Cuenta financiera no encontrada';
  end if;

  if p_monto < 0 and not p_permitir_negativo and (v_saldo + p_monto) < 0 then
    raise exception 'Saldo insuficiente: disponible %, requerido %', v_saldo, abs(p_monto);
  end if;

  insert into public.movimientos_tesoreria
    (empresa_id, cuenta_id, fecha, monto, tipo, motivo,
     payment_order_id, sales_receipt_id, project_id, created_by)
  values
    (p_empresa_id, p_cuenta_id, coalesce(p_fecha, current_date), p_monto, p_tipo, p_motivo,
     p_payment_order_id, p_sales_receipt_id, p_project_id, p_created_by);

  return v_saldo + p_monto;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: registrar una transferencia entre cuentas
--    Crea la fila de transferencias + dos movimientos (OUT del origen, IN al
--    destino), ambos ligados por transferencia_id. Locks en orden de id para
--    evitar deadlocks.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_transferencia(
  p_empresa_id         uuid,
  p_cuenta_origen_id   uuid,
  p_cuenta_destino_id  uuid,
  p_monto_origen       numeric,
  p_monto_destino      numeric default null,   -- default = mismo monto (misma moneda)
  p_fecha              date    default null,
  p_motivo             text    default null,
  p_created_by         uuid    default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_transfer_id  uuid;
  v_saldo_origen numeric;
  v_monto_dest   numeric := coalesce(p_monto_destino, p_monto_origen);
  v_lock_a uuid := least(p_cuenta_origen_id, p_cuenta_destino_id);
  v_lock_b uuid := greatest(p_cuenta_origen_id, p_cuenta_destino_id);
begin
  if p_cuenta_origen_id = p_cuenta_destino_id then
    raise exception 'Origen y destino no pueden ser la misma cuenta';
  end if;
  if p_monto_origen <= 0 or v_monto_dest <= 0 then
    raise exception 'Los montos deben ser positivos';
  end if;

  -- Lock de ambas cuentas en orden estable
  perform 1 from public.cuentas_financieras
    where id = v_lock_a and empresa_id = p_empresa_id for update;
  perform 1 from public.cuentas_financieras
    where id = v_lock_b and empresa_id = p_empresa_id for update;

  select saldo into v_saldo_origen
  from public.cuentas_financieras
  where id = p_cuenta_origen_id and empresa_id = p_empresa_id;

  if not found then
    raise exception 'Cuenta origen no encontrada';
  end if;
  if not exists (select 1 from public.cuentas_financieras
                 where id = p_cuenta_destino_id and empresa_id = p_empresa_id) then
    raise exception 'Cuenta destino no encontrada';
  end if;
  if v_saldo_origen < p_monto_origen then
    raise exception 'Saldo insuficiente en la cuenta origen: disponible %, requerido %',
      v_saldo_origen, p_monto_origen;
  end if;

  insert into public.transferencias
    (empresa_id, cuenta_origen_id, cuenta_destino_id, monto_origen, monto_destino,
     tipo_cambio, fecha, motivo, created_by)
  values
    (p_empresa_id, p_cuenta_origen_id, p_cuenta_destino_id, p_monto_origen, v_monto_dest,
     round(v_monto_dest / p_monto_origen, 6), coalesce(p_fecha, current_date), p_motivo, p_created_by)
  returning id into v_transfer_id;

  insert into public.movimientos_tesoreria
    (empresa_id, cuenta_id, fecha, monto, tipo, motivo, transferencia_id, created_by)
  values
    (p_empresa_id, p_cuenta_origen_id, coalesce(p_fecha, current_date), -p_monto_origen,
     'TRANSFERENCIA_OUT', p_motivo, v_transfer_id, p_created_by),
    (p_empresa_id, p_cuenta_destino_id, coalesce(p_fecha, current_date), v_monto_dest,
     'TRANSFERENCIA_IN', p_motivo, v_transfer_id, p_created_by);

  return v_transfer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Chequeo de integridad — para el job diario (Parte A2 del plan)
--    Devuelve las cuentas cuyo saldo materializado no coincide con el libro.
-- ---------------------------------------------------------------------------
create or replace function public.verificar_saldos_tesoreria(p_empresa_id uuid)
returns table (cuenta_id uuid, nombre text, saldo_materializado numeric, saldo_libro numeric, diferencia numeric)
language sql
stable
as $$
  select c.id, c.nombre, c.saldo,
         coalesce(sum(m.monto), 0) as saldo_libro,
         c.saldo - coalesce(sum(m.monto), 0) as diferencia
  from public.cuentas_financieras c
  left join public.movimientos_tesoreria m on m.cuenta_id = c.id
  where c.empresa_id = p_empresa_id
  group by c.id, c.nombre, c.saldo
  having c.saldo - coalesce(sum(m.monto), 0) <> 0;
$$;
