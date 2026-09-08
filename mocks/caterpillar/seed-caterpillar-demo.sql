-- =============================================================================
-- seed-caterpillar-demo.sql
-- Datos de demo para testear todos los mÃ³dulos del plan Caterpillar:
--   Â· Proyectos (presupuesto, ejecuciÃ³n, cronograma, compras, personal,
--     subcontratistas, certificados al comitente, avance fÃ­sico)
--   Â· Stock / Inventario
--   Â· RecepciÃ³n de mercaderÃ­a
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
  -- Proyecto 1: Obra activa con todos los mÃ³dulos
  ('c1000001-0000-0000-0000-000000000001',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Edificio Residencial Norte',
   'PRY-2026-001',
   'Constructora Del Sur SA',
   'AsunciÃ³n, PY',
   '2026-01-15', '2026-12-31',
   'ACTIVO', 185000000,
   'Ministerio de Obras PÃºblicas',
   'CONTRATO-2025-4412',
   185000000,
   365, '2026-01-20',
   30, 40, 5, 10,
   '83a3c4b5-d674-426c-8bf1-3d71d8351a59',
   now() - interval '7 months'),

  -- Proyecto 2: Obra mÃ¡s pequeÃ±a
  ('c1000002-0000-0000-0000-000000000002',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Local Comercial Centro',
   'PRY-2026-002',
   'Inversiones Centro SRL',
   'EncarnaciÃ³n, PY',
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
-- 2. Budget items â€” Proyecto 1 (cÃ³mputo mÃ©trico / rubros)
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
   '01.01', 'ExcavaciÃ³n en terreno natural', 'mÂ³',
   450, 85000, 20, '2026-01-20', '2026-02-15'),

  ('b1000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   'b1000001-0000-0000-0000-000000000001',
   '01.02', 'Relleno y compactaciÃ³n', 'mÂ³',
   200, 55000, 30, '2026-02-10', '2026-02-28'),

  -- Rubro 2: Estructura
  ('b1000004-0000-0000-0000-000000000004',
   'c1000001-0000-0000-0000-000000000001',
   NULL, '02', 'Estructura de hormigÃ³n armado', NULL,
   NULL, NULL, 40, '2026-03-01', '2026-07-31'),

  ('b1000005-0000-0000-0000-000000000005',
   'c1000001-0000-0000-0000-000000000001',
   'b1000004-0000-0000-0000-000000000004',
   '02.01', 'Zapatas y vigas de fundaciÃ³n', 'mÂ³',
   120, 420000, 50, '2026-03-01', '2026-04-15'),

  ('b1000006-0000-0000-0000-000000000006',
   'c1000001-0000-0000-0000-000000000001',
   'b1000004-0000-0000-0000-000000000004',
   '02.02', 'Columnas y vigas', 'mÂ³',
   85, 480000, 60, '2026-04-01', '2026-06-30'),

  ('b1000007-0000-0000-0000-000000000007',
   'c1000001-0000-0000-0000-000000000001',
   'b1000004-0000-0000-0000-000000000004',
   '02.03', 'Losas de entrepiso', 'mÂ³',
   95, 390000, 70, '2026-05-01', '2026-07-31'),

  -- Rubro 3: MamposterÃ­a
  ('b1000008-0000-0000-0000-000000000008',
   'c1000001-0000-0000-0000-000000000001',
   NULL, '03', 'MamposterÃ­a y revoques', NULL,
   NULL, NULL, 80, '2026-06-01', '2026-09-30'),

  ('b1000009-0000-0000-0000-000000000009',
   'c1000001-0000-0000-0000-000000000001',
   'b1000008-0000-0000-0000-000000000008',
   '03.01', 'MamposterÃ­a de ladrillo 0.15', 'mÂ²',
   1200, 38000, 90, '2026-06-01', '2026-08-31'),

  ('b1000010-0000-0000-0000-000000000010',
   'c1000001-0000-0000-0000-000000000001',
   'b1000008-0000-0000-0000-000000000008',
   '03.02', 'Revoque grueso exterior', 'mÂ²',
   980, 22000, 100, '2026-08-01', '2026-09-30');

-- Budget items â€” Proyecto 2 (mÃ¡s simple)
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
   '01.01', 'DemoliciÃ³n y limpieza', 'global',
   1, 2500000, 20, '2026-03-05', '2026-03-20'),

  ('b2000003-0000-0000-0000-000000000003',
   'c1000002-0000-0000-0000-000000000002',
   'b2000001-0000-0000-0000-000000000001',
   '01.02', 'Estructura metÃ¡lica', 'kg',
   8500, 4200, 30, '2026-04-01', '2026-06-30'),

  ('b2000004-0000-0000-0000-000000000004',
   'c1000002-0000-0000-0000-000000000002',
   'b2000001-0000-0000-0000-000000000001',
   '01.03', 'Terminaciones interiores', 'global',
   1, 12000000, 40, '2026-07-01', '2026-09-30');

-- -----------------------------------------------------------------------------
-- 3. Execution entries â€” avance real Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.execution_entries
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.execution_entries
  (id, project_id, budget_item_id, entry_date, quantity_executed, notes, recorded_by)
