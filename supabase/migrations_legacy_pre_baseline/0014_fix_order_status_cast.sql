-- Fix: en 0013, el CASE de sync_order_payment_status arranca con un literal de
-- texto, así que el tipo del CASE queda `text` y el UPDATE falla con
-- "column status is of type order_status but expression is of type text".
-- Se castea cada rama explícitamente.

create or replace function public.sync_order_payment_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_n int;
  v_n_apto int;
  v_n_pagado int;
begin
  if p_order_id is null then return; end if;

  select total_price, facturado_amount into v_order_total, v_facturado
  from public.authorized_orders where id = p_order_id;

  select
    count(*),
    count(*) filter (where i.status in ('APTO_PARA_PAGO', 'PAGADO')),
    count(*) filter (where i.status = 'PAGADO')
  into v_n, v_n_apto, v_n_pagado
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = p_order_id;

  update public.authorized_orders set status =
    case
      when v_n > 0 and v_n_pagado = v_n and v_facturado >= v_order_total then 'PAGADO'::public.order_status
      when v_n > 0 and v_n_apto = v_n and v_facturado >= v_order_total then 'APTO_PARA_PAGO'::public.order_status
      when v_facturado >= v_order_total then 'FACTURADO'::public.order_status
      else 'AUTORIZADO'::public.order_status
    end
  where id = p_order_id;
end;
$$;

-- Misma precaución en recompute_invoice_status (la primera rama ya es
-- order_status, así que funcionaba, pero dejamos los casts explícitos).
create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tolerance_pct constant numeric := 5;
  v_order_id uuid;
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_has_exception boolean;
begin
  select iom.authorized_order_id into v_order_id
  from public.invoice_order_matches iom
  where iom.invoice_id = p_invoice_id;

  if v_order_id is null then
    update public.invoices set status = 'PENDIENTE' where id = p_invoice_id;
    return;
  end if;

  select ao.total_price into v_order_total
  from public.authorized_orders ao where ao.id = v_order_id;

  select coalesce(sum(i.total), 0) into v_facturado
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = v_order_id;

  update public.authorized_orders
    set facturado_amount = v_facturado,
        status = case
          when status in ('APTO_PARA_PAGO', 'PAGADO') then status
          when v_facturado >= v_order_total then 'FACTURADO'::public.order_status
          else 'AUTORIZADO'::public.order_status
        end
    where id = v_order_id;

  select exists(select 1 from public.invoice_exceptions where invoice_id = p_invoice_id)
    into v_has_exception;

  if v_facturado <= v_order_total * (1 + v_tolerance_pct / 100.0) then
    update public.invoices set status = 'MATCH' where id = p_invoice_id;
  elsif v_has_exception then
    update public.invoices set status = 'APROBADO_EXCEPCION' where id = p_invoice_id;
  else
    update public.invoices set status = 'REQUIERE_REVISION' where id = p_invoice_id;
  end if;
end;
$$;
