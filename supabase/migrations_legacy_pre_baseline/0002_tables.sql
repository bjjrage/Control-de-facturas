-- profiles: 1:1 with auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.user_role not null default 'comercial',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  tax_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence public.rfq_code_seq start 1;

create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RFQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rfq_code_seq')::text, 4, '0')),
  created_by uuid not null references public.profiles(id),
  client_name text not null,
  mostrar_cliente_al_proveedor boolean not null default true,
  product text not null,
  quantity numeric(14, 2) not null check (quantity > 0),
  unit text not null,
  specifications text,
  required_date date,
  internal_reference text,
  observations text,
  status public.rfq_status not null default 'BORRADOR',
  selected_rfq_provider_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rfq_providers (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  provider_id uuid not null references public.providers(id),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  status public.rfq_provider_status not null default 'PENDIENTE',
  invited_at timestamptz not null default now(),
  opened_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rfq_id, provider_id)
);

alter table public.rfqs
  add constraint rfqs_selected_provider_fk
  foreign key (selected_rfq_provider_id) references public.rfq_providers(id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  rfq_provider_id uuid references public.rfq_providers(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_provider_id uuid not null unique references public.rfq_providers(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version_number integer not null,
  budget_number text not null,
  unit_price numeric(14, 4) not null check (unit_price > 0),
  total_price numeric(14, 2) not null check (total_price > 0),
  currency public.currency_code not null,
  invoice_available boolean not null,
  vat_included boolean not null,
  delivery_time text not null,
  offer_validity text not null,
  payment_terms text,
  observations text,
  pdf_attachment_id uuid not null references public.attachments(id),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (quote_id, version_number)
);

alter table public.attachments
  add column quote_version_id uuid references public.quote_versions(id) on delete set null;

create table public.authorized_orders (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id),
  provider_id uuid not null references public.providers(id),
  quote_version_id uuid not null references public.quote_versions(id),
  rfq_code text not null,
  provider_name text not null,
  client_name text not null,
  product text not null,
  quantity numeric(14, 2) not null,
  unit text not null,
  unit_price numeric(14, 4) not null,
  total_price numeric(14, 2) not null,
  currency public.currency_code not null,
  vat_included boolean not null,
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null default now(),
  is_cheapest boolean not null default false,
  selection_reason public.selection_reason,
  selection_reason_detail text,
  status public.order_status not null default 'AUTORIZADO',
  created_at timestamptz not null default now(),
  constraint selection_reason_required_if_not_cheapest
    check (is_cheapest = true or selection_reason is not null)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id),
  invoice_number text not null,
  invoice_date date not null,
  currency public.currency_code not null,
  subtotal numeric(14, 2),
  vat numeric(14, 2),
  total numeric(14, 2) not null check (total > 0),
  timbrado text,
  attachment_id uuid references public.attachments(id),
  observations text,
  status public.invoice_status not null default 'PENDIENTE',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, invoice_number)
);

create table public.invoice_order_matches (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  authorized_order_id uuid not null references public.authorized_orders(id),
  created_at timestamptz not null default now(),
  unique (invoice_id, authorized_order_id),
  unique (authorized_order_id)
);

create table public.invoice_exceptions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  reason text not null,
  comment text,
  difference_amount numeric(14, 2) not null,
  difference_pct numeric(7, 4) not null,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_type text not null default 'internal' check (actor_type in ('internal', 'provider', 'system')),
  actor_label text,
  action text not null,
  rfq_id uuid references public.rfqs(id),
  rfq_provider_id uuid references public.rfq_providers(id),
  invoice_id uuid references public.invoices(id),
  authorized_order_id uuid references public.authorized_orders(id),
  detail jsonb,
  created_at timestamptz not null default now()
);

-- indexes
create index idx_rfqs_status on public.rfqs(status);
create index idx_rfqs_created_by on public.rfqs(created_by);
create index idx_rfq_providers_rfq on public.rfq_providers(rfq_id);
create index idx_rfq_providers_token on public.rfq_providers(token);
create index idx_quote_versions_quote on public.quote_versions(quote_id);
create index idx_authorized_orders_rfq on public.authorized_orders(rfq_id);
create index idx_authorized_orders_provider on public.authorized_orders(provider_id);
create index idx_authorized_orders_status on public.authorized_orders(status);
create index idx_authorized_orders_product on public.authorized_orders(product);
create index idx_invoices_provider on public.invoices(provider_id);
create index idx_invoices_status on public.invoices(status);
create index idx_invoice_order_matches_invoice on public.invoice_order_matches(invoice_id);
create index idx_audit_logs_rfq on public.audit_logs(rfq_id);
create index idx_audit_logs_invoice on public.audit_logs(invoice_id);
