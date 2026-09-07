-- =============================================================================
-- 0039_project_certificates.sql
--
-- Certificados de ejecución de obra — el documento con el que el contratista
-- le cobra al comitente cada mes en obra pública (distinto de
-- subcontractor_certificates, que va en la dirección opuesta: lo que un
-- subcontratista le presenta a la empresa).
--
-- FASE 1: cabecera + líneas del certificado, generación automática desde
-- budget_items + execution_entries, y estados BORRADOR / CERRADO. La capa de
-- facturación (devolución de anticipo, retención, penalidades) y el circuito
-- de firmas de tres pasos llegan en una migración posterior (fase 2).
--
-- DECISIONES DE DISEÑO:
--   1. El error de doble conteo del Excel de referencia (la columna "anterior"
--      se tipeaba a mano con el valor del acumulado y después K = I + J la
--      volvía a sumar) se elimina por construcción: qty_anterior se DERIVA de
--      los certificados ya CERRADOS y qty_acumulada / los montos son columnas
--      GENERATED — una fila no puede contradecirse a sí misma.
--   2. Las líneas se CONGELAN al cerrar (por eso se guardan y no se
--      recalculan): si mañana cambia un precio unitario en budget_items, el
--      certificado ya emitido y firmado no se puede mover.
--   3. Scoping multi-tenant vía project_id -> projects.empresa_id, igual que
--      budget_items / execution_entries / daily_labor_entries. Sin empresa_id
--      propio.
--   4. Totales de cabecera: monto_anterior / monto_presente se recalculan en
--      la server action al escribir líneas (todas las escrituras pasan por
--      ahí). monto_acumulado es GENERATED sobre esas dos columnas reales.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Datos de contrato en projects (encabezado de todos los documentos)
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists comitente               text,
  add column if not exists contract_number         text,
  add column if not exists contract_amount         numeric(18,2) not null default 0,
  add column if not exists plazo_dias               integer,
  add column if not exists orden_inicio_date        date,
  add column if not exists fiscalizacion_nombre     text,
  add column if not exists fiscalizacion_contrato   text,
  add column if not exists anticipo_pct             numeric(5,2) not null default 30,
  add column if not exists devolucion_anticipo_pct  numeric(5,2) not null default 40,
  add column if not exists retencion_pct            numeric(5,2) not null default 5,
  add column if not exists iva_pct                  numeric(5,2) not null default 10;

-- ---------------------------------------------------------------------------
-- 2. Cabecera del certificado
-- ---------------------------------------------------------------------------
create table public.project_certificates (
  id             uuid          primary key default gen_random_uuid(),
  project_id     uuid          not null references public.projects(id) on delete cascade,
  numero         integer       not null,
  period_start   date          not null,
  period_end     date          not null,
  status         text          not null default 'BORRADOR'
                 check (status in ('BORRADOR', 'CERRADO')),
  -- Totales, recalculados desde las líneas al escribir (ver decisión #4).
  monto_anterior   numeric(18,2) not null default 0,
  monto_presente   numeric(18,2) not null default 0,
  monto_acumulado  numeric(18,2) generated always as (monto_anterior + monto_presente) stored,
  notes          text,
  created_by     uuid          references auth.users(id) on delete set null,
  closed_at      timestamptz,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  check (period_end >= period_start),
  unique (project_id, numero)
);

-- ---------------------------------------------------------------------------
-- 3. Líneas del certificado — congeladas al cerrar
-- ---------------------------------------------------------------------------
create table public.project_certificate_items (
  id              uuid          primary key default gen_random_uuid(),
  certificate_id  uuid          not null references public.project_certificates(id) on delete cascade,
  budget_item_id  uuid          references public.budget_items(id) on delete set null,
  codigo          text,
  descripcion     text          not null,
  unidad          text,
  qty_contractual numeric(18,4) not null default 0,
  precio_unitario numeric(18,2) not null default 0,
  qty_anterior    numeric(18,4) not null default 0,
  qty_presente    numeric(18,4) not null default 0,
  qty_acumulada   numeric(18,4) generated always as (qty_anterior + qty_presente) stored,
  -- Cada monto se redondea por separado y el acumulado es la SUMA de los dos
  -- redondeos (K = I + J), reproduciendo la aritmética del certificado oficial.
  monto_anterior  numeric(18,2) generated always as (round(qty_anterior  * precio_unitario, 0)) stored,
  monto_presente  numeric(18,2) generated always as (round(qty_presente  * precio_unitario, 0)) stored,
  monto_acumulado numeric(18,2) generated always as
                  (round(qty_anterior * precio_unitario, 0) + round(qty_presente * precio_unitario, 0)) stored,
  sort_order      integer       not null default 0,
  created_at      timestamptz   not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Índices
-- ---------------------------------------------------------------------------
create index idx_project_certificates_project      on public.project_certificates(project_id);
create index idx_project_certificate_items_cert    on public.project_certificate_items(certificate_id);
create index idx_project_certificate_items_budget  on public.project_certificate_items(budget_item_id);

-- ---------------------------------------------------------------------------
-- 5. updated_at
-- ---------------------------------------------------------------------------
create trigger trg_project_certificates_updated_at before update on public.project_certificates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS — scoped por empresa vía project_id, roles administracion/admin
-- ---------------------------------------------------------------------------
alter table public.project_certificates      enable row level security;
alter table public.project_certificate_items enable row level security;

-- project_certificates
create policy project_certificates_select on public.project_certificates
  for select using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificates_insert on public.project_certificates
  for insert with check (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificates_update on public.project_certificates
  for update using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificates_delete on public.project_certificates
  for delete using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- project_certificate_items (scoped vía certificate_id -> project_certificates)
create policy project_certificate_items_select on public.project_certificate_items
  for select using (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificate_items_insert on public.project_certificate_items
  for insert with check (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificate_items_update on public.project_certificate_items
  for update using (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_certificate_items_delete on public.project_certificate_items
  for delete using (
    certificate_id in (
      select c.id from public.project_certificates c
      join public.projects p on p.id = c.project_id
      where p.empresa_id = public.current_empresa_id())
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
