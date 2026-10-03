-- Recepción de mercadería — registra que los bienes de una OC llegaron físicamente.
-- Prerequisito para marcar facturas como apta para pago.

create table if not exists public.oc_recepciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  order_id      uuid not null references public.authorized_orders(id) on delete cascade,
  fecha         date not null,
  recibido_por  text not null,
  notas         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.oc_recepcion_items (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas(id) on delete cascade,
  recepcion_id       uuid not null references public.oc_recepciones(id) on delete cascade,
  order_item_id      uuid not null references public.authorized_order_items(id) on delete cascade,
  cantidad_recibida  numeric(18,2) not null check (cantidad_recibida > 0),
  notas              text,
  created_at         timestamptz default now()
);

create index idx_oc_recepciones_order   on public.oc_recepciones(order_id);
create index idx_oc_recepciones_empresa on public.oc_recepciones(empresa_id);
create index idx_oc_recepcion_items_rec on public.oc_recepcion_items(recepcion_id);

-- Vista auxiliar: cantidad total recibida por order_item
create or replace view public.oc_order_item_recibido as
select
  ri.order_item_id,
  ri.empresa_id,
  sum(ri.cantidad_recibida) as cantidad_recibida_total
from public.oc_recepcion_items ri
group by ri.order_item_id, ri.empresa_id;

-- RLS
alter table public.oc_recepciones     enable row level security;
alter table public.oc_recepcion_items enable row level security;

create policy "select oc_recepciones"
  on public.oc_recepciones for select
  using (empresa_id = public.current_empresa_id());

create policy "insert oc_recepciones"
  on public.oc_recepciones for insert
  with check (empresa_id = public.current_empresa_id());

create policy "delete oc_recepciones"
  on public.oc_recepciones for delete
  using (empresa_id = public.current_empresa_id());

create policy "select oc_recepcion_items"
  on public.oc_recepcion_items for select
  using (empresa_id = public.current_empresa_id());

create policy "insert oc_recepcion_items"
  on public.oc_recepcion_items for insert
  with check (empresa_id = public.current_empresa_id());
