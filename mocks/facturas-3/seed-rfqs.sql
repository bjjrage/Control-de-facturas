-- =============================================================================
-- MOCKS — Facturas 3
-- 5 RFQs + 5 Órdenes de Compra para prueba manual del circuito de compras
--
-- INSTRUCCIONES:
-- 1. Abrí el SQL Editor de Supabase (dashboard → SQL Editor)
-- 2. Pegá este script y ejecutalo
-- 3. Los registros quedan ligados a la empresa niupack
-- 4. Después cargá las facturas PDF del directorio pdfs/ de esta carpeta
-- =============================================================================

-- Tomamos empresa_id y profile_id del usuario admin (marceloechauri@gmail.com)
DO $$
DECLARE
  v_empresa_id   uuid;
  v_profile_id   uuid;

  -- Proveedores (IDs existentes en la BD)
  p_cooltech     uuid;
  p_limpieza     uuid;
  p_muebles      uuid;
  p_distribuidora uuid;
  p_techoffice   uuid;

  -- Nombres de proveedores
  n_cooltech     text;
  n_limpieza     text;
  n_muebles      text;
  n_distribuidora text;
  n_techoffice   text;

  -- RFQ IDs
  rfq1 uuid;
  rfq2 uuid;
  rfq3 uuid;
  rfq4 uuid;
  rfq5 uuid;

  -- OC IDs
  oc1 uuid;
  oc2 uuid;
  oc3 uuid;
  oc4 uuid;
  oc5 uuid;

