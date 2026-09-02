-- Fix: al borrar/desvincular la última factura de una OC, la OC quedaba con el
-- facturado_amount y el estado viejos. `recompute_invoice_status` corta antes de
-- tocar la OC cuando la factura ya no tiene orden vinculada, así que el trigger
-- de invoice_order_matches ahora recalcula también la OC afectada.

create or replace function public.recompute_order_facturado(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
begin
  if p_order_id is null then return; end if;

  select total_price into v_order_total from public.authorized_orders where id = p_order_id;

  select coalesce(sum(i.total), 0) into v_facturado
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = p_order_id;

  update public.authorized_orders set
    facturado_amount = v_facturado,
    status = case
      when status in ('APTO_PARA_PAGO', 'PAGADO') and v_facturado > 0 then status
      when v_facturado >= v_order_total and v_facturado > 0 then 'FACTURADO'::public.order_status
      else 'AUTORIZADO'::public.order_status
    end
  where id = p_order_id;
end;
$$;

create or replace function public.trg_recompute_on_match_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_invoice_status(old.invoice_id);
    perform public.recompute_order_facturado(old.authorized_order_id);
    return old;
  else
    perform public.recompute_invoice_status(new.invoice_id);
    perform public.recompute_order_facturado(new.authorized_order_id);
    return new;
  end if;
end;
$$;
