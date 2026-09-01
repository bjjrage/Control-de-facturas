-- Super-admin role: manages empresas (tenants) and seeds each one's first
-- admin user. A super-admin still belongs to their own empresa for day-to-day
-- work; this flag only unlocks the cross-tenant /empresas section.

alter table public.profiles
  add column is_super_admin boolean not null default false;

update public.profiles
  set is_super_admin = true
  where email = 'marceloechauri@gmail.com';

create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false);
$$;

-- empresas: super-admin has full access; everyone else still sees only their own.
create policy empresas_super_admin_all on public.empresas
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- profiles: super-admin can read every profile (needed for the per-empresa
-- user lists / counts) and write across empresas (seeding a new admin).
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select using (
    id = auth.uid()
    or public.is_super_admin()
    or (
      empresa_id = public.current_empresa_id()
      and public.is_internal_role(array['admin']::public.user_role[])
    )
  );

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (
    public.is_super_admin()
    or (
      public.is_internal_role(array['admin']::public.user_role[])
      and empresa_id = public.current_empresa_id()
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_internal_role(array['admin']::public.user_role[])
      and empresa_id = public.current_empresa_id()
    )
  );
