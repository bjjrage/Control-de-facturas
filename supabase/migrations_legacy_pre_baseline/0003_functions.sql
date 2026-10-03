-- Helper: current user's role, security definer to avoid RLS recursion on profiles
create or replace function public.current_profile_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_internal_role(roles public.user_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_profile_role() = any(roles), false);
$$;

-- generic updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_rfqs_updated_at before update on public.rfqs
  for each row execute function public.set_updated_at();

create trigger trg_invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- audit log insert helper, callable by authenticated internal users and service role
create or replace function public.log_audit_event(
  p_action text,
  p_rfq_id uuid default null,
  p_rfq_provider_id uuid default null,
  p_invoice_id uuid default null,
  p_authorized_order_id uuid default null,
  p_detail jsonb default null,
  p_actor_type text default 'internal',
  p_actor_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs (
    actor_id, actor_type, actor_label, action, rfq_id, rfq_provider_id,
    invoice_id, authorized_order_id, detail
  ) values (
    auth.uid(), p_actor_type, p_actor_label, p_action, p_rfq_id, p_rfq_provider_id,
    p_invoice_id, p_authorized_order_id, p_detail
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Reconciliation: recompute invoice status based on matched authorized_orders sum vs invoice total
create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_authorized_sum numeric(14,2);
  v_has_exception boolean;
begin
  select total into v_total from public.invoices where id = p_invoice_id;

  select coalesce(sum(ao.total_price), 0) into v_authorized_sum
  from public.invoice_order_matches iom
  join public.authorized_orders ao on ao.id = iom.authorized_order_id
  where iom.invoice_id = p_invoice_id;

  select exists(select 1 from public.invoice_exceptions where invoice_id = p_invoice_id)
    into v_has_exception;

  if v_authorized_sum = 0 then
    update public.invoices set status = 'PENDIENTE' where id = p_invoice_id;
  elsif v_authorized_sum = v_total then
    update public.invoices set status = 'MATCH' where id = p_invoice_id;
    update public.authorized_orders ao set status = 'CONCILIADO'
      from public.invoice_order_matches iom
      where iom.authorized_order_id = ao.id and iom.invoice_id = p_invoice_id;
  elsif v_has_exception then
    update public.invoices set status = 'APROBADO_EXCEPCION' where id = p_invoice_id;
    update public.authorized_orders ao set status = 'CONCILIADO'
      from public.invoice_order_matches iom
      where iom.authorized_order_id = ao.id and iom.invoice_id = p_invoice_id;
  else
    update public.invoices set status = 'REQUIERE_REVISION' where id = p_invoice_id;
  end if;
end;
$$;

create or replace function public.trg_recompute_on_match_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_invoice_status(old.invoice_id);
    return old;
  else
    perform public.recompute_invoice_status(new.invoice_id);
    return new;
  end if;
end;
$$;

create trigger trg_iom_recompute
  after insert or update or delete on public.invoice_order_matches
  for each row execute function public.trg_recompute_on_match_change();

-- Mark invoice APTO_PARA_PAGO (only from MATCH or APROBADO_EXCEPCION)
create or replace function public.mark_invoice_apto_para_pago(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status not in ('MATCH', 'APROBADO_EXCEPCION') then
    raise exception 'La factura debe estar conciliada (MATCH) o aprobada por excepción antes de marcar apto para pago';
  end if;
  update public.invoices set status = 'APTO_PARA_PAGO' where id = p_invoice_id;
  update public.authorized_orders ao set status = 'APTO_PARA_PAGO'
    from public.invoice_order_matches iom
    where iom.authorized_order_id = ao.id and iom.invoice_id = p_invoice_id;
end;
$$;

create or replace function public.mark_invoice_pagado(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status <> 'APTO_PARA_PAGO' then
    raise exception 'La factura debe estar APTO_PARA_PAGO antes de marcarla como pagada';
  end if;
  update public.invoices set status = 'PAGADO' where id = p_invoice_id;
  update public.authorized_orders ao set status = 'PAGADO'
    from public.invoice_order_matches iom
    where iom.authorized_order_id = ao.id and iom.invoice_id = p_invoice_id;
end;
$$;
