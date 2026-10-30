-- Production migration version assigned by Supabase; QA applied the same
-- definition as 20261030011748. Lock review and confirmation atomically.
create or replace function public.planilla_confirmar_revision(p_planilla_id uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v public.planillas;
begin
  select * into v from public.planillas where id=p_planilla_id
    and empresa_id=public.current_empresa_id() for update;
  if not found then raise exception 'Planilla no encontrada'; end if;
  if v.estado <> 'confirmed' and v.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='P0409', message='El borrador cambió. Revisá la versión antes de confirmar.';
  end if;
  return public.planilla_confirmar_computo(p_planilla_id);
end $$;
revoke all on function public.planilla_confirmar_revision(uuid,timestamptz) from public, anon;
grant execute on function public.planilla_confirmar_revision(uuid,timestamptz) to authenticated;
