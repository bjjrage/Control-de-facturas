?-- =============================================================================
-- seed-caterpillar-demo.sql
-- Datos de demo para testear todos los módulos del plan Caterpillar:
--   · Proyectos (presupuesto, ejecución, cronograma, compras, personal,
--     subcontratistas, certificados al comitente, avance físico)
--   · Stock / Inventario
--   · Recepción de mercadería
--
-- empresa_id : bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd
-- profile_id : 83a3c4b5-d674-426c-8bf1-3d71d8351a59
--
-- IDEMPOTENTE: usa INSERT ... ON CONFLICT DO NOTHING en tablas que tienen
-- unique constraints. Para el resto, limpia primero con DELETE WHERE id IN (...).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Asegurarse de que la empresa tiene plan caterpillar
-- -----------------------------------------------------------------------------
UPDATE public.empresas
   SET plan = 'caterpillar'
 WHERE id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd';

-- -----------------------------------------------------------------------------
-- 1. Proyectos
-- -----------------------------------------------------------------------------
INSERT INTO public.projects
  (id, empresa_id, name, code, client, location,
   start_date, end_date, status, budget_total,
   comitente, contract_number, contract_amount,
   plazo_dias, orden_inicio_date, anticipo_pct,
   devolucion_anticipo_pct, retencion_pct, iva_pct,
   created_by, created_at)
VALUES
  -- Proyecto 1: Obra activa con todos los módulos
  ('c1000001-0000-0000-0000-000000000001',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Edificio Residencial Norte',
   'PRY-2026-001',
   'Constructora Del Sur SA',
   'Asunción, PY',
   '2026-01-15', '2026-12-31',
   'ACTIVO', 185000000,
   'Ministerio de Obras Públicas',
   'CONTRATO-2025-4412',
   185000000,
   365, '2026-01-20',
   30, 40, 5, 10,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '7 months'),

  -- Proyecto 2: Obra más pequeña
  ('c1000002-0000-0000-0000-000000000002',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Local Comercial Centro',
   'PRY-2026-002',
   'Inversiones Centro SRL',
   'Encarnación, PY',
   '2026-03-01', '2026-09-30',
   'ACTIVO', 42000000,
   NULL, NULL, 42000000,
   180, '2026-03-05',
   20, 30, 5, 10,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '6 months'),

  -- Proyecto 3: Completado
  ('c1000003-0000-0000-0000-000000000003',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Nave Industrial Luque',
   'PRY-2025-009',
   'Industrias del Este SA',
   'Luque, PY',
   '2025-04-01', '2026-02-28',
   'COMPLETADO', 95000000,
   NULL, NULL, 95000000,
   300, '2025-04-10',
   25, 35, 5, 10,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '12 months')

