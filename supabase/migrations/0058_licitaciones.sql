-- Licitaciones — infraestructura de datos (Partes C2, D1, D5 del plan).
--
-- Recibe lo que trae la API OCDS de la DNCP más el seguimiento interno de cada
-- licitación. Todos los campos verificados contra licitaciones reales:
--   contrataciones.gov.py/datos/api/v3/doc/ocds/record/ocds-03ad3f-<nro>
--
-- El JSON completo del record se guarda en licitaciones.raw_json — si la API
-- cambia de forma, los parsers se re-corren sin volver a bajar nada.

-- ---------------------------------------------------------------------------
-- 1. Licitación (cabecera)
-- ---------------------------------------------------------------------------
create table if not exists public.licitaciones (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.empresas(id) on delete cascade,
  -- Identificadores DNCP
  dncp_nro              text not null,                    -- "391731"
  ocid                  text not null,                    -- "ocds-03ad3f-391731"
  -- Datos de la convocatoria
  titulo                text not null,
  comitente_nombre      text,
  comitente_id          text,                             -- DNCP-SICP-CODE
  categoria             text,                             -- works / goods / services
  categoria_detalle     text,
  procurement_method    text,                             -- open / limited / ...
  procurement_method_detalle text,                        -- "Concurso de Ofertas" / "LPN"
  award_criteria_detalle text,                            -- "Por Total" / "Por Lote" / "Por Ítem"
  monto_referencial     numeric(18,2),                    -- suma de lotes (ojo: en LPN puede ser techo)
  monto_disponible      numeric(18,2),                    -- planning.budget.amount
  moneda                text default 'PYG',
  -- Fechas
  fecha_publicacion     timestamptz,
  fecha_consultas_fin   timestamptz,
  fecha_entrega_ofertas timestamptz,
  fecha_apertura        timestamptz,
  lugar_apertura        text,
  -- Estado en la DNCP
  estado                text,                             -- CONVOCATORIA / EVALUACION / ADJUDICADA / DESIERTA
  estado_detalle        text,
  -- ¿La empresa está entre los proveedores notificados? (señal fuerte)
  invitada              boolean not null default false,
  -- Seguimiento interno
  decision              text not null default 'SIN_REVISAR'
                        check (decision in ('SIN_REVISAR', 'DESCARTADA', 'EN_PREPARACION',
                                            'PRESENTADA', 'GANADA', 'PERDIDA')),
  decision_notas        text,
  project_id            uuid references public.projects(id) on delete set null,  -- si se convirtió en obra
  -- Crudo
  raw_json              jsonb,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (empresa_id, ocid)
);

create index if not exists idx_licitaciones_empresa on public.licitaciones(empresa_id);
create index if not exists idx_licitaciones_estado on public.licitaciones(empresa_id, estado);
create index if not exists idx_licitaciones_decision on public.licitaciones(empresa_id, decision);
create index if not exists idx_licitaciones_entrega on public.licitaciones(empresa_id, fecha_entrega_ofertas);
create index if not exists idx_licitaciones_nro on public.licitaciones(dncp_nro);

-- ---------------------------------------------------------------------------
-- 2. Lotes
-- ---------------------------------------------------------------------------
create table if not exists public.licitacion_lotes (
  id               uuid primary key default gen_random_uuid(),
  licitacion_id    uuid not null references public.licitaciones(id) on delete cascade,
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  lote_dncp_id     text,
  numero           int,
  titulo           text,
  monto_referencial numeric(18,2),
  created_at       timestamptz not null default now()
);
create index if not exists idx_lic_lotes_lic on public.licitacion_lotes(licitacion_id);

