-- B11: serialize resource tenant/authority checks with reconciliation and human approval.
-- Definitions and business calculations unchanged except resource row locking.
BEGIN;
CREATE OR REPLACE FUNCTION public.mark_invoice_apto_para_pago(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.invoice_status;
  v_order_id uuid;
begin

  perform private.b11_require_financial_actor((select empresa_id from public.invoices where id=p_invoice_id for update));
  select status into v_status from public.invoices where id = p_invoice_id for update;
  if v_status not in ('MATCH', 'APROBADO_EXCEPCION') then
    raise exception 'La factura debe estar conciliada (MATCH) o aprobada por excepción antes de marcar apto para pago';
  end if;

  update public.invoices set status = 'APTO_PARA_PAGO' where id = p_invoice_id;

  select authorized_order_id into v_order_id
  from public.invoice_order_matches where invoice_id = p_invoice_id;

  perform public.sync_order_payment_status(v_order_id);
end;
$function$;
CREATE OR REPLACE FUNCTION public.recompute_invoice_status(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tolerance_pct constant numeric := 5;  -- espejo de OVERBILL_TOLERANCE_PCT
  v_current_status public.invoice_status;
  v_order_id uuid;
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_has_exception boolean;
begin

  perform private.b11_require_financial_actor((select empresa_id from public.invoices where id=p_invoice_id for update));
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
$function$;
CREATE OR REPLACE FUNCTION public.recompute_order_facturado(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
begin
  if p_order_id is null then return; end if;

  perform private.b11_require_financial_actor((select empresa_id from public.authorized_orders where id=p_order_id for update));
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
$function$;
CREATE OR REPLACE FUNCTION public.sync_order_payment_status(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_n int;
  v_n_apto int;
  v_n_pagado int;
begin
  if p_order_id is null then return; end if;

  perform private.b11_require_financial_actor((select empresa_id from public.authorized_orders where id=p_order_id for update));
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
$function$;
COMMIT;
