-- Unidades físicas (viviendas, locales, etc.) para certificación por unidad
-- Idempotente: usa IF NOT EXISTS y DROP IF EXISTS en policies por si corrió parcialmente.

create table if not exists project_units (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  nombre        text not null,
  sort_order    int not null default 0,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint project_units_nombre_unique unique (project_id, nombre)
);

alter table project_units enable row level security;

drop policy if exists "empresa_read"    on project_units;
drop policy if exists "internal_write"  on project_units;

create policy "empresa_read" on project_units for select
  using (
    exists (
      select 1 from projects p
      where p.id = project_units.project_id
        and p.empresa_id = current_empresa_id()
    )
  );

-- Las escrituras van siempre via server actions (requirePlan) — la RLS solo
-- necesita que el usuario sea de la misma empresa.
create policy "internal_write" on project_units for all
  using (
    exists (
      select 1 from projects p
      where p.id = project_units.project_id
        and p.empresa_id = current_empresa_id()
    )
  )
  with check (
    exists (
      select 1 from projects p
      where p.id = project_units.project_id
        and p.empresa_id = current_empresa_id()
    )
  );

-- Cantidad por unidad física para cada rubro del presupuesto
alter table budget_items add column if not exists quantity_per_unit numeric(18,4);

-- Avance por unidad por certificado
create table if not exists project_certificate_unit_progress (
  id              uuid primary key default gen_random_uuid(),
  certificate_id  uuid not null references project_certificates(id) on delete cascade,
  unit_id         uuid not null references project_units(id) on delete cascade,
  pct_avance      numeric(5,2) not null default 0 check (pct_avance >= 0 and pct_avance <= 100),
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint cert_unit_unique unique (certificate_id, unit_id)
);

alter table project_certificate_unit_progress enable row level security;

drop policy if exists "empresa_read"    on project_certificate_unit_progress;
drop policy if exists "internal_write"  on project_certificate_unit_progress;

create policy "empresa_read" on project_certificate_unit_progress for select
  using (
    exists (
      select 1 from project_certificates pc
      join projects p on p.id = pc.project_id
      where pc.id = project_certificate_unit_progress.certificate_id
        and p.empresa_id = current_empresa_id()
    )
  );

create policy "internal_write" on project_certificate_unit_progress for all
  using (
    exists (
      select 1 from project_certificates pc
      join projects p on p.id = pc.project_id
      where pc.id = project_certificate_unit_progress.certificate_id
        and p.empresa_id = current_empresa_id()
    )
  )
  with check (
    exists (
      select 1 from project_certificates pc
      join projects p on p.id = pc.project_id
      where pc.id = project_certificate_unit_progress.certificate_id
        and p.empresa_id = current_empresa_id()
    )
  );
