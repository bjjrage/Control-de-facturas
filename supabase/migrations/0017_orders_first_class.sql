-- Órdenes de compra como concepto de primera clase.
--
-- Antes toda OC nacía de una RFQ (rfq_id / quote_version_id NOT NULL). Ahora la
-- RFQ es una forma de generar una OC, no la única: se pueden crear a mano o
-- desde una factura ya recibida.

-- rfq_code -> code: es el código de la ORDEN. Las de RFQ llevan el código de la
-- RFQ; las manuales reciben 'OC-YYYY-NNNN' por trigger.
alter table public.authorized_orders rename column rfq_code to code;

alter table public.authorized_orders alter column rfq_id drop not null;
alter table public.authorized_orders alter column quote_version_id drop not null;

alter table public.authorized_orders
  drop constraint if exists selection_reason_required_if_not_cheapest;
alter table public.authorized_orders
  add constraint selection_reason_required_if_not_cheapest
  check (rfq_id is null or is_cheapest or selection_reason is not null);

alter table public.authorized_orders
  add column created_from text not null default 'rfq'
  check (created_from in ('rfq', 'manual', 'invoice'));

create sequence public.order_code_seq start 1;

create or replace function public.set_order_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code is null then
    new.code := 'OC-' || to_char(now(), 'YYYY') || '-' ||
                lpad(nextval('public.order_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger trg_authorized_orders_code before insert on public.authorized_orders
  for each row execute function public.set_order_code();

-- RLS: administración también crea OCs (manuales / desde factura).
drop policy if exists authorized_orders_insert on public.authorized_orders;
create policy authorized_orders_insert on public.authorized_orders
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));
