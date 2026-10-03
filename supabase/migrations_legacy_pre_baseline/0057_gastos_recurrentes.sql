-- Gastos recurrentes / programados (Parte A5 del plan).
--
-- Alquiler, sueldos administrativos, seguros, cuota de préstamo, honorarios del
-- contador. Plata que sale todos los meses y hoy no vive en ninguna parte del
-- sistema. Sin esto la proyección de caja miente por abajo.
--
-- Esta tabla NO genera movimientos automáticos: al pagarse efectivamente se
-- registra un movimiento de tesorería normal (EGRESO). La tabla solo alimenta
-- la proyección con los vencimientos futuros esperados.

create table if not exists public.gastos_recurrentes (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  descripcion    text not null,
  categoria      text not null default 'OTRO'
                 check (categoria in ('ALQUILER', 'SUELDOS', 'SEGUROS', 'PRESTAMO',
                                      'SERVICIOS', 'IMPUESTOS', 'HONORARIOS', 'OTRO')),
  monto_estimado numeric(18,2) not null check (monto_estimado > 0),
  moneda         public.currency_code not null default 'PYG',
  periodicidad   text not null default 'MENSUAL'
                 check (periodicidad in ('MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL')),
  dia_del_mes    int check (dia_del_mes between 1 and 31),
  -- Cuenta de la que suele salir (para pre-llenar el movimiento al pagarlo).
  cuenta_id      uuid references public.cuentas_financieras(id) on delete set null,
  -- Obra a la que se imputa, si aplica.
  project_id     uuid references public.projects(id) on delete set null,
  proximo_vencimiento date,
  activo         boolean not null default true,
  notas          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_gastos_rec_empresa on public.gastos_recurrentes(empresa_id, activo);

alter table public.gastos_recurrentes enable row level security;

create policy "select gastos_rec" on public.gastos_recurrentes for select
  using (empresa_id = public.current_empresa_id());
create policy "insert gastos_rec" on public.gastos_recurrentes for insert
  with check (empresa_id = public.current_empresa_id());
create policy "update gastos_rec" on public.gastos_recurrentes for update
  using (empresa_id = public.current_empresa_id());
create policy "delete gastos_rec" on public.gastos_recurrentes for delete
  using (empresa_id = public.current_empresa_id());
