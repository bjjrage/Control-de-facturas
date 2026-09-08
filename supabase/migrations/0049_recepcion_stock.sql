-- Stock — Fase 3b: la recepción de una OC genera la entrada de stock.
--
-- Al registrar una recepción, cada línea recibida puede asociarse a un producto
-- de stock. El sistema genera una ENTRADA por esa cantidad, al precio unitario
-- de la OC, referenciada a la recepción (referencia_tipo = 'oc_recepcion').
-- Eliminar la recepción revierte esas entradas con una SALIDA equivalente.

alter table public.oc_recepcion_items
  add column if not exists producto_id uuid references public.productos(id) on delete set null;

create index if not exists idx_oc_recepcion_items_producto
  on public.oc_recepcion_items(producto_id);
