-- Multi-tenant (row-level isolation).
--
-- Every domain row now belongs to an `empresa`. RLS gains an
-- `empresa_id = public.current_empresa_id()` clause on top of the existing
-- role checks, so a user only ever sees their own company's data. The app
-- barely changes: BEFORE INSERT triggers fill `empresa_id` automatically —
-- from the caller's profile for root tables, or from the parent row for
-- child tables (this also keeps the public `/cotizar` flow, which runs as
-- the service role with no auth.uid(), working).
--
-- Existing data is backfilled to a single seeded company ("niu.pack").

-- ---------------------------------------------------------------------------
-- 1. empresas + profiles.empresa_id
-- ---------------------------------------------------------------------------

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.empresas enable row level security;

alter table public.profiles
  add column empresa_id uuid references public.empresas(id);

-- Seed the current tenant and attach every existing profile to it.
insert into public.empresas (nombre, slug) values ('niu.pack', 'niupack');

update public.profiles
  set empresa_id = (select id from public.empresas where slug = 'niupack')
  where empresa_id is null;

alter table public.profiles
  alter column empresa_id set not null;

create index idx_profiles_empresa on public.profiles(empresa_id);

-- ---------------------------------------------------------------------------
-- 2. current_empresa_id() helper (same shape as current_profile_role())
-- ---------------------------------------------------------------------------

create or replace function public.current_empresa_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select empresa_id from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 3. empresa_id on every domain table  (add nullable -> backfill -> not null)
-- ---------------------------------------------------------------------------

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
    execute format(
      'alter table public.%I add column empresa_id uuid references public.empresas(id)', t);
  end loop;
end $$;

-- Backfill. Order matters for the derived ones, but since there is exactly one
-- company right now we can point everything at it directly.
update public.providers              set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.rfqs                    set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.rfq_providers           set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.attachments             set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.quotes                  set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.quote_versions          set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.authorized_orders       set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.invoices                set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.invoice_order_matches   set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.invoice_exceptions      set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;
update public.audit_logs              set empresa_id = (select id from public.empresas where slug = 'niupack') where empresa_id is null;

-- NOT NULL on everything except audit_logs (system/provider events can be
-- written with no auth.uid() and no linkable parent — keep those loggable).
do $$
declare
  t text;
  not_null_tables text[] := array[
    'providers', 'rfqs', 'rfq_providers', 'attachments', 'quotes',
    'quote_versions', 'authorized_orders', 'invoices',
    'invoice_order_matches', 'invoice_exceptions'
  ];
begin
  foreach t in array not_null_tables loop
    execute format('alter table public.%I alter column empresa_id set not null', t);
  end loop;
end $$;

-- Indexes (RLS filtering without one = full table scan)
create index idx_providers_empresa            on public.providers(empresa_id);
create index idx_rfqs_empresa                 on public.rfqs(empresa_id);
create index idx_rfq_providers_empresa        on public.rfq_providers(empresa_id);
create index idx_attachments_empresa          on public.attachments(empresa_id);
create index idx_quotes_empresa               on public.quotes(empresa_id);
create index idx_quote_versions_empresa       on public.quote_versions(empresa_id);
create index idx_authorized_orders_empresa    on public.authorized_orders(empresa_id);
create index idx_invoices_empresa             on public.invoices(empresa_id);
create index idx_invoice_order_matches_empresa on public.invoice_order_matches(empresa_id);
create index idx_invoice_exceptions_empresa   on public.invoice_exceptions(empresa_id);
create index idx_audit_logs_empresa           on public.audit_logs(empresa_id);

-- ---------------------------------------------------------------------------
-- 4. BEFORE INSERT triggers: auto-populate empresa_id
-- ---------------------------------------------------------------------------

-- Root tables: take it from the caller's profile.
create or replace function public.set_empresa_id_from_caller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.empresa_id is null then
    new.empresa_id := public.current_empresa_id();
  end if;
  return new;