-- ---------------------------------------------------------------------------
-- 3. Ítems de la planilla (referencial)
-- ---------------------------------------------------------------------------
create table if not exists public.licitacion_items (
  id                        uuid primary key default gen_random_uuid(),
  licitacion_id             uuid not null references public.licitaciones(id) on delete cascade,
  empresa_id                uuid not null references public.empresas(id) on delete cascade,
  lote_id                   uuid references public.licitacion_lotes(id) on delete set null,
  codigo_catalogo           text,                         -- catalogoNivel5DNCP
  codigo_unspsc             text,
  descripcion               text not null,
  cantidad                  numeric(18,4),
  unidad                    text,
  precio_unitario_referencial numeric(18,2),
  -- Normalización al catálogo común (Parte C5). Nullable hasta que se mapee.
  item_normalizado_id       uuid,
  sort_order                int not null default 0,
  created_at                timestamptz not null default now()
);
create index if not exists idx_lic_items_lic on public.licitacion_items(licitacion_id);
create index if not exists idx_lic_items_catalogo on public.licitacion_items(codigo_catalogo) where codigo_catalogo is not null;

-- ---------------------------------------------------------------------------
-- 4. Oferentes (competidores)
-- ---------------------------------------------------------------------------
create table if not exists public.licitacion_oferentes (
  id             uuid primary key default gen_random_uuid(),
  licitacion_id  uuid not null references public.licitaciones(id) on delete cascade,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  ruc            text,
  nombre         text not null,
  tamano         text,                                    -- micro / sme / ...
  monto_ofertado numeric(18,2),                           -- nullable; sale del Acta (Parte C4)
  gano           boolean not null default false,
  lotes_ganados  text[],
  -- De dónde salió el dato: API (solo ganadores) o ACTA_PDF (todos)
  fuente         text not null default 'API'
                 check (fuente in ('API', 'ACTA_PDF', 'CUADRO_PDF', 'MANUAL')),
  created_at     timestamptz not null default now(),
  unique (licitacion_id, ruc)
);
create index if not exists idx_lic_oferentes_lic on public.licitacion_oferentes(licitacion_id);
create index if not exists idx_lic_oferentes_ruc on public.licitacion_oferentes(empresa_id, ruc);

