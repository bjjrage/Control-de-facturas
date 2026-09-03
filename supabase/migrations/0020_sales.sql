-- ============================================================================
-- Módulo Ventas / Facturación (Fase 1 — sin integración fiscal SIFEN).
--
-- Espejo de la parte de compras: clientes, documentos de venta (proforma /
-- nota de venta / factura interna) con ítems, y cobros. Cuentas por cobrar =
-- documentos EMITIDA/COBRADA_PARCIAL con saldo > 0.
--
-- La emisión electrónica (CDC, XML, SET) se agrega después vía API de un PSE;
-- este esquema deja lugar para eso (columnas cdc / xml_url / kude_url nulas).
-- ============================================================================

-- --- Flags de módulo por empresa (SaaS: cada cliente compra lo que usa) -------
alter table public.empresas add column if not exists modulo_compras boolean not null default true;
alter table public.empresas add column if not exists modulo_ventas  boolean not null default false;
-- La empresa que ya venía usando el sistema tiene ambos.
update public.empresas set modulo_ventas = true;

-- --- Enums ------------------------------------------------------------------
create type public.sales_doc_type as enum ('PROFORMA', 'NOTA_VENTA', 'FACTURA');
create type public.sales_doc_status as enum ('BORRADOR', 'EMITIDA', 'COBRADA_PARCIAL', 'COBRADA', 'ANULADA');
create type public.receipt_method as enum ('EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'OTRO');

-- --- Clientes -------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  name text not null,
  tax_id text,                 -- RUC / CI
  contact_name text,
  email text,
  phone text,
  address text,
  payment_terms text,          -- "30 días", "contado", etc.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_clients_empresa on public.clients(empresa_id);

-- --- Contador por empresa para el código de documento ------------------------
create table public.sales_counters (
  empresa_id uuid primary key references public.empresas(id),
  last_number int not null default 0
);

-- --- Documentos de venta ------------------------------------------------------
create table public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  client_id uuid not null references public.clients(id),
  code text not null,                       -- "V-00001" por empresa
  doc_type public.sales_doc_type not null default 'NOTA_VENTA',
  issue_date date not null default current_date,
  due_date date,
  currency public.currency_code not null default 'PYG',
  subtotal numeric(14, 2) not null default 0, -- neto gravado + exento
  vat_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  cobrado_amount numeric(14, 2) not null default 0,
  status public.sales_doc_status not null default 'BORRADOR',
  notes text,
  -- huecos para la emisión electrónica futura:
  cdc text,
  xml_url text,
  kude_url text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, code)
);
create index idx_sales_documents_empresa on public.sales_documents(empresa_id);
create index idx_sales_documents_client on public.sales_documents(client_id);
create index idx_sales_documents_status on public.sales_documents(status);
create index idx_sales_documents_issue_date on public.sales_documents(issue_date);

create table public.sales_document_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  sales_document_id uuid not null references public.sales_documents(id) on delete cascade,
  description text not null,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit_price numeric(14, 4) not null check (unit_price >= 0),
  vat_rate int not null default 10 check (vat_rate in (0, 5, 10)),
  line_total numeric(14, 2) not null,      -- IVA incluido: quantity * unit_price
  created_at timestamptz not null default now()
);
create index idx_sales_document_items_doc on public.sales_document_items(sales_document_id);

create table public.sales_receipts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  sales_document_id uuid not null references public.sales_documents(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  receipt_date date not null default current_date,
  method public.receipt_method not null default 'TRANSFERENCIA',
  reference text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_sales_receipts_doc on public.sales_receipts(sales_document_id);

-- ============================================================================
-- Triggers
-- ============================================================================

-- empresa_id automático (mismo patrón que el resto del sistema)
create trigger trg_clients_empresa before insert on public.clients
  for each row execute function public.set_empresa_id_from_caller();
create trigger trg_sales_documents_empresa before insert on public.sales_documents
  for each row execute function public.set_empresa_id_from_caller();

create or replace function public.set_sales_child_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.sales_documents where id = new.sales_document_id),
      public.current_empresa_id());
  end if;
  return new;
