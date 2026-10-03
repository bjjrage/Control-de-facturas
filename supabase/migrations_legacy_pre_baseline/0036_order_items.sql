-- Líneas de detalle en OCs y facturas.
--
-- authorized_order_items: los ítems de una OC (producto, qty, precio por línea).
-- invoice_items:          los ítems extraídos de una factura por el AI.
-- invoice_item_matches:   qué línea de factura corresponde a qué línea de OC
--                         y con qué cantidad entregada.
--
-- La OC sigue teniendo product/quantity/unit_price/total_price a nivel de
-- encabezado para backward-compat (listas, filtros, etcétera).  Los ítems son
-- el detalle; si una OC no tiene filas en authorized_order_items se comporta
-- exactamente igual que antes.

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------

create table public.authorized_order_items (
  id            uuid           primary key default gen_random_uuid(),
  order_id      uuid           not null references public.authorized_orders(id) on delete cascade,
  empresa_id    uuid           not null references public.empresas(id),
  product       text           not null,
  quantity      numeric(14,2)  not null check (quantity > 0),
  unit          text           not null,
  unit_price    numeric(14,4)  not null check (unit_price >= 0),
  total_price   numeric(14,2)  not null check (total_price > 0),
  quantity_invoiced numeric(14,2) not null default 0,
  sort_order    integer        not null default 0,
  created_at    timestamptz    not null default now()
);

create table public.invoice_items (
  id                  uuid           primary key default gen_random_uuid(),
  invoice_id          uuid           not null references public.invoices(id) on delete cascade,
  empresa_id          uuid           not null references public.empresas(id),
  product_description text           not null,
  quantity            numeric(14,2),
  unit                text,
  unit_price          numeric(14,4),
  subtotal            numeric(14,2),
  sort_order          integer        not null default 0,
  created_at          timestamptz    not null default now()
);

create table public.invoice_item_matches (
  id               uuid           primary key default gen_random_uuid(),
  invoice_item_id  uuid           not null references public.invoice_items(id) on delete cascade,
  order_item_id    uuid           not null references public.authorized_order_items(id),
  empresa_id       uuid           not null references public.empresas(id),
  quantity_matched numeric(14,2)  not null check (quantity_matched > 0),
  created_at       timestamptz    not null default now(),
  unique (invoice_item_id, order_item_id)
);

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------

create index idx_order_items_order     on public.authorized_order_items(order_id);
create index idx_order_items_empresa   on public.authorized_order_items(empresa_id);
create index idx_invoice_items_invoice on public.invoice_items(invoice_id);
create index idx_invoice_item_matches_item  on public.invoice_item_matches(invoice_item_id);
create index idx_invoice_item_matches_order on public.invoice_item_matches(order_item_id);

-- ---------------------------------------------------------------------------
-- 3. Trigger: quantity_invoiced se mantiene actualizado automáticamente
-- ---------------------------------------------------------------------------

create or replace function public.recompute_order_item_quantity_invoiced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  v_item_id := coalesce(new.order_item_id, old.order_item_id);

  update public.authorized_order_items
  set quantity_invoiced = (
    select coalesce(sum(quantity_matched), 0)
    from public.invoice_item_matches
    where order_item_id = v_item_id
  )
  where id = v_item_id;

  return coalesce(new, old);
end;
$$;

create trigger trg_recompute_order_item_qty
  after insert or update or delete on public.invoice_item_matches
  for each row execute function public.recompute_order_item_quantity_invoiced();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

alter table public.authorized_order_items  enable row level security;
alter table public.invoice_items           enable row level security;
alter table public.invoice_item_matches    enable row level security;

-- authorized_order_items
create policy aoi_select on public.authorized_order_items
  for select using (empresa_id = public.current_empresa_id());

create policy aoi_insert on public.authorized_order_items
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[]));

create policy aoi_update on public.authorized_order_items
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

create policy aoi_delete on public.authorized_order_items
  for delete using (empresa_id = public.current_empresa_id());

-- invoice_items (el worker usa service_role, no RLS; estas policies son para el front)
create policy ii_select on public.invoice_items
  for select using (empresa_id = public.current_empresa_id());

create policy ii_insert on public.invoice_items
  for insert with check (empresa_id = public.current_empresa_id());

create policy ii_delete on public.invoice_items
  for delete using (empresa_id = public.current_empresa_id());

-- invoice_item_matches
create policy iim_select on public.invoice_item_matches
  for select using (empresa_id = public.current_empresa_id());

create policy iim_insert on public.invoice_item_matches
  for insert with check (empresa_id = public.current_empresa_id());

create policy iim_delete on public.invoice_item_matches
  for delete using (empresa_id = public.current_empresa_id());
