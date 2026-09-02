-- Rollback de 0017. Requiere que no haya OCs manuales/desde-factura vivas
-- (rfq_id / quote_version_id null), o el NOT NULL falla.
begin;

drop policy if exists authorized_orders_insert on public.authorized_orders;
create policy authorized_orders_insert on public.authorized_orders
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','admin']::public.user_role[]));

drop trigger if exists trg_authorized_orders_code on public.authorized_orders;
drop function if exists public.set_order_code();
drop sequence if exists public.order_code_seq;

alter table public.authorized_orders drop column if exists created_from;

alter table public.authorized_orders
  drop constraint if exists selection_reason_required_if_not_cheapest;
alter table public.authorized_orders
  add constraint selection_reason_required_if_not_cheapest
  check (is_cheapest = true or selection_reason is not null);

alter table public.authorized_orders alter column rfq_id set not null;
alter table public.authorized_orders alter column quote_version_id set not null;
alter table public.authorized_orders rename column code to rfq_code;

commit;