end;
$$;
create trigger trg_sales_items_empresa before insert on public.sales_document_items
  for each row execute function public.set_sales_child_empresa();
create trigger trg_sales_receipts_empresa before insert on public.sales_receipts
  for each row execute function public.set_sales_child_empresa();

-- updated_at
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();
create trigger trg_sales_documents_updated before update on public.sales_documents
  for each row execute function public.set_updated_at();

-- Código correlativo por empresa: "V-00001". Corre después del trigger de
-- empresa_id (orden alfabético de nombres de trigger).
create or replace function public.set_sales_document_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if new.code is null or new.code = '' then
    insert into public.sales_counters as sc (empresa_id, last_number)
      values (coalesce(new.empresa_id, public.current_empresa_id()), 1)
      on conflict (empresa_id) do update set last_number = sc.last_number + 1
      returning sc.last_number into v_n;
    new.code := 'V-' || lpad(v_n::text, 5, '0');
  end if;
  return new;
end;
$$;
create trigger trg_sales_documents_zcode before insert on public.sales_documents
  for each row execute function public.set_sales_document_code();

-- Recalcular totales del documento a partir de sus ítems, y el estado a partir
-- de los cobros. Un solo lugar, llamado por ambos triggers hijos.
create or replace function public.recompute_sales_document(p_doc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total numeric(14,2);
  v_neto numeric(14,2);
  v_vat numeric(14,2);
  v_cobrado numeric(14,2);
  v_status public.sales_doc_status;
begin
  if p_doc is null then return; end if;

  select
    coalesce(sum(line_total), 0),
    coalesce(sum(case when vat_rate = 0 then line_total
                      else round(line_total / (1 + vat_rate / 100.0), 2) end), 0),
    coalesce(sum(case when vat_rate = 0 then 0
                      else line_total - round(line_total / (1 + vat_rate / 100.0), 2) end), 0)
    into v_total, v_neto, v_vat
  from public.sales_document_items where sales_document_id = p_doc;

  select coalesce(sum(amount), 0) into v_cobrado
  from public.sales_receipts where sales_document_id = p_doc;

  select status into v_status from public.sales_documents where id = p_doc;

  update public.sales_documents set
    subtotal = v_neto,
    vat_amount = v_vat,
    total = v_total,
    cobrado_amount = v_cobrado,
    status = case
      when v_status in ('BORRADOR', 'ANULADA') then v_status
      when v_cobrado <= 0 then 'EMITIDA'
      when v_cobrado >= v_total then 'COBRADA'
      else 'COBRADA_PARCIAL'
    end
  where id = p_doc;
end;
$$;

create or replace function public.trg_recompute_sales_doc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_sales_document(coalesce(new.sales_document_id, old.sales_document_id));
  return null;
end;
$$;
create trigger trg_sales_items_recompute
  after insert or update or delete on public.sales_document_items
  for each row execute function public.trg_recompute_sales_doc();
create trigger trg_sales_receipts_recompute
  after insert or update or delete on public.sales_receipts
  for each row execute function public.trg_recompute_sales_doc();

-- ============================================================================
-- RLS  — ventas es tarea de administración/admin
-- ============================================================================
alter table public.clients               enable row level security;
alter table public.sales_documents       enable row level security;
alter table public.sales_document_items  enable row level security;
alter table public.sales_receipts        enable row level security;
alter table public.sales_counters        enable row level security;

create policy clients_select on public.clients for select using (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
create policy clients_write on public.clients for all using (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[])
) with check (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[]));

create policy sales_documents_rw on public.sales_documents for all using (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[])
) with check (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[]));

create policy sales_items_rw on public.sales_document_items for all using (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[])
) with check (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[]));

create policy sales_receipts_rw on public.sales_receipts for all using (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[])
) with check (
  empresa_id = public.current_empresa_id()
  and public.is_internal_role(array['administracion','admin']::public.user_role[]));

create policy sales_counters_ro on public.sales_counters for select using (
  empresa_id = public.current_empresa_id());
-- Los GRANT a anon/authenticated/service_role vienen de `alter default
-- privileges` en 0006, así que las tablas nuevas ya quedan expuestas.
