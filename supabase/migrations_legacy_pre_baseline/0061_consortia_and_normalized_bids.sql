-- ===========================================================================
-- GATE 4: CONSORTIA, ENTITY ALIASES AND NORMALIZED PROCUREMENT BIDS
-- Modelado canónico de consorcios, miembros, resolución de aliases y ofertas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabla de Consorcios (Empresas Conjuntas)
-- ---------------------------------------------------------------------------
create table if not exists public.procurement_consortia (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null unique references public.procurement_suppliers(id) on delete cascade,
  nombre_consorcio    text not null,
  es_consorcio_formal boolean not null default true,
  observaciones       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_proc_consortia_supp on public.procurement_consortia(supplier_id);

-- ---------------------------------------------------------------------------
-- 2. Miembros de Consorcios (Sin invención de miembros)
-- ---------------------------------------------------------------------------
create table if not exists public.procurement_consortium_members (
  id                  uuid primary key default gen_random_uuid(),
  consortium_id       uuid not null references public.procurement_consortia(id) on delete cascade,
  member_supplier_id  uuid references public.procurement_suppliers(id) on delete set null,
  member_name_raw     text not null,
  participacion_pct   numeric(5,2) check (participacion_pct is null or (participacion_pct >= 0 and participacion_pct <= 100)),
  lider               boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists idx_proc_cons_members_cons on public.procurement_consortium_members(consortium_id);
create index if not exists idx_proc_cons_members_supp on public.procurement_consortium_members(member_supplier_id);

-- ---------------------------------------------------------------------------
-- 3. Aliases y Variaciones de Nombres de Entidades
-- ---------------------------------------------------------------------------
create table if not exists public.procurement_entity_aliases (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null references public.procurement_suppliers(id) on delete cascade,
  alias_raw           text not null unique,
  alias_normalizado   text not null,
  confidence_score    numeric(3,2) not null default 1.00 check (confidence_score >= 0.00 and confidence_score <= 1.00),
  fuente              text not null default 'AUTOMATICA' check (fuente in ('AUTOMATICA', 'MANUAL', 'ACTA_PDF', 'DNCP_API')),
  created_at          timestamptz not null default now()
);
create index if not exists idx_proc_aliases_supp on public.procurement_entity_aliases(supplier_id);
create index if not exists idx_proc_aliases_norm on public.procurement_entity_aliases(alias_normalizado);

-- ---------------------------------------------------------------------------
-- 4. Ampliación de procurement_bids para Ofertas Normalizadas y Linaje Documental
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'procurement_bids' and column_name = 'lot_id') then
    alter table public.procurement_bids add column lot_id uuid references public.procurement_lots(id) on delete set null;
    create index if not exists idx_proc_bids_lot on public.procurement_bids(lot_id);
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'procurement_bids' and column_name = 'estado_oferta') then
    alter table public.procurement_bids add column estado_oferta text not null default 'ADMITIDA'
      check (estado_oferta in ('ADMITIDA', 'DESCALIFICADA', 'GANADORA', 'RECHAZADA'));
    create index if not exists idx_proc_bids_estado on public.procurement_bids(estado_oferta);
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'procurement_bids' and column_name = 'motivo_descalificacion') then
    alter table public.procurement_bids add column motivo_descalificacion text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'procurement_bids' and column_name = 'confidence_score') then
    alter table public.procurement_bids add column confidence_score numeric(3,2) not null default 1.00
      check (confidence_score >= 0.00 and confidence_score <= 1.00);
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'procurement_bids' and column_name = 'document_url') then
    alter table public.procurement_bids add column document_url text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'procurement_bids' and column_name = 'document_id') then
    alter table public.procurement_bids add column document_id uuid references public.procurement_documents(id) on delete set null;
    create index if not exists idx_proc_bids_doc on public.procurement_bids(document_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS para Tablas Globales de Consorcios y Aliases
-- ---------------------------------------------------------------------------
alter table public.procurement_consortia           enable row level security;
alter table public.procurement_consortium_members  enable row level security;
alter table public.procurement_entity_aliases     enable row level security;

create policy "proc_consortia_read" on public.procurement_consortia for select to authenticated using (true);
create policy "proc_cons_members_read" on public.procurement_consortium_members for select to authenticated using (true);
create policy "proc_aliases_read" on public.procurement_entity_aliases for select to authenticated using (true);
