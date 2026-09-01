-- Rollback for 0012_super_admin.sql.
begin;

drop policy if exists empresas_super_admin_all on public.empresas;

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

drop function if exists public.is_super_admin();
alter table public.profiles drop column if exists is_super_admin;

commit;
