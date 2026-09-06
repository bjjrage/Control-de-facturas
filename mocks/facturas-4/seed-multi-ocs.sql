-- ===========================================================================
-- Mocks Facturas 4 — 3 OCs con 3 ítems cada una, para probar el parseo por ítem
-- ===========================================================================
-- empresa_id: bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd
-- profile_id: 83a3c4b5-d674-426c-8bf1-3d71d8351a59
--
-- Cada OC tiene filas en authorized_order_items. El encabezado de la OC
-- (product/quantity/unit_price/total_price) usa el primer ítem + el total
-- general, igual que hace createManualOrder.
--
-- Las facturas mock (mocks/facturas-4/pdfs/) usan NOMBRES DISTINTOS para los
-- mismos productos, a propósito, para probar el matching semántico del worker:
--   "Cemento Portland tipo I 50kg"  <->  "Cemento CP-40 x 50kg (bolsa)"
--   "Hierro construcción Ø12mm..."  <->  "Varilla corrugada Ø12 x 12m"
--   "Notebook Dell Latitude 15"..." <->  "Laptop Dell Latitude 5540 Core i5"
-- ===========================================================================

begin;

-- Idempotente: borrar si ya existían de una corrida anterior
delete from authorized_order_items where order_id in (
  'a1000010-0000-0000-0000-000000000010',
  'a1000011-0000-0000-0000-000000000011',
  'a1000012-0000-0000-0000-000000000012'
);
delete from authorized_orders where id in (
  'a1000010-0000-0000-0000-000000000010',
  'a1000011-0000-0000-0000-000000000011',
  'a1000012-0000-0000-0000-000000000012'
);

-- ---------------------------------------------------------------------------
-- OC-MULTI-001 — Distribuidora Central SA — materiales de obra (3 ítems)
--   1. Cemento Portland tipo I 50kg   100 bolsa  x 60.000  = 6.000.000
--   2. Hierro construcción Ø12mm 12m    40 barra  x 105.000 = 4.200.000
--   3. Arena lavada gruesa              20 m³     x 150.000 = 3.000.000
--   TOTAL: 13.200.000
-- ---------------------------------------------------------------------------
insert into authorized_orders
  (id, code, provider_id, provider_name, product, quantity, unit, unit_price, total_price, currency,
   vat_included, authorized_by, authorized_at, status, created_from, empresa_id, facturado_amount, project_id)
values
  ('a1000010-0000-0000-0000-000000000010', 'OC-MULTI-001',
   'f7ca6a13-a1df-4ace-8966-cc75fdce8dcc', 'Distribuidora Central SA',
   'Cemento Portland tipo I 50kg', 100, 'bolsa', 60000, 13200000, 'PYG',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59', now() - interval '12 days',
   'AUTORIZADO', 'manual', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0, null);

insert into authorized_order_items
  (order_id, empresa_id, product, quantity, unit, unit_price, total_price, sort_order)
values
  ('a1000010-0000-0000-0000-000000000010', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Cemento Portland tipo I 50kg', 100, 'bolsa', 60000, 6000000, 0),
  ('a1000010-0000-0000-0000-000000000010', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Hierro de construcción Ø12mm barra 12m', 40, 'barra', 105000, 4200000, 1),
  ('a1000010-0000-0000-0000-000000000010', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Arena lavada gruesa', 20, 'm³', 150000, 3000000, 2);

-- ---------------------------------------------------------------------------
-- OC-MULTI-002 — TechOffice SRL — equipamiento informático (3 ítems)
--   1. Notebook Dell Latitude 15" i5 16GB    5 unid x 5.000.000 = 25.000.000
--   2. Monitor LED 24" Full HD               8 unid x 1.200.000 =  9.600.000
--   3. Kit teclado + mouse inalámbrico      10 kit  x   170.000 =  1.700.000
--   TOTAL: 36.300.000
-- ---------------------------------------------------------------------------
insert into authorized_orders
  (id, code, provider_id, provider_name, product, quantity, unit, unit_price, total_price, currency,
   vat_included, authorized_by, authorized_at, status, created_from, empresa_id, facturado_amount, project_id)
values
  ('a1000011-0000-0000-0000-000000000011', 'OC-MULTI-002',
   '08bc12dd-3b05-477b-a449-ed176e1335e1', 'TechOffice SRL',
   'Notebook Dell Latitude 15" i5 16GB', 5, 'unid', 5000000, 36300000, 'PYG',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59', now() - interval '8 days',
   'AUTORIZADO', 'manual', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0, null);

insert into authorized_order_items
  (order_id, empresa_id, product, quantity, unit, unit_price, total_price, sort_order)
values
  ('a1000011-0000-0000-0000-000000000011', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Notebook Dell Latitude 15" i5 16GB', 5, 'unid', 5000000, 25000000, 0),
  ('a1000011-0000-0000-0000-000000000011', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Monitor LED 24" Full HD', 8, 'unid', 1200000, 9600000, 1),
  ('a1000011-0000-0000-0000-000000000011', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Kit teclado + mouse inalámbrico', 10, 'kit', 170000, 1700000, 2);

-- ---------------------------------------------------------------------------
-- OC-MULTI-003 — Muebles Modernos SA — mobiliario de oficina (3 ítems)
--   1. Escritorio ejecutivo en L 160x140     4 unid x 2.900.000 = 11.600.000
--   2. Silla ergonómica malla con apoyabrazos 10 unid x 1.500.000 = 15.000.000
--   3. Estante metálico 5 niveles 200x90      6 unid x   800.000 =  4.800.000
--   TOTAL: 31.400.000
-- ---------------------------------------------------------------------------
insert into authorized_orders
  (id, code, provider_id, provider_name, product, quantity, unit, unit_price, total_price, currency,
   vat_included, authorized_by, authorized_at, status, created_from, empresa_id, facturado_amount, project_id)
values
  ('a1000012-0000-0000-0000-000000000012', 'OC-MULTI-003',
   '0555cc88-a8db-4448-a14c-3b6843cad696', 'Muebles Modernos SA',
   'Escritorio ejecutivo en L 160x140', 4, 'unid', 2900000, 31400000, 'PYG',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59', now() - interval '6 days',
   'AUTORIZADO', 'manual', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0, null);

insert into authorized_order_items
  (order_id, empresa_id, product, quantity, unit, unit_price, total_price, sort_order)
values
  ('a1000012-0000-0000-0000-000000000012', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Escritorio ejecutivo en L 160x140', 4, 'unid', 2900000, 11600000, 0),
  ('a1000012-0000-0000-0000-000000000012', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Silla ergonómica malla con apoyabrazos', 10, 'unid', 1500000, 15000000, 1),
  ('a1000012-0000-0000-0000-000000000012', 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Estante metálico 5 niveles 200x90', 6, 'unid', 800000, 4800000, 2);

commit;

-- Verificación
select o.code, o.total_price, count(i.id) as items, sum(i.total_price) as suma_items
from authorized_orders o
left join authorized_order_items i on i.order_id = o.id
where o.code like 'OC-MULTI-%'
group by o.code, o.total_price
order by o.code;
