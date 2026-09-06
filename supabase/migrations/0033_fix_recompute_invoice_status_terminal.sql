-- Fix: recompute_invoice_status pisaba facturas ya APTO_PARA_PAGO / PAGADO
-- volviéndolas a MATCH. Pasaba cada vez que se disparaba trg_iom_recompute
-- (insert/update/delete en invoice_order_matches) por CUALQUIER motivo — p.ej.
-- vincular otra factura a la misma OC — sin importar que la factura afectada
-- ya tuviera una OP emitida. La versión de authorized_orders ya protegía
-- estos estados terminales (0013_partial_deliveries.sql línea 65); a la de
-- invoices le faltaba el mismo guard.

create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tolerance_pct constant numeric := 5;  -- espejo de OVERBILL_TOLERANCE_PCT
  v_current_status public.invoice_status;
  v_order_id uuid;
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_has_exception boolean;
begin
  select status into v_current_status from public.invoices where id = p_invoice_id;

  -- Una vez que una acción humana marcó la factura apta para pago (o ya se
  -- pagó), el recálculo automático de conciliación no debe revertirla.
  if v_current_status in ('APTO_PARA_PAGO', 'PAGADO') then
    return;
  end if;

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
          when v_facturado >= v_order_total then 'FACTURADO'
          else 'AUTORIZADO'
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