VALUES
  ('e1000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   'b1000002-0000-0000-0000-000000000002',
   '2026-01-25', 180, 'ExcavaciÃ³n zona A y B completada', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   'b1000002-0000-0000-0000-000000000002',
   '2026-02-05', 270, 'ExcavaciÃ³n zona C completada', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('e1000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   'b1000003-0000-0000-0000-000000000003',
   '2026-02-20', 120, 'Relleno y compactaciÃ³n zona A', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

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
-- 4. Partes diarios de personal (mano de obra) â€” Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.daily_labor_entries
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.daily_labor_entries
  (id, project_id, entry_date, worker_name, hours, hourly_cost, task_description, recorded_by)
VALUES
  ('d1000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-01', 'Juan MartÃ­nez', 8, 45000, 'Armado de encofrado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-01', 'Pedro Romero', 8, 45000, 'Armado de encofrado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000003-0000-0000-0000-000000000003',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-01', 'Carlos DÃ­az', 8, 38000, 'Ayudante â€” acarreo de materiales', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000004-0000-0000-0000-000000000004',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-02', 'Juan MartÃ­nez', 8, 45000, 'Hormigonado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000005-0000-0000-0000-000000000005',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-02', 'Pedro Romero', 8, 45000, 'Hormigonado columnas P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000006-0000-0000-0000-000000000006',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-02', 'Carlos DÃ­az', 6, 38000, 'Limpieza y orden de obra', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000007-0000-0000-0000-000000000007',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-03', 'Mario GonzÃ¡lez', 8, 52000, 'Capataz â€” supervisiÃ³n general', '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('d1000008-0000-0000-0000-000000000008',
   'c1000001-0000-0000-0000-000000000001',
   '2026-09-03', 'Juan MartÃ­nez', 8, 45000, 'Armado losa entrepiso P2-P3', '83a3c4b5-d674-426c-8bf1-3d71d8351a59');

-- -----------------------------------------------------------------------------
-- 5. Subcontratistas (catÃ¡logo de la empresa)
-- -----------------------------------------------------------------------------
INSERT INTO public.subcontractors
  (id, empresa_id, name, ruc, contact_name, contact_phone, specialty)
VALUES
  ('s1000001-0000-0000-0000-000000000001',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Electricidad Total SRL', '80-123456-7',
   'Roberto Acosta', '0981-234567', 'Instalaciones elÃ©ctricas'),

  ('s1000002-0000-0000-0000-000000000002',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'PlomerÃ­a y Sanitarios SA', '80-234567-8',
   'Luis BenÃ­tez', '0982-345678', 'PlomerÃ­a y sanitarios'),

  ('s1000003-0000-0000-0000-000000000003',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Pintura Pro Paraguay', '80-345678-9',
   'Ana LÃ³pez', '0983-456789', 'Pintura y revestimientos')

ON CONFLICT (empresa_id, ruc) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Contratos de subcontratistas â€” Proyecto 1
-- -----------------------------------------------------------------------------
DELETE FROM public.subcontractor_contracts
 WHERE project_id = 'c1000001-0000-0000-0000-000000000001';

INSERT INTO public.subcontractor_contracts
  (id, project_id, subcontractor_id, budget_item_id,
   contracted_amount, retention_pct, description, signed_date, status, public_token)
VALUES
  ('ct000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   's1000001-0000-0000-0000-000000000001',
   NULL,
   18500000, 5.00,
   'InstalaciÃ³n elÃ©ctrica completa â€” Edificio Residencial Norte',
   '2026-03-01', 'ACTIVO',
   'tk000001-0000-0000-0000-000000000001'),

  ('ct000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   's1000002-0000-0000-0000-000000000002',
   NULL,
   12800000, 5.00,
   'InstalaciÃ³n sanitaria y plomerÃ­a â€” Edificio Residencial Norte',
   '2026-04-01', 'ACTIVO',
   'tk000002-0000-0000-0000-000000000002');

-- -----------------------------------------------------------------------------
-- 7. Certificados de subcontratistas â€” Contrato 1 (Electricidad)
-- -----------------------------------------------------------------------------
DELETE FROM public.subcontractor_certificates
 WHERE contract_id = 'ct000001-0000-0000-0000-000000000001';

INSERT INTO public.subcontractor_certificates
  (id, contract_id, project_id, certificate_number,
   submitted_at, period_start, period_end,
   claimed_pct, claimed_amount, approved_pct, approved_amount,
   retention_pct, status, notes)
VALUES
  ('sc000001-0000-0000-0000-000000000001',
   'ct000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   1,
   now() - interval '60 days',
   '2026-04-01', '2026-04-30',
   30, 5550000, 30, 5550000,
   5.00, 'APROBADO',
   'Montaje de tableros y caÃ±erÃ­as planta baja'),

  ('sc000002-0000-0000-0000-000000000002',
   'ct000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   2,
   now() - interval '30 days',
   '2026-05-01', '2026-05-31',
   35, 6475000, 35, 6475000,
   5.00, 'APROBADO',
   'Tendido de cableado estructura y entrepiso'),

  ('sc000003-0000-0000-0000-000000000003',
   'ct000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   3,
   now() - interval '5 days',
   '2026-06-01', '2026-06-30',
   20, 3700000, NULL, NULL,
   5.00, 'PENDIENTE',
   'ConexiÃ³n de luminarias planta alta');

-- -----------------------------------------------------------------------------
-- 8. Certificados de ejecuciÃ³n al comitente â€” Proyecto 1
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
  ('pc000001-0000-0000-0000-000000000001',
   'c1000001-0000-0000-0000-000000000001',
   1,
   '2026-01-20', '2026-02-28',
   'CERRADO',
   0, 28250000,
   now() - interval '6 months'),

  ('pc000002-0000-0000-0000-000000000002',
   'c1000001-0000-0000-0000-000000000001',
   2,
   '2026-03-01', '2026-04-30',
   'CERRADO',
   28250000, 42300000,
   now() - interval '4 months'),

  ('pc000003-0000-0000-0000-000000000003',
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
  -- Cert 1: ExcavaciÃ³n
  ('pi000001-0000-0000-0000-000000000001',
   'pc000001-0000-0000-0000-000000000001',
   'b1000002-0000-0000-0000-000000000002',
   'ExcavaciÃ³n en terreno natural', 'mÂ³', 85000,
   0, 180, 180),

  ('pi000002-0000-0000-0000-000000000002',
   'pc000001-0000-0000-0000-000000000001',
   'b1000003-0000-0000-0000-000000000003',
   'Relleno y compactaciÃ³n', 'mÂ³', 55000,
   0, 120, 120),

  -- Cert 2: Zapatas
  ('pi000003-0000-0000-0000-000000000003',
   'pc000002-0000-0000-0000-000000000002',
   'b1000002-0000-0000-0000-000000000002',
   'ExcavaciÃ³n en terreno natural', 'mÂ³', 85000,
   180, 270, 450),

  ('pi000004-0000-0000-0000-000000000004',
   'pc000002-0000-0000-0000-000000000002',
   'b1000005-0000-0000-0000-000000000005',
   'Zapatas y vigas de fundaciÃ³n', 'mÂ³', 420000,
   0, 45, 45),

  -- Cert 3 (borrador)
  ('pi000005-0000-0000-0000-000000000005',
   'pc000003-0000-0000-0000-000000000003',
   'b1000005-0000-0000-0000-000000000005',
   'Zapatas y vigas de fundaciÃ³n', 'mÂ³', 420000,
   45, 55, 100),

  ('pi000006-0000-0000-0000-000000000006',
   'pc000003-0000-0000-0000-000000000003',
   'b1000006-0000-0000-0000-000000000006',
   'Columnas y vigas', 'mÂ³', 480000,
   0, 40, 40);

-- -----------------------------------------------------------------------------
-- 9. Stock de productos
-- -----------------------------------------------------------------------------
INSERT INTO public.productos
  (id, empresa_id, nombre, descripcion, unidad, sku,
   stock_actual, stock_minimo, contenido_por_unidad, unidad_base, activo, created_by)
VALUES
  ('pr000001-0000-0000-0000-000000000001',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Cemento Portland 50kg',
   'Bolsa de cemento portland tipo I, resistencia 420 kg/cmÂ²',
   'bolsa', 'CEM-50KG',
   120, 20,
   50, 'kg',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('pr000002-0000-0000-0000-000000000002',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Hierro 10mm barra 12m',
   'Barra de hierro de construcciÃ³n nervurado 10mm Ã— 12m',
   'unidad', 'HIE-10-12',
   85, 15,
   NULL, NULL,
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('pr000003-0000-0000-0000-000000000003',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Arena gruesa',
   'Arena de rÃ­o para mezclas de hormigÃ³n',
   'mÂ³', 'ARE-GRU',
   18, 5,
   NULL, NULL,
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('pr000004-0000-0000-0000-000000000004',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Ladrillo hueco 15cm',
   'Ladrillo cerÃ¡mico hueco 15Ã—20Ã—30cm',
   'unidad', 'LAD-15',
   2400, 500,
   NULL, NULL,
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('pr000005-0000-0000-0000-000000000005',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'Pintura lÃ¡tex interior 20lt',
   'Pintura lÃ¡tex interior lavable blanca bidÃ³n 20 litros',
   'bidÃ³n', 'PIN-LAT-20',
   14, 3,
   20, 'lt',
   true, '83a3c4b5-d674-426c-8bf1-3d71d8351a59'),

  ('pr000006-0000-0000-0000-000000000006',
   'bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd',
   'CaÃ±o de PVC 110mm (barra 3m)',
   'CaÃ±o sanitario PVC Ã˜110mm Ã— 3m',
   'unidad', 'CAP-PVC-110',
   30, 10,
   NULL, NULL,
   false, '83a3c4b5-d674-426c-8bf1-3d71d8351a59')

ON CONFLICT (empresa_id, sku) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 10. VerificaciÃ³n rÃ¡pida â€” cantidad de registros insertados
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