end;
$$;

create trigger trg_providers_empresa before insert on public.providers
  for each row execute function public.set_empresa_id_from_caller();
create trigger trg_rfqs_empresa before insert on public.rfqs
  for each row execute function public.set_empresa_id_from_caller();
create trigger trg_invoices_empresa before insert on public.invoices
  for each row execute function public.set_empresa_id_from_caller();

-- Child tables: derive from the parent row (falls back to caller's profile).
create or replace function public.set_rfq_providers_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_provider_empresa uuid;
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.rfqs where id = new.rfq_id),
      public.current_empresa_id());
  end if;
  select empresa_id into v_provider_empresa from public.providers where id = new.provider_id;
  if v_provider_empresa is distinct from new.empresa_id then
    raise exception 'provider % does not belong to empresa %', new.provider_id, new.empresa_id;
  end if;
  return new;
end;
$$;
create trigger trg_rfq_providers_empresa before insert on public.rfq_providers
  for each row execute function public.set_rfq_providers_empresa();

create or replace function public.set_quotes_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.rfq_providers where id = new.rfq_provider_id),
      public.current_empresa_id());
  end if;
  return new;
end;
$$;
create trigger trg_quotes_empresa before insert on public.quotes
  for each row execute function public.set_quotes_empresa();

create or replace function public.set_quote_versions_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.quotes where id = new.quote_id),
      public.current_empresa_id());
  end if;
  return new;
end;
$$;
create trigger trg_quote_versions_empresa before insert on public.quote_versions
  for each row execute function public.set_quote_versions_empresa();

create or replace function public.set_attachments_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.rfq_providers where id = new.rfq_provider_id),
      (select empresa_id from public.rfqs where id = new.rfq_id),
      (select empresa_id from public.quote_versions where id = new.quote_version_id),
      public.current_empresa_id());
  end if;
  return new;
end;
$$;
create trigger trg_attachments_empresa before insert on public.attachments
  for each row execute function public.set_attachments_empresa();

create or replace function public.set_authorized_orders_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.rfqs where id = new.rfq_id),
      public.current_empresa_id());
  end if;
  return new;
end;
$$;
create trigger trg_authorized_orders_empresa before insert on public.authorized_orders
  for each row execute function public.set_authorized_orders_empresa();

create or replace function public.set_invoice_order_matches_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_order_empresa uuid;
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.invoices where id = new.invoice_id),
      public.current_empresa_id());
  end if;
  select empresa_id into v_order_empresa from public.authorized_orders where id = new.authorized_order_id;
  if v_order_empresa is distinct from new.empresa_id then
    raise exception 'authorized_order % does not belong to empresa %', new.authorized_order_id, new.empresa_id;
  end if;
  return new;
end;
$$;
create trigger trg_invoice_order_matches_empresa before insert on public.invoice_order_matches
  for each row execute function public.set_invoice_order_matches_empresa();

create or replace function public.set_invoice_exceptions_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      (select empresa_id from public.invoices where id = new.invoice_id),
      public.current_empresa_id());
  end if;
  return new;
end;
$$;
create trigger trg_invoice_exceptions_empresa before insert on public.invoice_exceptions
  for each row execute function public.set_invoice_exceptions_empresa();

-- audit_logs: derive from whichever entity the event is linked to, else caller.
create or replace function public.set_audit_logs_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is null then
    new.empresa_id := coalesce(
      public.current_empresa_id(),
      (select empresa_id from public.rfqs where id = new.rfq_id),
      (select empresa_id from public.rfq_providers where id = new.rfq_provider_id),
      (select empresa_id from public.invoices where id = new.invoice_id),
      (select empresa_id from public.authorized_orders where id = new.authorized_order_id));
  end if;
  return new;
end;
$$;
create trigger trg_audit_logs_empresa before insert on public.audit_logs
  for each row execute function public.set_audit_logs_empresa();

