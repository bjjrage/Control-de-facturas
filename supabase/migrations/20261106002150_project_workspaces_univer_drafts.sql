-- Native Univer documents in preparation. No operational project/budget writes.
create table public.project_workspaces (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  created_by uuid not null references public.profiles(id),
  name text not null default 'Obra sin nombre' check (length(name) between 1 and 200),
  workbook jsonb not null check (jsonb_typeof(workbook) = 'object' and octet_length(workbook::text) <= 5242880),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_workspaces_empresa_updated_idx on public.project_workspaces(empresa_id, updated_at desc);
create index project_workspaces_created_by_idx on public.project_workspaces(created_by);
alter table public.project_workspaces enable row level security;
revoke all on public.project_workspaces from anon, authenticated;
grant select, insert on public.project_workspaces to authenticated;
grant update(name, workbook, revision) on public.project_workspaces to authenticated;
grant all on public.project_workspaces to service_role;

create policy project_workspaces_select on public.project_workspaces for select to authenticated
using (empresa_id = (select public.current_empresa_id()) and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_workspaces_insert on public.project_workspaces for insert to authenticated
with check (empresa_id = (select public.current_empresa_id()) and created_by = (select auth.uid()) and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy project_workspaces_update on public.project_workspaces for update to authenticated
using (empresa_id = (select public.current_empresa_id()) and public.is_internal_role(array['administracion','admin']::public.user_role[]))
with check (empresa_id = (select public.current_empresa_id()) and public.is_internal_role(array['administracion','admin']::public.user_role[]));

create function public.project_workspace_revision_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Workspace revision must increase by one' using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.project_workspace_revision_guard() from public, anon;
grant execute on function public.project_workspace_revision_guard() to authenticated, service_role;
create trigger project_workspace_revision before update on public.project_workspaces
for each row execute function public.project_workspace_revision_guard();
