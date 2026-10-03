-- Categorías / rubros de producto para el módulo de Stock.
-- Permite agrupar el inventario (Áridos, Cemento, Hierro, Eléctrico, EPP, etc.)
-- para que la lista deje de ser un scroll interminable y se pueda filtrar.

create table if not exists public.categorias_producto (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nombre     text not null,
  orden      integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (empresa_id, nombre)
);

create index if not exists idx_categorias_producto_empresa
  on public.categorias_producto(empresa_id, orden, nombre);

-- Los productos sin categoría quedan en "Sin categoría" (categoria_id null).
-- on delete set null: borrar una categoría no borra sus productos.
alter table public.productos
  add column if not exists categoria_id uuid references public.categorias_producto(id) on delete set null;

create index if not exists idx_productos_categoria on public.productos(categoria_id);

-- RLS — mismo criterio que productos (0043): scoped por empresa, sin filtro de rol.
alter table public.categorias_producto enable row level security;

create policy "select categorias_producto"
  on public.categorias_producto for select
  using (empresa_id = public.current_empresa_id());

create policy "insert categorias_producto"
  on public.categorias_producto for insert
  with check (empresa_id = public.current_empresa_id());

create policy "update categorias_producto"
  on public.categorias_producto for update
  using (empresa_id = public.current_empresa_id());

create policy "delete categorias_producto"
  on public.categorias_producto for delete
  using (empresa_id = public.current_empresa_id());
