-- =============================================================================
-- 0041_project_certificate_annexes.sql
--
-- Certificados de obra — FASE 3: anexos que acompañan a cada certificado.
--
--   1. project_weather_log        registro diario del Libro de Obra
--   2. project_schedule_plans     cronograma físico-financiero, versionado por
--      + _months                  adenda; base de la curva de avance
--   3. project_certificate_staff  personal empleado en el período (roster del
--                                 certificado, no horas — eso ya está en
--                                 daily_labor_entries)
--
-- Scoping: project_id -> projects.empresa_id (o certificate_id -> project),
-- roles administracion/admin, igual que el resto del módulo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Registro diario de clima / practicabilidad
-- ---------------------------------------------------------------------------
create table public.project_weather_log (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references public.projects(id) on delete cascade,
  log_date    date        not null,
  -- B  bueno / soleado / practicable
  -- LL lluvioso / impracticable
  -- HH humedad excesiva / terreno encharcado / impracticable
  -- O  otras circunstancias / impracticable
  code        text        not null check (code in ('B', 'LL', 'HH', 'O')),
  note        text,
  recorded_by uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (project_id, log_date)
);
create index idx_project_weather_log_project on public.project_weather_log(project_id);

-- ---------------------------------------------------------------------------
-- 2. Cronograma físico-financiero (curva de avance)
-- ---------------------------------------------------------------------------
create table public.project_schedule_plans (
  id         uuid        primary key default gen_random_uuid(),
  project_id uuid        not null references public.projects(id) on delete cascade,
  label      text        not null,               -- 'Original', 'Adenda 1', …
  is_active  boolean     not null default false,  -- la versión vigente
  created_at timestamptz not null default now()
);
create index idx_project_schedule_plans_project on public.project_schedule_plans(project_id);
-- Una sola versión activa por proyecto.
create unique index idx_project_schedule_plans_active
  on public.project_schedule_plans(project_id) where is_active;

create table public.project_schedule_plan_months (
  id             uuid          primary key default gen_random_uuid(),
  plan_id        uuid          not null references public.project_schedule_plans(id) on delete cascade,
  month_index    integer       not null check (month_index >= 1),
  programado_pct numeric(6,3)  not null default 0,  -- % del contrato ejecutado ese mes
  unique (plan_id, month_index)
);

-- ---------------------------------------------------------------------------
-- 3. Personal empleado en el período (por certificado)
-- ---------------------------------------------------------------------------
create table public.project_certificate_staff (
  id             uuid        primary key default gen_random_uuid(),
  certificate_id uuid        not null references public.project_certificates(id) on delete cascade,
  nombre         text        not null,
  rol            text        not null,
  sort_order     integer     not null default 0,
  created_at     timestamptz not null default now()
);
create index idx_project_certificate_staff_cert on public.project_certificate_staff(certificate_id);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.project_weather_log          enable row level security;
alter table public.project_schedule_plans       enable row level security;
alter table public.project_schedule_plan_months enable row level security;
alter table public.project_certificate_staff    enable row level security;

-- project_weather_log (scoped por project_id)
create policy project_weather_log_select on public.project_weather_log
  for select using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_weather_log_insert on public.project_weather_log
  for insert with check (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_weather_log_update on public.project_weather_log
  for update using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_weather_log_delete on public.project_weather_log
  for delete using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- project_schedule_plans (scoped por project_id)
create policy project_schedule_plans_select on public.project_schedule_plans
  for select using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_schedule_plans_insert on public.project_schedule_plans
  for insert with check (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_schedule_plans_update on public.project_schedule_plans
  for update using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_schedule_plans_delete on public.project_schedule_plans
  for delete using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- project_schedule_plan_months (scoped vía plan_id -> project)
create policy project_schedule_plan_months_select on public.project_schedule_plan_months
  for select using (
    plan_id in (
      select pl.id from public.project_schedule_plans pl
      join public.projects p on p.id = pl.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_schedule_plan_months_insert on public.project_schedule_plan_months
  for insert with check (
    plan_id in (
      select pl.id from public.project_schedule_plans pl
      join public.projects p on p.id = pl.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_schedule_plan_months_update on public.project_schedule_plan_months
  for update using (
    plan_id in (
      select pl.id from public.project_schedule_plans pl
      join public.projects p on p.id = pl.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_schedule_plan_months_delete on public.project_schedule_plan_months
  for delete using (
    plan_id in (
      select pl.id from public.project_schedule_plans pl
      join public.projects p on p.id = pl.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- project_certificate_staff (scoped vía certificate_id -> project)
create policy project_certificate_staff_select on public.project_certificate_staff
  for select using (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificate_staff_insert on public.project_certificate_staff
  for insert with check (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificate_staff_update on public.project_certificate_staff
  for update using (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificate_staff_delete on public.project_certificate_staff
  for delete using (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
