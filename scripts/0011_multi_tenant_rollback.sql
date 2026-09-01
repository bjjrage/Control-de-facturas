-- Rollback for 0011_multi_tenant.sql. Run manually (SQL editor or
-- `npx supabase db execute`) if the migration needs to be reverted.
-- Restores the role-only RLS from 0004_rls.sql.

begin;

-- 1. Drop the empresa-scoped policies and restore the originals ----------------

drop policy if exists empresas_select_own on public.empresas;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]));
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (public.is_internal_role(array['admin']::public.user_role[]))
  with check (public.is_internal_role(array['admin']::public.user_role[]));

drop policy if exists providers_select_internal on public.providers;
create policy providers_select_internal on public.providers
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists providers_admin_write on public.providers;
create policy providers_admin_write on public.providers
  for insert with check (public.is_internal_role(array['admin']::public.user_role[]));
drop policy if exists providers_admin_update on public.providers;
create policy providers_admin_update on public.providers
  for update using (public.is_internal_role(array['admin']::public.user_role[]));
drop policy if exists providers_admin_delete on public.providers;
create policy providers_admin_delete on public.providers
  for delete using (public.is_internal_role(array['admin']::public.user_role[]));

drop policy if exists rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists rfqs_insert on public.rfqs;
create policy rfqs_insert on public.rfqs
  for insert with check (public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists rfqs_update on public.rfqs;
create policy rfqs_update on public.rfqs
  for update using (public.is_internal_role(array['comercial','admin']::public.user_role[]));

drop policy if exists rfq_providers_select on public.rfq_providers;
create policy rfq_providers_select on public.rfq_providers
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists rfq_providers_insert on public.rfq_providers;
create policy rfq_providers_insert on public.rfq_providers
  for insert with check (public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists rfq_providers_update on public.rfq_providers;
create policy rfq_providers_update on public.rfq_providers
  for update using (public.is_internal_role(array['comercial','admin']::public.user_role[]));

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert with check (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));

drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select using (public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists quote_versions_select on public.quote_versions;
create policy quote_versions_select on public.quote_versions
  for select using (public.is_internal_role(array['comercial','admin']::public.user_role[]));

drop policy if exists authorized_orders_select on public.authorized_orders;
create policy authorized_orders_select on public.authorized_orders
  for select using (public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists authorized_orders_insert on public.authorized_orders;
create policy authorized_orders_insert on public.authorized_orders
  for insert with check (public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists authorized_orders_update on public.authorized_orders;
create policy authorized_orders_update on public.authorized_orders
  for update using (public.is_internal_role(array['administracion','admin']::public.user_role[]));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert with check (public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update using (public.is_internal_role(array['administracion','admin']::public.user_role[]));

drop policy if exists invoice_order_matches_select on public.invoice_order_matches;
create policy invoice_order_matches_select on public.invoice_order_matches
  for select using (public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoice_order_matches_insert on public.invoice_order_matches;
create policy invoice_order_matches_insert on public.invoice_order_matches
  for insert with check (public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoice_order_matches_delete on public.invoice_order_matches;
create policy invoice_order_matches_delete on public.invoice_order_matches
  for delete using (public.is_internal_role(array['administracion','admin']::public.user_role[]));

drop policy if exists invoice_exceptions_select on public.invoice_exceptions;
create policy invoice_exceptions_select on public.invoice_exceptions
  for select using (public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoice_exceptions_insert on public.invoice_exceptions;
create policy invoice_exceptions_insert on public.invoice_exceptions
  for insert with check (public.is_internal_role(array['administracion','admin']::public.user_role[]));

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select using (
    public.is_internal_role(array['admin']::public.user_role[])
    or actor_id = auth.uid()
  );

-- 2. Drop triggers + trigger functions ---------------------------------------

drop trigger if exists trg_providers_empresa on public.providers;
drop trigger if exists trg_rfqs_empresa on public.rfqs;
drop trigger if exists trg_invoices_empresa on public.invoices;
drop trigger if exists trg_rfq_providers_empresa on public.rfq_providers;
drop trigger if exists trg_quotes_empresa on public.quotes;
drop trigger if exists trg_quote_versions_empresa on public.quote_versions;
drop trigger if exists trg_attachments_empresa on public.attachments;
drop trigger if exists trg_authorized_orders_empresa on public.authorized_orders;
drop trigger if exists trg_invoice_order_matches_empresa on public.invoice_order_matches;
drop trigger if exists trg_invoice_exceptions_empresa on public.invoice_exceptions;
drop trigger if exists trg_audit_logs_empresa on public.audit_logs;

drop function if exists public.set_empresa_id_from_caller();
drop function if exists public.set_rfq_providers_empresa();
drop function if exists public.set_quotes_empresa();
drop function if exists public.set_quote_versions_empresa();
drop function if exists public.set_attachments_empresa();
drop function if exists public.set_authorized_orders_empresa();
drop function if exists public.set_invoice_order_matches_empresa();
drop function if exists public.set_invoice_exceptions_empresa();
drop function if exists public.set_audit_logs_empresa();

-- 3. Drop columns + helper + empresas ---------------------------------------

do $$
declare
  t text;
  domain_tables text[] := array[
    'providers', 'rfqs', 'rfq_providers', 'attachments', 'quotes',
    'quote_versions', 'authorized_orders', 'invoices',
    'invoice_order_matches', 'invoice_exceptions', 'audit_logs'
  ];
begin
  foreach t in array domain_tables loop
    execute format('alter table public.%I drop column if exists empresa_id', t);
  end loop;
end $$;

alter table public.profiles drop column if exists empresa_id;
drop function if exists public.current_empresa_id();
drop table if exists public.empresas;

commit;
