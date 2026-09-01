-- Entregas parciales: una OC (authorized_order) puede recibir N facturas.
--
-- Cambio de modelo respecto de 0003: antes una factura se conciliaba contra la
-- SUMA de una o varias OC (y cada OC se usaba una sola vez). Ahora es
-- 1 factura -> 1 OC, y una OC acumula el total de sus facturas en
-- `facturado_amount`. La OC se considera facturada cuando ese acumulado llega a
-- `total_price`; si lo supera por más de OVERBILL_TOLERANCE_PCT (%), la factura
-- que lo provoca queda REQUIERE_REVISION hasta que se apruebe la excepción.
--
-- La tolerancia se define acá y se espeja en lib/reconciliation.ts
-- (OVERBILL_TOLERANCE_PCT). A futuro puede pasar a config por empresa.

-- ---------------------------------------------------------------------------
-- 1. Esquema
-- ---------------------------------------------------------------------------

-- 1 factura -> 1 OC. (Los datos actuales ya son 1:1, no viola el unique nuevo.)
alter table public.invoice_order_matches
  drop constraint if exists invoice_order_matches_authorized_order_id_key;

alter table public.invoice_order_matches
  add constraint invoice_order_matches_invoice_id_key unique (invoice_id);

alter table public.authorized_orders
  add column facturado_amount numeric(14, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Reconciliación (reemplaza la versión de 0003_functions.sql)
-- ---------------------------------------------------------------------------

create or replace function public.recompute_invoice_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tolerance_pct constant numeric := 5;  -- espejo de OVERBILL_TOLERANCE_PCT
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

  -- Acumulado facturado de la OC = suma de los totales de sus facturas vinculadas.
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

-- Recalcular la OC también si se corrige el monto de una factura ya vinculada.
create or replace function public.trg_recompute_on_invoice_total_change()
returns trigger
language plpgsql
as $$
begin
  if new.total is distinct from old.total then
    perform public.recompute_invoice_status(new.id);
  end if;
  return new;
end;
$$;

create trigger trg_invoice_total_recompute
  after update on public.invoices
  for each row execute function public.trg_recompute_on_invoice_total_change();

-- ---------------------------------------------------------------------------
-- 3. Marcado apto/pagado: la OC sólo avanza cuando TODAS sus facturas lo hacen
--    y está completamente facturada.
-- ---------------------------------------------------------------------------

-- La OC pasa a APTO_PARA_PAGO / PAGADO sólo cuando toda su facturación llegó a
-- ese estado y el acumulado cubre el total. Si no, se mantiene en FACTURADO.
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
      when v_n > 0 and v_n_pagado = v_n and v_facturado >= v_order_total then 'PAGADO'
      when v_n > 0 and v_n_apto = v_n and v_facturado >= v_order_total then 'APTO_PARA_PAGO'
      when v_facturado >= v_order_total then 'FACTURADO'
      else 'AUTORIZADO'
    end
  where id = p_order_id;
end;
$$;

create or replace function public.mark_invoice_apto_para_pago(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.invoice_status;
  v_order_id uuid;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status not in ('MATCH', 'APROBADO_EXCEPCION') then
    raise exception 'La factura debe estar conciliada (MATCH) o aprobada por excepción antes de marcar apto para pago';
  end if;

  update public.invoices set status = 'APTO_PARA_PAGO' where id = p_invoice_id;

  select authorized_order_id into v_order_id
  from public.invoice_order_matches where invoice_id = p_invoice_id;

  perform public.sync_order_payment_status(v_order_id);
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
  v_order_id uuid;
begin
  select status into v_status from public.invoices where id = p_invoice_id;
  if v_status <> 'APTO_PARA_PAGO' then
    raise exception 'La factura debe estar APTO_PARA_PAGO antes de marcarla como pagada';
  end if;

  update public.invoices set status = 'PAGADO' where id = p_invoice_id;

  select authorized_order_id into v_order_id
  from public.invoice_order_matches where invoice_id = p_invoice_id;

  perform public.sync_order_payment_status(v_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------

update public.authorized_orders ao set facturado_amount = coalesce((
  select sum(i.total)
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = ao.id
), 0);

do $$
declare r record;
begin
  for r in select id from public.invoices loop
    perform public.recompute_invoice_status(r.id);
  end loop;
end $$;
