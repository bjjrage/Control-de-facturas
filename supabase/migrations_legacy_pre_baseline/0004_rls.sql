-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.providers enable row level security;
alter table public.rfqs enable row level security;
alter table public.rfq_providers enable row level security;
alter table public.attachments enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_versions enable row level security;
alter table public.authorized_orders enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_order_matches enable row level security;
alter table public.invoice_exceptions enable row level security;
alter table public.audit_logs enable row level security;

-- profiles
create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]));

create policy profiles_admin_write on public.profiles
  for all using (public.is_internal_role(array['admin']::public.user_role[]))
  with check (public.is_internal_role(array['admin']::public.user_role[]));

-- providers: any internal role can read; only admin can write
create policy providers_select_internal on public.providers
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));

create policy providers_admin_write on public.providers
  for insert with check (public.is_internal_role(array['admin']::public.user_role[]));
create policy providers_admin_update on public.providers
  for update using (public.is_internal_role(array['admin']::public.user_role[]));
create policy providers_admin_delete on public.providers
  for delete using (public.is_internal_role(array['admin']::public.user_role[]));

-- rfqs: comercial + admin full read/write; administracion can read (needed to link invoices)
create policy rfqs_select on public.rfqs
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
create policy rfqs_insert on public.rfqs
  for insert with check (public.is_internal_role(array['comercial','admin']::public.user_role[]));
create policy rfqs_update on public.rfqs
  for update using (public.is_internal_role(array['comercial','admin']::public.user_role[]));

-- rfq_providers: comercial + admin manage; administracion read
create policy rfq_providers_select on public.rfq_providers
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
create policy rfq_providers_insert on public.rfq_providers
  for insert with check (public.is_internal_role(array['comercial','admin']::public.user_role[]));
create policy rfq_providers_update on public.rfq_providers
  for update using (public.is_internal_role(array['comercial','admin']::public.user_role[]));

-- attachments: internal roles can read all; insert by internal authenticated users
create policy attachments_select on public.attachments
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
create policy attachments_insert on public.attachments
  for insert with check (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));

-- quotes / quote_versions: comercial + admin only (administracion does not see quotes)
create policy quotes_select on public.quotes
  for select using (public.is_internal_role(array['comercial','admin']::public.user_role[]));
create policy quote_versions_select on public.quote_versions
  for select using (public.is_internal_role(array['comercial','admin']::public.user_role[]));

-- authorized_orders: comercial+admin (selection/history), administracion (invoicing) can all read;
-- insert restricted to comercial/admin (creation happens on offer selection)
create policy authorized_orders_select on public.authorized_orders
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
create policy authorized_orders_insert on public.authorized_orders
  for insert with check (public.is_internal_role(array['comercial','admin']::public.user_role[]));
create policy authorized_orders_update on public.authorized_orders
  for update using (public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- invoices: administracion + admin only
create policy invoices_select on public.invoices
  for select using (public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoices_insert on public.invoices
  for insert with check (public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoices_update on public.invoices
  for update using (public.is_internal_role(array['administracion','admin']::public.user_role[]));

create policy invoice_order_matches_select on public.invoice_order_matches
  for select using (public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoice_order_matches_insert on public.invoice_order_matches
  for insert with check (public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoice_order_matches_delete on public.invoice_order_matches
  for delete using (public.is_internal_role(array['administracion','admin']::public.user_role[]));

create policy invoice_exceptions_select on public.invoice_exceptions
  for select using (public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoice_exceptions_insert on public.invoice_exceptions
  for insert with check (public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- audit_logs: any internal authenticated user can insert (via log_audit_event, security definer,
-- so this policy mainly governs direct inserts); select restricted to admin, plus comercial/administracion
-- can see logs tied to entities they have access to (kept simple: admin full, others read own actor rows)
create policy audit_logs_select on public.audit_logs
  for select using (
    public.is_internal_role(array['admin']::public.user_role[])
    or actor_id = auth.uid()
  );
create policy audit_logs_insert on public.audit_logs
  for insert with check (auth.uid() is not null);

-- No delete policies are defined anywhere on record-of-truth tables (audit_logs, authorized_orders,
-- invoices, quote_versions) -- omitting a delete policy denies delete under RLS by default.
