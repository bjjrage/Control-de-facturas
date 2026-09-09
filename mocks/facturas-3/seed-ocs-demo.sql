-- 5 OCs demo + 6 facturas mock
-- empresa_id: bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd
-- profile_id:  83a3c4b5-d674-426c-8bf1-3d71d8351a59

INSERT INTO authorized_orders
  (id, code, provider_id, provider_name, product, quantity, unit, unit_price, total_price, currency,
   vat_included, authorized_by, authorized_at, status, created_from, empresa_id, facturado_amount, project_id)
VALUES
  -- OC-DEMO-011: CoolTech SRL → 1 factura (de 2 pendientes)
  ('a1000001-0000-0000-0000-000000000001',
   'OC-DEMO-011',
   'eaf80539-5e2f-4301-ab3f-91676451806c',
   'CoolTech SRL',
   'Notebooks y accesorios informáticos',
   5, 'unid', 2970000, 14850000, 'PYG',
   true,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '15 days',
   'AUTORIZADO', 'manual',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0,
   'eb1596dc-6f81-400e-8f17-09d8af0cb559'),

  -- OC-DEMO-012: Distribuidora Central SA → 1 factura (parcial)
  ('a1000002-0000-0000-0000-000000000002',
   'OC-DEMO-012',
   'f7ca6a13-a1df-4ace-8966-cc75fdce8dcc',
   'Distribuidora Central SA',
   'Materiales de construcción y ferretería',
   1, 'lote', 9240000, 9240000, 'PYG',
   true,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '20 days',
   'AUTORIZADO', 'manual',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0,
   '2d20b346-8459-4c59-8464-5525f4fa394f'),

  -- OC-DEMO-013: Limpieza Pro SA → 1 factura (parcial)
  ('a1000003-0000-0000-0000-000000000003',
   'OC-DEMO-013',
   '7f9803c4-431a-4fee-ad86-2bf4a4786f80',
   'Limpieza Pro SA',
   'Servicio de limpieza industrial — contrato 6 meses',
   6, 'mes', 1283333, 7700000, 'PYG',
   true,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '30 days',
   'AUTORIZADO', 'manual',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0,
   '88270a3d-a323-41b2-ad4c-33878adf9ae1'),

  -- OC-DEMO-014: Muebles Modernos SA → 1 factura (parcial)
  ('a1000004-0000-0000-0000-000000000004',
   'OC-DEMO-014',
   '0555cc88-a8db-4448-a14c-3b6843cad696',
   'Muebles Modernos SA',
   'Mobiliario de oficina: escritorios, sillas y estantes',
   1, 'lote', 28600000, 28600000, 'PYG',
   true,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '10 days',
   'AUTORIZADO', 'manual',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0,
   '430a38e9-d6c1-46a6-8435-1198964ae974'),

  -- OC-DEMO-015: TechOffice SRL → 2 facturas
  ('a1000005-0000-0000-0000-000000000005',
   'OC-DEMO-015',
   '08bc12dd-3b05-477b-a449-ed176e1335e1',
   'TechOffice SRL',
   'Insumos de oficina y papelería — suministro trimestral',
   1, 'lote', 19800000, 19800000, 'PYG',
   true,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '25 days',
   'AUTORIZADO', 'manual',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd', 0,
   'eb1596dc-6f81-400e-8f17-09d8af0cb559');