ON CONFLICT (empresa_id, code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Budget items �?" Proyecto 1 (cómputo métrico / rubros)
-- -----------------------------------------------------------------------------
DELETE FROM public.budget_items
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.budget_items
  (id, project_id, parent_id, code, description, unit,
   quantity, unit_price, sort_order, start_date, end_date)
VALUES
  -- Rubro 1: Movimiento de suelos
  ('b1000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   NULL, '01', 'Movimiento de suelos', NULL,
   NULL, NULL, 10, '2026-01-20', '2026-02-28'),

  ('b1000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   'b1000001-0000-0000-0000-000000000001',
   '01.01', 'Excavación en terreno natural', 'm³',
   450, 85000, 20, '2026-01-20', '2026-02-15'),

  ('b1000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   'b1000001-0000-0000-0000-000000000001',
   '01.02', 'Relleno y compactación', 'm³',
   200, 55000, 30, '2026-02-10', '2026-02-28'),

  -- Rubro 2: Estructura
  ('b1000004-0000-0000-0000-000000000004',
   'c1000001-0000-0000-0000-000000000001',
   NULL, '02', 'Estructura de hormigón armado', NULL,
   NULL, NULL, 40, '2026-03-01', '2026-07-31'),

  ('b1000005-0000-0000-0000-000000000005',
   'c1000001-0000-0000-0000-000000000001',
   'b1000004-0000-0000-0000-000000000004',
   '02.01', 'Zapatas y vigas de fundación', 'm³',
   120, 420000, 50, '2026-03-01', '2026-04-15'),

  ('b1000006-0000-0000-0000-000000000006',
   'c1000001-0000-0000-0000-000000000001',
   'b1000004-0000-0000-0000-000000000004',
   '02.02', 'Columnas y vigas', 'm³',
   85, 480000, 60, '2026-04-01', '2026-06-30'),

  ('b1000007-0000-0000-0000-000000000007',
   'c1000001-0000-0000-0000-000000000001',
   'b1000004-0000-0000-0000-000000000004',
   '02.03', 'Losas de entrepiso', 'm³',
   95, 390000, 70, '2026-05-01', '2026-07-31'),

  -- Rubro 3: Mampostería
  ('b1000008-0000-0000-0000-000000000008',
   'c1000001-0000-0000-0000-000000000001',
   NULL, '03', 'Mampostería y revoques', NULL,
   NULL, NULL, 80, '2026-06-01', '2026-09-30'),

  ('b1000009-0000-0000-0000-000000000009',
   'c1000001-0000-0000-0000-000000000001',
   'b1000008-0000-0000-0000-000000000008',
   '03.01', 'Mampostería de ladrillo 0.15', 'm²',
   1200, 38000, 90, '2026-06-01', '2026-08-31'),

  ('b1000010-0000-0000-0000-000000000010',
   'c1000001-0000-0000-0000-000000000001',
   'b1000008-0000-0000-0000-000000000008',
   '03.02', 'Revoque grueso exterior', 'm²',
   980, 22000, 100, '2026-08-01', '2026-09-30');

-- Budget items �?" Proyecto 2 (más simple)
DELETE FROM public.budget_items
 WHERE project_id = 'c1000002-0000-0000-0000-000000000002';

INSERT INTO public.budget_items
  (id, project_id, parent_id, code, description, unit,
   quantity, unit_price, sort_order, start_date, end_date)
VALUES
  ('b2000001-0000-0000-0000-000000000001',
   'c1000002-0000-0000-0000-000000000002',
   NULL, '01', 'Obra civil general', NULL,
   NULL, NULL, 10, '2026-03-05', '2026-07-31'),

  ('b2000002-0000-0000-0000-000000000002',
   'c1000002-0000-0000-0000-000000000002',
   'b2000001-0000-0000-0000-000000000001',
   '01.01', 'Demolición y limpieza', 'global',
   1, 2500000, 20, '2026-03-05', '2026-03-20'),

  ('b2000003-0000-0000-0000-000000000003',
   'c1000002-0000-0000-0000-000000000002',
   'b2000001-0000-0000-0000-000000000001',
   '01.02', 'Estructura metálica', 'kg',
   8500, 4200, 30, '2026-04-01', '2026-06-30'),

  ('b2000004-0000-0000-0000-000000000004',
   'c1000002-0000-0000-0000-000000000002',
   'b2000001-0000-0000-0000-000000000001',
   '01.03', 'Terminaciones interiores', 'global',
   1, 12000000, 40, '2026-07-01', '2026-09-30');

-- -----------------------------------------------------------------------------
-- 3. Execution entries �?" avance real Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.execution_entries
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.execution_entries
  (id, project_id, budget_item_id, entry_date, quantity_executed, notes, recorded_by)
VALUES
  ('e1000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   'b1000002-0000-0000-0000-000000000002',
   '2026-01-25', 180, 'Excavación zona A y B completada', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   'b1000002-0000-0000-0000-000000000002',
   '2026-02-05', 270, 'Excavación zona C completada', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   'b1000003-0000-0000-0000-000000000003',
   '2026-02-20', 120, 'Relleno y compactación zona A', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000004-0000-0000-0000-000000000004',
   'c1000001-0000-0000-0000-000000000001',
   'b1000005-0000-0000-0000-000000000005',
   '2026-03-20', 45, 'Zapatas eje A-B hormigonadas', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000005-0000-0000-0000-000000000005',
   'c1000001-0000-0000-0000-000000000001',
   'b1000005-0000-0000-0000-000000000005',
   '2026-04-10', 55, 'Zapatas eje C-D hormigonadas', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000006-0000-0000-0000-000000000006',
   'c1000001-0000-0000-0000-000000000001',
   'b1000006-0000-0000-0000-000000000006',
   '2026-05-15', 40, 'Columnas planta baja completadas', '83a3c4b5-d674-426c-8bf1-3d71d8351a59');

-- -----------------------------------------------------------------------------
-- 4. Partes diarios de personal (mano de obra) �?" Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.daily_labor_entries
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.daily_labor_entries
  (id, project_id, entry_date, worker_name, hours, hourly_cost, task_description, recorded_by)
VALUES
  ('d1000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-01', 'Juan Martínez', 8, 45000, 'Armado de encofrado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-01', 'Pedro Romero', 8, 45000, 'Armado de encofrado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-01', 'Carlos Díaz', 8, 38000, 'Ayudante �?" acarreo de materiales', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000004-0000-0000-0000-000000000004',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-02', 'Juan Martínez', 8, 45000, 'Hormigonado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000005-0000-0000-0000-000000000005',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-02', 'Pedro Romero', 8, 45000, 'Hormigonado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000006-0000-0000-0000-000000000006',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-02', 'Carlos Díaz', 6, 38000, 'Limpieza y orden de obra', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000007-0000-0000-0000-000000000007',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-03', 'Mario González', 8, 52000, 'Capataz �?" supervisión general', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000008-0000-0000-0000-000000000008',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-03', 'Juan Martínez', 8, 45000, 'Armado losa entrepiso P2-P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59');

-- -----------------------------------------------------------------------------
-- 5. Subcontratistas (catálogo de la empresa)
-- -----------------------------------------------------------------------------
INSERT INTO public.subcontractors
  (id, empresa_id, name, ruc, contact_name, contact_phone, specialty)
VALUES
  ('e1000001-0000-0000-0000-000000000001',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Electricidad Total SRL', '80-123456-7',
   'Roberto Acosta', '0981-234567', 'Instalaciones eléctricas'),

  ('e1000002-0000-0000-0000-000000000002',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Plomería y Sanitarios SA', '80-234567-8',
   'Luis Benítez', '0982-345678', 'Plomería y sanitarios'),

  ('e1000003-0000-0000-0000-000000000003',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Pintura Pro Paraguay', '80-345678-9',
   'Ana López', '0983-456789', 'Pintura y revestimientos')

ON CONFLICT (empresa_id, ruc) WHERE ruc IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Contratos de subcontratistas �?" Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.subcontractor_contracts
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.subcontractor_contracts
  (id, project_id, subcontractor_id, budget_item_id,
   contracted_amount, retention_pct, description, signed_date, status, public_token)
VALUES
  ('ca000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   'e1000001-0000-0000-0000-000000000001',
   NULL,
   18500000, 5.00,
   'Instalación eléctrica completa �?" Edificio Residencial Norte',
   '2026-03-01', 'ACTIVO',
   'fb000001-0000-0000-0000-000000000001'),

  ('ca000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   'e1000002-0000-0000-0000-000000000002',
   NULL,
   12800000, 5.00,
   'Instalación sanitaria y plomería �?" Edificio Residencial Norte',
   '2026-04-01', 'ACTIVO',
   'fb000002-0000-0000-0000-000000000002');

-- -----------------------------------------------------------------------------
-- 7. Certificados de subcontratistas �?" Contrato 1 (Electricidad)
-- -----------------------------------------------------------------------------
DELETE FROM public.subcontractor_certificates
 WHERE contract_id = 'ca000001-0000-0000-0000-000000000001';

INSERT INTO public.subcontractor_certificates
  (id, contract_id, project_id, certificate_number,
   submitted_at, period_start, period_end,
   claimed_pct, claimed_amount, approved_pct, approved_amount,
   retention_pct, status, notes)
VALUES
  ('ac000001-0000-0000-0000-000000000001',
   'ca000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   1,
   now() - interval '60 days',
   '2026-04-01', '2026-04-30',
   30, 5550000, 30, 5550000,
   5.00, 'APROBADO',
   'Montaje de tableros y cañerías planta baja'),

  ('ac000002-0000-0000-0000-000000000002',
   'ca000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   2,
   now() - interval '30 days',
   '2026-05-01', '2026-05-31',
   35, 6475000, 35, 6475000,
   5.00, 'APROBADO',
   'Tendido de cableado estructura y entrepiso'),

  ('ac000003-0000-0000-0000-000000000003',
   'ca000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   3,
   now() - interval '5 days',
   '2026-06-01', '2026-06-30',
   20, 3700000, NULL, NULL,
   5.00, 'PENDIENTE',
   'Conexión de luminarias planta alta');

-- -----------------------------------------------------------------------------
-- 8. Certificados de ejecución al comitente �?" Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.project_certificate_items
 WHERE certificate_id IN (
   SELECT id FROM public.project_certificates
    WHERE project_id = 'c1000001-0000-0000-0000-000000000001'
 );
DELETE FROM public.project_certificates
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.project_certificates
  (id, project_id, numero, period_start, period_end, status,
   monto_anterior, monto_presente, created_at)
VALUES
  ('bc000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   1,
   '2026-01-20', '2026-02-28',
   'CERRADO',
   0, 28250000,
   now() - interval '6 months'),

  ('bc000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   2,
   '2026-03-01', '2026-04-30',
   'CERRADO',
   28250000, 42300000,
   now() - interval '4 months'),

  ('bc000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   3,
   '2026-05-01', '2026-06-30',
   'BORRADOR',
   70550000, 19200000,
   now() - interval '30 days');

INSERT INTO public.project_certificate_items
  (id, certificate_id, budget_item_id, description, unit, unit_price,
   qty_anterior, qty_presente, qty_acumulada)
VALUES
  -- Cert 1: Excavación
  ('b1000001-0000-0000-0000-000000000001',
   'bc000001-0000-0000-0000-000000000001',
   'b1000002-0000-0000-0000-000000000002',
   'Excavación en terreno natural', 'm³', 85000,
   0, 180, 180),

  ('b1000002-0000-0000-0000-000000000002',
   'bc000001-0000-0000-0000-000000000001',
   'b1000003-0000-0000-0000-000000000003',
   'Relleno y compactación', 'm³', 55000,
   0, 120, 120),

  -- Cert 2: Zapatas
  ('b1000003-0000-0000-0000-000000000003',
   'bc000002-0000-0000-0000-000000000002',
   'b1000002-0000-0000-0000-000000000002',
   'Excavación en terreno natural', 'm³', 85000,
   180, 270, 450),

  ('b1000004-0000-0000-0000-000000000004',
   'bc000002-0000-0000-0000-000000000002',
   'b1000005-0000-0000-0000-000000000005',
   'Zapatas y vigas de fundación', 'm³', 420000,
   0, 45, 45),

  -- Cert 3 (borrador)
  ('b1000005-0000-0000-0000-000000000005',
   'bc000003-0000-0000-0000-000000000003',
   'b1000005-0000-0000-0000-000000000005',
   'Zapatas y vigas de fundación', 'm³', 420000,
   45, 55, 100),

  ('b1000006-0000-0000-0000-000000000006',
   'bc000003-0000-0000-0000-000000000003',
   'b1000006-0000-0000-0000-000000000006',
   'Columnas y vigas', 'm³', 480000,
   0, 40, 40);

-- -----------------------------------------------------------------------------
-- 9. Stock de productos
-- -----------------------------------------------------------------------------
INSERT INTO public.productos
  (id, empresa_id, nombre, descripcion, unidad, sku,
   stock_actual, stock_minimo, contenido_por_unidad, unidad_base, activo, created_by)
VALUES
  ('b2000001-0000-0000-0000-000000000001',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Cemento Portland 50kg',
   'Bolsa de cemento portland tipo I, resistencia 420 kg/cm²',
   'bolsa', 'CEM-50KG',
   120, 20,
   50, 'kg',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('b2000002-0000-0000-0000-000000000002',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Hierro 10mm barra 12m',
   'Barra de hierro de construcción nervurado 10mm �- 12m',
   'unidad', 'HIE-10-12',
   85, 15,
   NULL, NULL,
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('b2000003-0000-0000-0000-000000000003',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Arena gruesa',
   'Arena de río para mezclas de hormigón',
   'm³', 'ARE-GRU',
   18, 5,
   NULL, NULL,
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('b2000004-0000-0000-0000-000000000004',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Ladrillo hueco 15cm',
   'Ladrillo cerámico hueco 15�-20�-30cm',
   'unidad', 'LAD-15',
   2400, 500,
   NULL, NULL,
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('b2000005-0000-0000-0000-000000000005',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Pintura látex interior 20lt',
   'Pintura látex interior lavable blanca bidón 20 litros',
   'bidón', 'PIN-LAT-20',
   14, 3,
   20, 'lt',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('b2000006-0000-0000-0000-000000000006',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Caño de PVC 110mm (barra 3m)',
   'Caño sanitario PVC �~110mm �- 3m',
   'unidad', 'CAP-PVC-110',
   30, 10,
   NULL, NULL,
   false, '83a3c4b5-d674-426c-8bf1-3d71d8351a59')

ON CONFLICT (empresa_id, sku) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10. Verificación rápida �?" cantidad de registros insertados
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM public.projects
    WHERE empresa_id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd'
      AND code LIKE 'PRY-202%') AS proyectos,
  (SELECT COUNT(*) FROM public.budget_items
    WHERE project_id IN ('c1000001-0000-0000-0000-000000000001',
                         'c1000002-0000-0000-0000-000000000002')) AS budget_items,
  (SELECT COUNT(*) FROM public.execution_entries
    WHERE project_id = 'c1000001-0000-0000-0000-000000000001') AS execution_entries,
  (SELECT COUNT(*) FROM public.daily_labor_entries
    WHERE project_id = 'c1000001-0000-0000-0000-000000000001') AS labor_entries,
  (SELECT COUNT(*) FROM public.subcontractors
    WHERE empresa_id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd') AS subcontratistas,
  (SELECT COUNT(*) FROM public.subcontractor_contracts
    WHERE project_id = 'c1000001-0000-0000-0000-000000000001') AS contratos,
  (SELECT COUNT(*) FROM public.subcontractor_certificates
    WHERE project_id = 'c1000001-0000-0000-0000-000000000001') AS certs_sub,
  (SELECT COUNT(*) FROM public.project_certificates
    WHERE project_id = 'c1000001-0000-0000-0000-000000000001') AS certs_comitente,
  (SELECT COUNT(*) FROM public.productos
    WHERE empresa_id = 'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd') AS productos;