-- ---------------------------------------------------------------------------
-- 5. Documentos de la licitación (pliego, acta, planos…)
-- ---------------------------------------------------------------------------
create table if not exists public.licitacion_documentos (
  id             uuid primary key default gen_random_uuid(),
  licitacion_id  uuid not null references public.licitaciones(id) on delete cascade,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  tipo           text,                                    -- biddingDocuments / "Acta de Apertura" / ...
  tipo_detalle   text,
  titulo         text,
  url_dncp       text,
  -- Descarga local (storage)
  storage_path   text,
  descargado_at  timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_lic_docs_lic on public.licitacion_documentos(licitacion_id);

-- ---------------------------------------------------------------------------
-- 6. Nuestra oferta (Partes E y G)
-- ---------------------------------------------------------------------------
create table if not exists public.licitacion_ofertas (
  id                    uuid primary key default gen_random_uuid(),
  licitacion_id         uuid not null references public.licitaciones(id) on delete cascade,
  empresa_id            uuid not null references public.empresas(id) on delete cascade,
  monto_total           numeric(18,2),
  margen_estimado_pct   numeric(6,2),
  probabilidad_estimada numeric(5,2),
  estado                text not null default 'BORRADOR'
                        check (estado in ('BORRADOR', 'PRESENTADA', 'GANADA', 'PERDIDA')),
  notas                 text,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (licitacion_id)
);
create index if not exists idx_lic_ofertas_lic on public.licitacion_ofertas(licitacion_id);

create table if not exists public.licitacion_oferta_items (
  id                 uuid primary key default gen_random_uuid(),
  oferta_id          uuid not null references public.licitacion_ofertas(id) on delete cascade,
  empresa_id         uuid not null references public.empresas(id) on delete cascade,
  licitacion_item_id uuid not null references public.licitacion_items(id) on delete cascade,
  precio_unitario    numeric(18,2),
  costo_unitario     numeric(18,2),                       -- de tu CPP / historial
  created_at         timestamptz not null default now()
);
create index if not exists idx_lic_oferta_items_of on public.licitacion_oferta_items(oferta_id);

-- ---------------------------------------------------------------------------
-- 7. Perfil de licitaciones de la empresa (Parte D1)
-- ---------------------------------------------------------------------------
create table if not exists public.licitacion_perfil (
  empresa_id       uuid primary key references public.empresas(id) on delete cascade,
  codigos_catalogo text[] not null default '{}',          -- códigos N5 DNCP de interés
  palabras_clave   text[] not null default '{}',          -- match por texto en el título
  monto_min        numeric(18,2),
  monto_max        numeric(18,2),
  departamentos    text[] not null default '{}',
  activo           boolean not null default true,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. Repositorio de documentos de la empresa (Parte D5)
-- ---------------------------------------------------------------------------
create table if not exists public.empresa_documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  tipo             text not null,                         -- SET / IPS / PATENTE / RUC / PODER / BALANCE / OTRO
  descripcion      text,
  storage_path     text,
  fecha_emision    date,
  fecha_vencimiento date,
  notas            text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_empresa_docs on public.empresa_documentos(empresa_id);
create index if not exists idx_empresa_docs_venc on public.empresa_documentos(empresa_id, fecha_vencimiento)
  where fecha_vencimiento is not null;

-- ---------------------------------------------------------------------------
-- 9. RLS — todo por empresa
-- ---------------------------------------------------------------------------
alter table public.licitaciones           enable row level security;
alter table public.licitacion_lotes       enable row level security;
alter table public.licitacion_items       enable row level security;
alter table public.licitacion_oferentes   enable row level security;
alter table public.licitacion_documentos  enable row level security;
alter table public.licitacion_ofertas     enable row level security;
alter table public.licitacion_oferta_items enable row level security;
alter table public.licitacion_perfil      enable row level security;
alter table public.empresa_documentos     enable row level security;

create policy "select licitaciones" on public.licitaciones for select using (empresa_id = public.current_empresa_id());
create policy "insert licitaciones" on public.licitaciones for insert with check (empresa_id = public.current_empresa_id());
create policy "update licitaciones" on public.licitaciones for update using (empresa_id = public.current_empresa_id());
create policy "delete licitaciones" on public.licitaciones for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_lotes" on public.licitacion_lotes for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_lotes" on public.licitacion_lotes for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_lotes" on public.licitacion_lotes for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_lotes" on public.licitacion_lotes for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_items" on public.licitacion_items for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_items" on public.licitacion_items for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_items" on public.licitacion_items for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_items" on public.licitacion_items for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_oferentes" on public.licitacion_oferentes for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_oferentes" on public.licitacion_oferentes for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_oferentes" on public.licitacion_oferentes for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_oferentes" on public.licitacion_oferentes for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_docs" on public.licitacion_documentos for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_docs" on public.licitacion_documentos for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_docs" on public.licitacion_documentos for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_docs" on public.licitacion_documentos for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_ofertas" on public.licitacion_ofertas for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_ofertas" on public.licitacion_ofertas for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_ofertas" on public.licitacion_ofertas for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_ofertas" on public.licitacion_ofertas for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_oferta_items" on public.licitacion_oferta_items for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_oferta_items" on public.licitacion_oferta_items for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_oferta_items" on public.licitacion_oferta_items for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_oferta_items" on public.licitacion_oferta_items for delete using (empresa_id = public.current_empresa_id());

create policy "select lic_perfil" on public.licitacion_perfil for select using (empresa_id = public.current_empresa_id());
create policy "insert lic_perfil" on public.licitacion_perfil for insert with check (empresa_id = public.current_empresa_id());
create policy "update lic_perfil" on public.licitacion_perfil for update using (empresa_id = public.current_empresa_id());
create policy "delete lic_perfil" on public.licitacion_perfil for delete using (empresa_id = public.current_empresa_id());

create policy "select empresa_docs" on public.empresa_documentos for select using (empresa_id = public.current_empresa_id());
create policy "insert empresa_docs" on public.empresa_documentos for insert with check (empresa_id = public.current_empresa_id());
create policy "update empresa_docs" on public.empresa_documentos for update using (empresa_id = public.current_empresa_id());
create policy "delete empresa_docs" on public.empresa_documentos for delete using (empresa_id = public.current_empresa_id());