-- ---------------------------------------------------------------------------
-- 5. RLS: add empresa scoping on top of the existing role checks
-- ---------------------------------------------------------------------------

-- empresas: a user can see their own company.
create policy empresas_select_own on public.empresas
  for select using (id = public.current_empresa_id());

-- profiles
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (
    id = auth.uid()
    or (
      empresa_id = public.current_empresa_id()
      and public.is_internal_role(array['admin']::public.user_role[])
    )
  );

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (
    public.is_internal_role(array['admin']::public.user_role[])
    and empresa_id = public.current_empresa_id()
  )
  with check (
    public.is_internal_role(array['admin']::public.user_role[])
    and empresa_id = public.current_empresa_id()
  );

-- providers
drop policy if exists providers_select_internal on public.providers;
create policy providers_select_internal on public.providers
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));

drop policy if exists providers_admin_write on public.providers;
create policy providers_admin_write on public.providers
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['admin']::public.user_role[]));
drop policy if exists providers_admin_update on public.providers;
create policy providers_admin_update on public.providers
  for update using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['admin']::public.user_role[]));
drop policy if exists providers_admin_delete on public.providers;
create policy providers_admin_delete on public.providers
  for delete using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['admin']::public.user_role[]));

-- rfqs
drop policy if exists rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists rfqs_insert on public.rfqs;
create policy rfqs_insert on public.rfqs
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists rfqs_update on public.rfqs;
create policy rfqs_update on public.rfqs
  for update using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));

-- rfq_providers
drop policy if exists rfq_providers_select on public.rfq_providers;
create policy rfq_providers_select on public.rfq_providers
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists rfq_providers_insert on public.rfq_providers;
create policy rfq_providers_insert on public.rfq_providers
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists rfq_providers_update on public.rfq_providers;
create policy rfq_providers_update on public.rfq_providers
  for update using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));

-- attachments
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));

-- quotes / quote_versions
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists quote_versions_select on public.quote_versions;
create policy quote_versions_select on public.quote_versions
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));

-- authorized_orders
drop policy if exists authorized_orders_select on public.authorized_orders;
create policy authorized_orders_select on public.authorized_orders
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
drop policy if exists authorized_orders_insert on public.authorized_orders;
create policy authorized_orders_insert on public.authorized_orders
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));
drop policy if exists authorized_orders_update on public.authorized_orders;
create policy authorized_orders_update on public.authorized_orders
  for update using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- invoices
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- invoice_order_matches
drop policy if exists invoice_order_matches_select on public.invoice_order_matches;
create policy invoice_order_matches_select on public.invoice_order_matches
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoice_order_matches_insert on public.invoice_order_matches;
create policy invoice_order_matches_insert on public.invoice_order_matches
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoice_order_matches_delete on public.invoice_order_matches;
create policy invoice_order_matches_delete on public.invoice_order_matches
  for delete using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- invoice_exceptions
drop policy if exists invoice_exceptions_select on public.invoice_exceptions;
create policy invoice_exceptions_select on public.invoice_exceptions
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
drop policy if exists invoice_exceptions_insert on public.invoice_exceptions;
create policy invoice_exceptions_insert on public.invoice_exceptions
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- audit_logs
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select using (
    (
      empresa_id = public.current_empresa_id()
      and public.is_internal_role(array['admin']::public.user_role[])
    )
    or actor_id = auth.uid()
  );
-- insert policy unchanged (auth.uid() is not null); service-role path bypasses RLS.

-- ---------------------------------------------------------------------------
-- 6. Keep the reconciliation RPCs tenant-safe
-- ---------------------------------------------------------------------------
-- recompute_invoice_status / mark_invoice_* are SECURITY DEFINER and operate
-- by invoice id. They are only ever called by server actions right after an
-- RLS-checked read of that invoice, so no cross-tenant exposure — left as is.