BEGIN
  -- Obtener empresa y profile
  SELECT p.empresa_id, p.id
  INTO v_empresa_id, v_profile_id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = 'marceloechauri@gmail.com'
  LIMIT 1;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el usuario admin — verificá el email';
  END IF;

  -- Obtener IDs y nombres de proveedores existentes
  SELECT id, name INTO p_cooltech,      n_cooltech      FROM public.providers WHERE name ILIKE '%CoolTech%' AND empresa_id = v_empresa_id LIMIT 1;
  SELECT id, name INTO p_limpieza,      n_limpieza      FROM public.providers WHERE name ILIKE '%Limpieza Pro%' AND empresa_id = v_empresa_id LIMIT 1;
  SELECT id, name INTO p_muebles,       n_muebles       FROM public.providers WHERE name ILIKE '%Muebles Modernos%' AND empresa_id = v_empresa_id LIMIT 1;
  SELECT id, name INTO p_distribuidora, n_distribuidora FROM public.providers WHERE name ILIKE '%Distribuidora Central%' AND empresa_id = v_empresa_id LIMIT 1;
  SELECT id, name INTO p_techoffice,    n_techoffice    FROM public.providers WHERE name ILIKE '%TechOffice%' AND empresa_id = v_empresa_id LIMIT 1;

  -- =========================================================================
  -- 5 RFQs
  -- =========================================================================

  INSERT INTO public.rfqs (empresa_id, code, quote_type, created_by, product, quantity, unit,
    specifications, required_date, status, expires_at, client_name,
    mostrar_cliente_al_proveedor, observations)
  VALUES (v_empresa_id, 'RFQ-MOCK-001', 'RFQ', v_profile_id,
    'Filtros de aire industriales (serie FI-200)', 50, 'unidades',
    'Filtros para sistema HVAC, medida 500x500x100mm, MERV-13',
    (CURRENT_DATE + 30),
    'AUTORIZADO', (NOW() + INTERVAL '30 days'),
    NULL, false, 'Para mantenimiento preventivo Q4 2026')
  RETURNING id INTO rfq1;

  INSERT INTO public.rfqs (empresa_id, code, quote_type, created_by, product, quantity, unit,
    specifications, required_date, status, expires_at, client_name,
    mostrar_cliente_al_proveedor, observations)
  VALUES (v_empresa_id, 'RFQ-MOCK-002', 'RFQ', v_profile_id,
    'Servicio de limpieza de tanques de agua', 3, 'servicios',
    'Limpieza y desinfección de 3 tanques de 5000L cada uno, incluye certificado',
    (CURRENT_DATE + 15),
    'AUTORIZADO', (NOW() + INTERVAL '30 days'),
    NULL, false, 'Requerimiento sanitario anual')
  RETURNING id INTO rfq2;

  INSERT INTO public.rfqs (empresa_id, code, quote_type, created_by, product, quantity, unit,
    specifications, required_date, status, expires_at, client_name,
    mostrar_cliente_al_proveedor, observations)
  VALUES (v_empresa_id, 'RFQ-MOCK-003', 'RFQ', v_profile_id,
    'Sillas ergonómicas de oficina', 12, 'unidades',
    'Silla ejecutiva con soporte lumbar, apoyabrazos ajustables, garantía mínima 2 años',
    (CURRENT_DATE + 21),
    'AUTORIZADO', (NOW() + INTERVAL '30 days'),
    NULL, false, 'Equipamiento sala de reuniones Piso 3')
  RETURNING id INTO rfq3;

  INSERT INTO public.rfqs (empresa_id, code, quote_type, created_by, product, quantity, unit,
    specifications, required_date, status, expires_at, client_name,
    mostrar_cliente_al_proveedor, observations)
  VALUES (v_empresa_id, 'RFQ-MOCK-004', 'RFQ', v_profile_id,
    'Papel bond A4 75g resma x 500', 200, 'resmas',
    'Papel bond blanco A4 75g, resma de 500 hojas, Hammermill o equivalente',
    (CURRENT_DATE + 7),
    'AUTORIZADO', (NOW() + INTERVAL '30 days'),
    NULL, false, 'Reposición de stock de insumos de oficina')
  RETURNING id INTO rfq4;

  INSERT INTO public.rfqs (empresa_id, code, quote_type, created_by, product, quantity, unit,
    specifications, required_date, status, expires_at, client_name,
    mostrar_cliente_al_proveedor, observations)
  VALUES (v_empresa_id, 'RFQ-MOCK-005', 'RFQ', v_profile_id,
    'Licencias Microsoft 365 Business Standard', 15, 'licencias',
    '15 licencias anuales Microsoft 365 Business Standard, con soporte local en Paraguay',
    (CURRENT_DATE + 45),
    'AUTORIZADO', (NOW() + INTERVAL '30 days'),
    NULL, false, 'Renovación anual licencias equipo')
  RETURNING id INTO rfq5;

  -- =========================================================================
  -- 5 Órdenes de Compra (una por proveedor, referenciando cada RFQ)
  -- =========================================================================

  INSERT INTO public.authorized_orders (empresa_id, rfq_id, provider_id, provider_name, product,
    quantity, unit, unit_price, total_price, currency, vat_included, is_cheapest, authorized_at, authorized_by, status, code)
  VALUES (v_empresa_id, rfq1, p_cooltech, n_cooltech,
    'Filtros de aire industriales (serie FI-200)', 50, 'unidades',
    170000, 8500000, 'PYG', true, true, NOW(), v_profile_id, 'AUTORIZADO', 'OC-MOCK-001')
  RETURNING id INTO oc1;

  INSERT INTO public.authorized_orders (empresa_id, rfq_id, provider_id, provider_name, product,
    quantity, unit, unit_price, total_price, currency, vat_included, is_cheapest, authorized_at, authorized_by, status, code)
  VALUES (v_empresa_id, rfq2, p_limpieza, n_limpieza,
    'Servicio de limpieza de tanques de agua', 3, 'servicios',
    700000, 2100000, 'PYG', true, true, NOW(), v_profile_id, 'AUTORIZADO', 'OC-MOCK-002')
  RETURNING id INTO oc2;

  INSERT INTO public.authorized_orders (empresa_id, rfq_id, provider_id, provider_name, product,
    quantity, unit, unit_price, total_price, currency, vat_included, is_cheapest, authorized_at, authorized_by, status, code)
  VALUES (v_empresa_id, rfq3, p_muebles, n_muebles,
    'Sillas ergonómicas de oficina', 12, 'unidades',
    1550000, 18600000, 'PYG', true, true, NOW(), v_profile_id, 'AUTORIZADO', 'OC-MOCK-003')
  RETURNING id INTO oc3;

  INSERT INTO public.authorized_orders (empresa_id, rfq_id, provider_id, provider_name, product,
    quantity, unit, unit_price, total_price, currency, vat_included, is_cheapest, authorized_at, authorized_by, status, code)
  VALUES (v_empresa_id, rfq4, p_distribuidora, n_distribuidora,
    'Papel bond A4 75g resma x 500', 200, 'resmas',
    19000, 3800000, 'PYG', true, true, NOW(), v_profile_id, 'AUTORIZADO', 'OC-MOCK-004')
  RETURNING id INTO oc4;

  INSERT INTO public.authorized_orders (empresa_id, rfq_id, provider_id, provider_name, product,
    quantity, unit, unit_price, total_price, currency, vat_included, is_cheapest, authorized_at, authorized_by, status, code)
  VALUES (v_empresa_id, rfq5, p_techoffice, n_techoffice,
    'Licencias Microsoft 365 Business Standard', 15, 'licencias',
    2100000, 31500000, 'PYG', true, true, NOW(), v_profile_id, 'AUTORIZADO', 'OC-MOCK-005')
  RETURNING id INTO oc5;

  RAISE NOTICE 'Creados: RFQ-MOCK-001..005 y OC-MOCK-001..005';
  RAISE NOTICE 'RFQ IDs: %, %, %, %, %', rfq1, rfq2, rfq3, rfq4, rfq5;
  RAISE NOTICE 'OC  IDs: %, %, %, %, %', oc1, oc2, oc3, oc4, oc5;
END $$;
