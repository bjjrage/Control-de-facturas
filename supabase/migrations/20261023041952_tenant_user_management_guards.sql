-- Additive guards: stable c027ec23 keeps its normal company/user operations.
-- Authorization fields are protected even through direct authenticated REST.
begin;

create or replace function private.guard_empresa_entitlements()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or public.is_super_admin() then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.modulo_compras is distinct from old.modulo_compras
     or new.modulo_ventas is distinct from old.modulo_ventas then
    raise exception using errcode = '42501', message = 'Only superadmin can change company plan or modules';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_empresa_entitlements() from public;
create trigger guard_empresa_entitlements before update on public.empresas
for each row execute function private.guard_empresa_entitlements();

create or replace function private.guard_profile_admin_continuity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare removes_admin boolean;
begin
  -- Maintenance bypass only. Service-role application mutations remain guarded.
  if current_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if auth.uid() = old.id then
    if tg_op = 'DELETE' then
      raise exception using errcode = '42501', message = 'Cannot delete own profile';
    elsif new.role is distinct from old.role or (old.active and not new.active) then
      raise exception using errcode = '42501', message = 'Cannot demote or deactivate own profile';
    end if;
  end if;
  removes_admin := old.active and old.role = 'admin';
  if tg_op = 'UPDATE' then
    removes_admin := removes_admin and (not new.active or new.role <> 'admin' or new.empresa_id is distinct from old.empresa_id);
  end if;
  if removes_admin then
    -- Serialize removals in the same tenant before checking the remaining admins.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('profile-admin:' || old.empresa_id::text, 0));
    if not exists (
      select 1 from public.profiles p
      where p.empresa_id = old.empresa_id and p.role = 'admin' and p.active and p.id <> old.id
    ) then
      raise exception using errcode = '23514', message = 'last_active_admin: assign another active admin first';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_profile_admin_continuity() from public;
create trigger guard_profile_admin_continuity before update or delete on public.profiles
for each row execute function private.guard_profile_admin_continuity();

commit;
