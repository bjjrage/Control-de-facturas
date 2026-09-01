-- Rollback de 0013_partial_deliveries.sql. Restaura la reconciliación de 0003.
begin;

drop trigger if exists trg_invoice_total_recompute on public.invoices;
drop function if exists public.trg_recompute_on_invoice_total_change();
drop function if exists public.sync_order_payment_status(uuid);

alter table public.invoice_order_matches
  drop constraint if exists invoice_order_matches_invoice_id_key;
alter table public.invoice_order_matches
  add constraint invoice_order_matches_authorized_order_id_key unique (authorized_order_id);

alter table public.authorized_orders drop column if exists facturado_amount;

-- Versión original (0003_functions.sql)
create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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

create or replace function public.mark_invoice_apto_para_pago(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.invoice_status;
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
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.invoice_status;
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

commit;
