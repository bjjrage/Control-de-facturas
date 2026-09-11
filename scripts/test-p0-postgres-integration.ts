/**
 * SUITE DE INTEGRACIÓN POSTGRESQL REAL (P0 AUDITORÍA ADVERSARIAL)
 * 
 * Este script se conecta a una base de datos PostgreSQL / Supabase REAL
 * (ejecutada en GitHub Actions con Supabase CLI o contenedor efímero)
 * y ejecuta TODAS las validaciones de seguridad, invariantes multi-tenant,
 * RPCs atómicas, grants, rollback y concurrencia.
 * 
 * NO USA MOCKS NI SIMULACIONES. EJECUTA SQL Y RPCs REALES.
 */

import { Client } from 'pg';

interface TestSummary {
  name: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  details?: any;
}

const results: TestSummary[] = [];

function record(name: string, expected: string, actual: string, passed: boolean, details?: any) {
  results.push({
    name,
    expected,
    actual,
    status: passed ? 'PASS' : 'FAIL',
    details
  });
  if (passed) {
    console.log(`✅ [PASS] ${name}`);
  } else {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Esperado: ${expected}`);
    console.error(`   Obtenido: ${actual}`);
    if (details) console.error('   Detalles:', details);
  }
}

async function run() {
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ ERROR FATAL: No se definió TEST_DATABASE_URL ni DATABASE_URL');
    process.exit(1);
  }

  // Conexión como superuser / postgres para setup de fixtures e introspección de permisos
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  console.log('\n================================================================');
  console.log('🐘 INICIANDO BATERÍA DE INTEGRACIÓN REAL POSTGRESQL / SUPABASE P0');
  console.log('================================================================\n');

  try {
    // --------------------------------------------------------------------------
    // 0. VERIFICACIÓN DE AMBIENTE & VERSIÓN POSTGRESQL
    // --------------------------------------------------------------------------
    const versionRes = await client.query('SELECT version();');
    const pgVersion = versionRes.rows[0].version;
    console.log(`📌 Motor detectado: ${pgVersion.split('\n')[0]}`);
    record('Verificación de conexión a PostgreSQL real', 'Versión PostgreSQL retornada', pgVersion.slice(0, 30), true);

    // --------------------------------------------------------------------------
    // 1. SETUP DE TENANTS, USUARIOS Y PROVEEDORES BASE
    // --------------------------------------------------------------------------
    console.log('\n--- SETUP DE TENANTS Y USUARIOS REALES EN POSTGRESQL ---');
    
    // Crear empresas A y B
    const empARes = await client.query(`
      INSERT INTO public.empresas (nombre, slug)
      VALUES ('Empresa Test A', 'emp-test-a-' || gen_random_uuid())
      RETURNING id;
    `);
    const empresaA = empARes.rows[0].id;

    const empBRes = await client.query(`
      INSERT INTO public.empresas (nombre, slug)
      VALUES ('Empresa Test B', 'emp-test-b-' || gen_random_uuid())
      RETURNING id;
    `);
    const empresaB = empBRes.rows[0].id;

    // Crear usuarios en auth.users
    const usrARes = await client.query(`
      INSERT INTO auth.users (id, email)
      VALUES (gen_random_uuid(), 'user-a-' || gen_random_uuid() || '@test.com')
      RETURNING id;
    `);
    const userA = usrARes.rows[0].id;

    const usrBRes = await client.query(`
      INSERT INTO auth.users (id, email)
      VALUES (gen_random_uuid(), 'user-b-' || gen_random_uuid() || '@test.com')
      RETURNING id;
    `);
    const userB = usrBRes.rows[0].id;

    const usrNoTenantRes = await client.query(`
      INSERT INTO auth.users (id, email)
      VALUES (gen_random_uuid(), 'user-notenant-' || gen_random_uuid() || '@test.com')
      RETURNING id;
    `);
    const userNoTenant = usrNoTenantRes.rows[0].id;

    // Crear perfiles asociados en public.profiles
    await client.query(`
      INSERT INTO public.profiles (id, email, full_name, role, empresa_id)
      VALUES 
        ($1, 'user-a@test.com', 'Usuario Empresa A', 'admin', $2),
        ($3, 'user-b@test.com', 'Usuario Empresa B', 'admin', $4);
    `, [userA, empresaA, userB, empresaB]);

    // Crear proveedores para A y B
    const provARes = await client.query(`
      INSERT INTO public.providers (empresa_id, name, tax_id)
      VALUES ($1, 'Proveedor A', '80001001-1')
      RETURNING id;
    `, [empresaA]);
    const provA = provARes.rows[0].id;

    const provBRes = await client.query(`
      INSERT INTO public.providers (empresa_id, name, tax_id)
      VALUES ($1, 'Proveedor B', '80002002-2')
      RETURNING id;
    `, [empresaB]);
    const provB = provBRes.rows[0].id;

    // --------------------------------------------------------------------------
    // 2. VERIFICACIÓN DE RECONSTRUCCIÓN MONETARIA TENANT-SCOPED (MIGRACIÓN 0068)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 1: Reconstrucción Histórica de Moneda (Same Tenant vs Cross Tenant) ---');

    // Factura legítima de Empresa A en EUR
    const facARes = await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'FAC-A-001', '2026-08-01', 'EUR', 1500, 'PENDIENTE', $3)
      RETURNING id;
    `, [empresaA, provA, userA]);
    const facAId = facARes.rows[0].id;

    // Factura legítima de Empresa B en USD
    const facBRes = await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'FAC-B-001', '2026-08-01', 'USD', 2500, 'PENDIENTE', $3)
      RETURNING id;
    `, [empresaB, provB, userB]);
    const facBId = facBRes.rows[0].id;

    // Órdenes de compra autorizadas para A y B
    const aoARes = await client.query(`
      INSERT INTO public.authorized_orders (
        empresa_id, provider_id, provider_name, client_name, product, quantity, unit,
        unit_price, total_price, currency, vat_included, is_cheapest, authorized_by
      ) VALUES ($1, $2, 'Proveedor A', 'Cliente A', 'Insumo Alfa', 10, 'UN', 100, 1000, 'EUR', true, true, $3)
      RETURNING id;
    `, [empresaA, provA, userA]);
    const aoAId = aoARes.rows[0].id;

    const aoBRes = await client.query(`
      INSERT INTO public.authorized_orders (
        empresa_id, provider_id, provider_name, client_name, product, quantity, unit,
        unit_price, total_price, currency, vat_included, is_cheapest, authorized_by
      ) VALUES ($1, $2, 'Proveedor B', 'Cliente B', 'Insumo Beta', 20, 'UN', 50, 1000, 'USD', true, true, $3)
      RETURNING id;
    `, [empresaB, provB, userB]);
    const aoBId = aoBRes.rows[0].id;

    // Insertar observaciones corruptas previas a la reparación
    // Obs 1: Empresa A vinculada a Factura A (Same-Tenant) -> Debe reconstruir a EUR
    const obsSameFac = await client.query(`
      INSERT INTO public.cost_observations (
        empresa_id, fuente, documento_id, descripcion_item, cantidad, unidad,
        precio_unitario, moneda, estado_evidencia, fecha_observacion
      ) VALUES ($1, 'FACTURA', $2, 'Item Same Fac', 10, 'UN', NULL, 'PYG', 'REVISION_REQUERIDA', '2026-08-01')
      RETURNING id;
    `, [empresaA, facAId]);
    const obsSameFacId = obsSameFac.rows[0].id;

    // Obs 2: Empresa A vinculada a Factura B (Cross-Tenant) -> JAMÁS debe copiar 'USD' de B; debe quedar NULL
    const obsCrossFac = await client.query(`
      INSERT INTO public.cost_observations (
        empresa_id, fuente, documento_id, descripcion_item, cantidad, unidad,
        precio_unitario, moneda, estado_evidencia, fecha_observacion
      ) VALUES ($1, 'FACTURA', $2, 'Item Cross Fac', 10, 'UN', NULL, 'PYG', 'REVISION_REQUERIDA', '2026-08-01')
      RETURNING id;
    `, [empresaA, facBId]);
    const obsCrossFacId = obsCrossFac.rows[0].id;

    // Obs 3: Empresa A vinculada a Orden A (Same-Tenant) -> Debe reconstruir a EUR
    const obsSameAo = await client.query(`
      INSERT INTO public.cost_observations (
        empresa_id, fuente, documento_id, descripcion_item, cantidad, unidad,
        precio_unitario, moneda, estado_evidencia, fecha_observacion
      ) VALUES ($1, 'ORDEN_COMPRA', $2, 'Item Same AO', 10, 'UN', NULL, 'PYG', 'REVISION_REQUERIDA', '2026-08-01')
      RETURNING id;
    `, [empresaA, aoAId]);
    const obsSameAoId = obsSameAo.rows[0].id;

    // Obs 4: Empresa A vinculada a Orden B (Cross-Tenant) -> Debe quedar NULL
    const obsCrossAo = await client.query(`
      INSERT INTO public.cost_observations (
        empresa_id, fuente, documento_id, descripcion_item, cantidad, unidad,
        precio_unitario, moneda, estado_evidencia, fecha_observacion
      ) VALUES ($1, 'ORDEN_COMPRA', $2, 'Item Cross AO', 10, 'UN', NULL, 'PYG', 'REVISION_REQUERIDA', '2026-08-01')
      RETURNING id;
    `, [empresaA, aoBId]);
    const obsCrossAoId = obsCrossAo.rows[0].id;

    // Obs 5: Empresa A sin documento -> Debe quedar NULL
    const obsNoDoc = await client.query(`
      INSERT INTO public.cost_observations (
        empresa_id, fuente, documento_id, descripcion_item, cantidad, unidad,
        precio_unitario, moneda, estado_evidencia, fecha_observacion
      ) VALUES ($1, 'MANUAL', NULL, 'Item Sin Doc', 10, 'UN', NULL, 'PYG', 'REVISION_REQUERIDA', '2026-08-01')
      RETURNING id;
    `, [empresaA]);
    const obsNoDocId = obsNoDoc.rows[0].id;

    // Obs 6: Empresa A con documento_id inexistente -> Debe quedar NULL
    const obsBadDoc = await client.query(`
      INSERT INTO public.cost_observations (
        empresa_id, fuente, documento_id, descripcion_item, cantidad, unidad,
        precio_unitario, moneda, estado_evidencia, fecha_observacion
      ) VALUES ($1, 'FACTURA', gen_random_uuid()::text, 'Item Bad Doc', 10, 'UN', NULL, 'PYG', 'REVISION_REQUERIDA', '2026-08-01')
      RETURNING id;
    `, [empresaA]);
    const obsBadDocId = obsBadDoc.rows[0].id;

    // EJECUTAR EL SCRIPT DE RECONSTRUCCIÓN EXACTO DE LA MIGRACIÓN 0068
    await client.query(`
      -- Paso A: Preservar precio_unitario_original y desacoplar precio_unitario en PYG
      UPDATE public.cost_observations
      SET
        precio_unitario_original = COALESCE(precio_unitario_original, precio_unitario),
        precio_unitario = NULL
      WHERE estado_evidencia = 'REVISION_REQUERIDA'
        AND (tipo_cambio IS NULL OR tipo_cambio <= 0);

      -- Paso B: Reconstruir moneda_original únicamente donde existe evidencia inequívoca en facturas DEL MISMO TENANT
      UPDATE public.cost_observations co
      SET moneda_original = i.currency
      FROM public.invoices i
      WHERE co.fuente = 'FACTURA'
        AND co.documento_id IS NOT NULL
        AND co.documento_id ~ '^[0-9a-fA-F-]{36}$'
        AND i.id = co.documento_id::uuid
        AND i.empresa_id = co.empresa_id
        AND co.moneda_original IS NULL;

      -- Paso C: Reconstruir moneda_original únicamente donde existe evidencia inequívoca en órdenes de compra DEL MISMO TENANT
      UPDATE public.cost_observations co
      SET moneda_original = o.currency
      FROM public.authorized_orders o
      WHERE co.fuente = 'ORDEN_COMPRA'
        AND co.documento_id IS NOT NULL
        AND co.documento_id ~ '^[0-9a-fA-F-]{36}$'
        AND o.id = co.documento_id::uuid
        AND o.empresa_id = co.empresa_id
        AND co.moneda_original IS NULL;
    `);

    // VERIFICAR RESULTADOS EN DB REAL
    const rSameFac = (await client.query('SELECT moneda_original FROM public.cost_observations WHERE id = $1', [obsSameFacId])).rows[0].moneda_original;
    const rCrossFac = (await client.query('SELECT moneda_original FROM public.cost_observations WHERE id = $1', [obsCrossFacId])).rows[0].moneda_original;
    const rSameAo = (await client.query('SELECT moneda_original FROM public.cost_observations WHERE id = $1', [obsSameAoId])).rows[0].moneda_original;
    const rCrossAo = (await client.query('SELECT moneda_original FROM public.cost_observations WHERE id = $1', [obsCrossAoId])).rows[0].moneda_original;
    const rNoDoc = (await client.query('SELECT moneda_original FROM public.cost_observations WHERE id = $1', [obsNoDocId])).rows[0].moneda_original;
    const rBadDoc = (await client.query('SELECT moneda_original FROM public.cost_observations WHERE id = $1', [obsBadDocId])).rows[0].moneda_original;

    record('Reconstrucción Misma Empresa (Factura A)', 'EUR', rSameFac, rSameFac === 'EUR');
    record('Aislamiento Cross-Tenant (Factura B no filtra a Obs A)', 'null', String(rCrossFac), rCrossFac === null);
    record('Reconstrucción Misma Empresa (Orden A)', 'EUR', rSameAo, rSameAo === 'EUR');
    record('Aislamiento Cross-Tenant (Orden B no filtra a Obs A)', 'null', String(rCrossAo), rCrossAo === null);
    record('Observación sin documento permanece NULL', 'null', String(rNoDoc), rNoDoc === null);
    record('Observación con documento inexistente permanece NULL', 'null', String(rBadDoc), rBadDoc === null);

    // Cuentas financieras para A y B
    const ctaARes = await client.query(`
      INSERT INTO public.cuentas_financieras (empresa_id, nombre, tipo, saldo)
      VALUES ($1, 'Banco Itaú A', 'BANCO', 50000000)
      RETURNING id, saldo;
    `, [empresaA]);
    const ctaA = ctaARes.rows[0].id;

    const ctaBRes = await client.query(`
      INSERT INTO public.cuentas_financieras (empresa_id, nombre, tipo, saldo)
      VALUES ($1, 'Banco Continental B', 'BANCO', 20000000)
      RETURNING id, saldo;
    `, [empresaB]);
    const ctaB = ctaBRes.rows[0].id;

    // Facturas listas para pagar
    const invPayARes = await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-PAY-A1', current_date, 'PYG', 5000000, 'APTO_PARA_PAGO', $3)
      RETURNING id;
    `, [empresaA, provA, userA]);
    const invPayA = invPayARes.rows[0].id;

    const invPayBRes = await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-PAY-B1', current_date, 'PYG', 3000000, 'APTO_PARA_PAGO', $3)
      RETURNING id;
    `, [empresaB, provB, userB]);
    const invPayB = invPayBRes.rows[0].id;

    // Orden de pago legítima A
    const opARes = await client.query(`
      INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
      VALUES ($1, 'OP-TEST-A-01', $2, 'EMITIDA', $3)
      RETURNING id;
    `, [empresaA, provA, userA]);
    const opA = opARes.rows[0].id;

    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaA, opA, invPayA]);

    // Orden de pago legítima B
    const opBRes = await client.query(`
      INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
      VALUES ($1, 'OP-TEST-B-01', $2, 'EMITIDA', $3)
      RETURNING id;
    `, [empresaB, provB, userB]);
    const opB = opBRes.rows[0].id;

    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaB, opB, invPayB]);

    const invPayBInfiltradaRes = await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-PAY-B-INFILTRADA', current_date, 'PYG', 2500000, 'APTO_PARA_PAGO', $3)
      RETURNING id;
    `, [empresaB, provB, userB]);
    const invPayBInfiltrada = invPayBInfiltradaRes.rows[0].id;

    // Verify that the trigger trg_payment_order_invoices_empresa blocks cross-tenant linkage normally
    let triggerBlockedCrossTenant = false;
    try {
      await client.query(`
        INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
        VALUES ($1, $2, $3);
      `, [empresaA, opA, invPayBInfiltrada]);
    } catch (err: any) {
      if (err.message && err.message.includes('does not belong to empresa')) {
        triggerBlockedCrossTenant = true;
      }
    }
    record('Trigger trg_payment_order_invoices_empresa bloquea cross-tenant insert', 'TRUE', String(triggerBlockedCrossTenant), triggerBlockedCrossTenant);

    // Orden de pago fraudulenta/corrupta A con factura de B infiltrada
    // (Bypaseamos el trigger temporalmente para probar que el RPC ejecutar_orden_pago_atomica tiene defensa en profundidad)
    const opACorruptRes = await client.query(`
      INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
      VALUES ($1, 'OP-TEST-A-CORRUPT', $2, 'EMITIDA', $3)
      RETURNING id;
    `, [empresaA, provA, userA]);
    const opACorrupt = opACorruptRes.rows[0].id;

    await client.query('ALTER TABLE public.payment_order_invoices DISABLE TRIGGER trg_payment_order_invoices_empresa;');
    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaA, opACorrupt, invPayBInfiltrada]);
    await client.query('ALTER TABLE public.payment_order_invoices ENABLE TRIGGER trg_payment_order_invoices_empresa;');


    // --------------------------------------------------------------------------
    // 3. TEST REAL RPC: ejecutar_orden_pago_atomica
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 2: RPC ejecutar_orden_pago_atomica (PostgreSQL Real) ---');

    async function execAsUser(userId: string | null, sql: string, params: any[] = []) {
      const sessClient = new Client({ connectionString: dbUrl });
      await sessClient.connect();
      try {
        await sessClient.query('BEGIN');
        if (userId) {
          await sessClient.query("SET LOCAL role = 'authenticated'");
          await sessClient.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
          await sessClient.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
        } else {
          await sessClient.query("SET LOCAL role = 'anon'");
          await sessClient.query("SELECT set_config('request.jwt.claim.sub', '', true)");
          await sessClient.query("SELECT set_config('request.jwt.claim.role', 'anon', true)");
        }
        const res = await sessClient.query(sql, params);
        await sessClient.query('COMMIT');
        return { success: true, rows: res.rows };
      } catch (err: any) {
        await sessClient.query('ROLLBACK');
        return { success: false, error: err.message };
      } finally {
        await sessClient.end();
      }
    }

    // 2.1 A + OP A = OK
    const t2_ok = await execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opA, ctaA]);
    record('Tenant A ejecuta OP A con cuenta A (Happy path)', 'SUCCESS', t2_ok.success ? 'SUCCESS' : t2_ok.error, t2_ok.success);

    // 2.2 A + p_empresa_id B = FAIL
    const t2_wrong_emp = await execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaB, opA, ctaA]);
    record('Tenant A invocando p_empresa_id B -> FAIL', 'FAIL', t2_wrong_emp.success ? 'SUCCESS' : 'FAIL', !t2_wrong_emp.success);

    // 2.3 A + OP B = FAIL
    const t2_cross_op = await execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opB, ctaA]);
    record('Tenant A invocando OP B -> FAIL', 'FAIL', t2_cross_op.success ? 'SUCCESS' : 'FAIL', !t2_cross_op.success);

    // 2.4 A + OP A con factura infiltrada de B = FAIL
    const t2_infiltrated = await execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opACorrupt, ctaA]);
    record('Tenant A con OP conteniendo factura B -> FAIL (Integridad tenant violada)', 'FAIL', t2_infiltrated.success ? 'SUCCESS' : 'FAIL', !t2_infiltrated.success);

    // 2.5 A + cuenta financiera B = FAIL
    const opA2 = (await client.query(`
      INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
      VALUES ($1, 'OP-TEST-A-02', $2, 'EMITIDA', $3) RETURNING id;
    `, [empresaA, provA, userA])).rows[0].id;
    const invA2 = (await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-A2', current_date, 'PYG', 100000, 'APTO_PARA_PAGO', $3) RETURNING id;
    `, [empresaA, provA, userA])).rows[0].id;
    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaA, opA2, invA2]);

    const t2_cross_cuenta = await execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opA2, ctaB]);
    record('Tenant A con cuenta de Tenant B -> FAIL (Cuenta no encontrada para empresa)', 'FAIL', t2_cross_cuenta.success ? 'SUCCESS' : 'FAIL', !t2_cross_cuenta.success);

    // 2.6 anon = FAIL
    const t2_anon = await execAsUser(null, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opA2, ctaA]);
    record('Llamada anónima a ejecutar_orden_pago_atomica -> FAIL', 'FAIL', t2_anon.success ? 'SUCCESS' : 'FAIL', !t2_anon.success);

    // 2.7 Usuario autenticado sin tenant = FAIL
    const t2_no_tenant = await execAsUser(userNoTenant, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opA2, ctaA]);
    record('Usuario sin tenant asignado -> FAIL', 'FAIL', t2_no_tenant.success ? 'SUCCESS' : 'FAIL', !t2_no_tenant.success);


    // --------------------------------------------------------------------------
    // 4. TEST REAL RPC: registrar_cobro_atomico
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 3: RPC registrar_cobro_atomico (PostgreSQL Real) ---');

    const cliA = (await client.query(`INSERT INTO public.clients (empresa_id, name) VALUES ($1, 'Cliente A') RETURNING id;`, [empresaA])).rows[0].id;
    const cliB = (await client.query(`INSERT INTO public.clients (empresa_id, name) VALUES ($1, 'Cliente B') RETURNING id;`, [empresaB])).rows[0].id;

    const docA = (await client.query(`
      INSERT INTO public.sales_documents (empresa_id, client_id, code, doc_type, status, total, created_by)
      VALUES ($1, $2, 'DOC-A-01', 'NOTA_VENTA', 'EMITIDA', 2000000, $3) RETURNING id;
    `, [empresaA, cliA, userA])).rows[0].id;

    const docB = (await client.query(`
      INSERT INTO public.sales_documents (empresa_id, client_id, code, doc_type, status, total, created_by)
      VALUES ($1, $2, 'DOC-B-01', 'NOTA_VENTA', 'EMITIDA', 1500000, $3) RETURNING id;
    `, [empresaB, cliB, userB])).rows[0].id;

    // 3.1 A + doc A = OK
    const t3_ok = await execAsUser(userA, `
      SELECT public.registrar_cobro_atomico($1, $2, $3, $4, current_date, 'REF-A', 'Nota A', $5, $6)
    `, [empresaA, docA, 1000000, 'TRANSFERENCIA', ctaA, userA]);
    record('Tenant A registra cobro sobre Documento A con Cuenta A -> OK', 'SUCCESS', t3_ok.success ? 'SUCCESS' : t3_ok.error, t3_ok.success);

    // 3.2 A + doc B = FAIL
    const t3_cross_doc = await execAsUser(userA, `
      SELECT public.registrar_cobro_atomico($1, $2, $3, $4, current_date, 'REF-X', 'Nota', $5, $6)
    `, [empresaA, docB, 500000, 'TRANSFERENCIA', ctaA, userA]);
    record('Tenant A intenta cobrar Documento B -> FAIL', 'FAIL', t3_cross_doc.success ? 'SUCCESS' : 'FAIL', !t3_cross_doc.success);

    // 3.3 A + cuenta B = FAIL
    const t3_cross_cta = await execAsUser(userA, `
      SELECT public.registrar_cobro_atomico($1, $2, $3, $4, current_date, 'REF-X', 'Nota', $5, $6)
    `, [empresaA, docA, 500000, 'TRANSFERENCIA', ctaB, userA]);
    record('Tenant A intenta registrar cobro en Cuenta B -> FAIL', 'FAIL', t3_cross_cta.success ? 'SUCCESS' : 'FAIL', !t3_cross_cta.success);

    // 3.4 anon = FAIL
    const t3_anon = await execAsUser(null, `
      SELECT public.registrar_cobro_atomico($1, $2, $3, $4, current_date, 'REF-X', 'Nota', $5, $6)
    `, [empresaA, docA, 500000, 'TRANSFERENCIA', ctaA, null]);
    record('Llamada anónima a registrar_cobro_atomico -> FAIL', 'FAIL', t3_anon.success ? 'SUCCESS' : 'FAIL', !t3_anon.success);


    // --------------------------------------------------------------------------
    // 5. TEST REAL RPC: convertir_licitacion_a_proyecto_atomico
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 4: RPC convertir_licitacion_a_proyecto_atomico (PostgreSQL Real) ---');

    const licA = (await client.query(`
      INSERT INTO public.licitaciones (
        empresa_id, dncp_nro, ocid, titulo, decision
      ) VALUES ($1, 'DNCP-A-100', 'ocds-a-100', 'Licitacion A', 'GANADA') RETURNING id;
    `, [empresaA])).rows[0].id;

    const licB = (await client.query(`
      INSERT INTO public.licitaciones (
        empresa_id, dncp_nro, ocid, titulo, decision
      ) VALUES ($1, 'DNCP-B-200', 'ocds-b-200', 'Licitacion B', 'GANADA') RETURNING id;
    `, [empresaB])).rows[0].id;

    const runB = (await client.query(`
      INSERT INTO public.bid_analysis_runs (
        empresa_id, tender_id, titulo_licitacion, convocante, decision,
        overall_score, monto_referencial_pyg, precio_oferta_recomendado_pyg,
        margen_neto_estimado_pct, probabilidad_ganar_pct, compliance_snapshot,
        institution_snapshot, financial_snapshot, simulation_snapshot,
        pillars_snapshot, snapshot_hash
      ) VALUES (
        $1, 'DNCP-B-200', 'Licitacion B', 'MOPC', 'COMPETIR',
        90, 1000000, 950000, 15, 80, '{}', '{}', '{}', '{}', '{}', 'hash-b'
      ) RETURNING id;
    `, [empresaB])).rows[0].id;

    const budgetItemsValid = JSON.stringify([
      { description: 'Item 1 Obra', unit: 'M2', quantity: 100, unit_price: 50000 }
    ]);

    // 4.1 A + licitación A = OK
    const t4_ok = await execAsUser(userA, `
      SELECT public.convertir_licitacion_a_proyecto_atomico(
        $1, 'Obra A', 'OBRA-A-01', 'MOPC', 'MOPC', 'CT-01', 5000000, 5000000,
        180, 10, 5, current_date, current_date + 180, 'DNCP-A-100', NULL, $2, $3::jsonb, 'Depósito Central'
      )
    `, [empresaA, userA, budgetItemsValid]);
    record('Tenant A convierte Licitación A a Proyecto -> OK', 'SUCCESS', t4_ok.success ? 'SUCCESS' : t4_ok.error, t4_ok.success);

    // 4.2 A + licitación B = FAIL
    const t4_cross_lic = await execAsUser(userA, `
      SELECT public.convertir_licitacion_a_proyecto_atomico(
        $1, 'Obra Cross', 'OBRA-CR-01', 'MOPC', 'MOPC', 'CT-02', 5000000, 5000000,
        180, 10, 5, current_date, current_date + 180, 'DNCP-B-200', NULL, $2, $3::jsonb, 'Depósito'
      )
    `, [empresaA, userA, budgetItemsValid]);
    record('Tenant A intenta convertir Licitación B -> FAIL', 'FAIL', t4_cross_lic.success ? 'SUCCESS' : 'FAIL', !t4_cross_lic.success);

    const licA2 = (await client.query(`
      INSERT INTO public.licitaciones (
        empresa_id, dncp_nro, ocid, titulo, decision
      ) VALUES ($1, 'DNCP-A-101', 'ocds-a-101', 'Licitacion A 2', 'GANADA') RETURNING id;
    `, [empresaA])).rows[0].id;

    // 4.3 A + bid_analysis_run B = FAIL
    const t4_cross_run = await execAsUser(userA, `
      SELECT public.convertir_licitacion_a_proyecto_atomico(
        $1, 'Obra Cross Run', 'OBRA-CR-02', 'MOPC', 'MOPC', 'CT-03', 5000000, 5000000,
        180, 10, 5, current_date, current_date + 180, 'DNCP-A-101', $2, $3, $4::jsonb, 'Depósito'
      )
    `, [empresaA, runB, userA, budgetItemsValid]);
    record('Tenant A intenta adjuntar bid_analysis_run de B -> FAIL', 'FAIL', t4_cross_run.success ? 'SUCCESS' : 'FAIL', !t4_cross_run.success);


    // --------------------------------------------------------------------------
    // 6. TEST REAL: SERVICE ROLE BEHAVIOR & TRUST BOUNDARY
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 5: Service Role Behavior (Sin sesión autenticada) ---');
    
    const srvClient = new Client({ connectionString: dbUrl });
    await srvClient.connect();
    let srvUid: any = null;
    let srvEmpresa: any = null;
    let srvExecOpFail: boolean = false;
    try {
      await srvClient.query("SET LOCAL role = 'service_role'");
      srvUid = (await srvClient.query('SELECT auth.uid() AS uid')).rows[0].uid;
      srvEmpresa = (await srvClient.query('SELECT public.current_empresa_id() AS emp')).rows[0].emp;

      try {
        await srvClient.query('SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opA2, ctaA]);
      } catch (err: any) {
        srvExecOpFail = err.message.includes('se requiere sesión autenticada');
      }
    } finally {
      await srvClient.end();
    }

    record('Service Role auth.uid() es NULL por diseño', 'null', String(srvUid), srvUid === null);
    record('Service Role current_empresa_id() es NULL por diseño', 'null', String(srvEmpresa), srvEmpresa === null);
    record('Service Role bloqueado en RPCs con auth.uid() requirement', 'FAIL CLOSED', srvExecOpFail ? 'FAIL CLOSED' : 'ALLOWED', srvExecOpFail);


    // --------------------------------------------------------------------------
    // 7. TEST REAL: GRANTS & REVOKES EFECTIVOS EN EL CATÁLOGO POSTGRESQL
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 6: Permisos Efectivos en Catálogo PostgreSQL (pg_proc) ---');

    const aclRes = await client.query(`
      SELECT 
        p.proname,
        has_function_privilege('public', p.oid, 'execute') AS public_exec,
        has_function_privilege('anon', p.oid, 'execute') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'execute') AS srv_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('ejecutar_orden_pago_atomica', 'registrar_cobro_atomico', 'convertir_licitacion_a_proyecto_atomico');
    `);

    for (const row of aclRes.rows) {
      const isSecure = !row.public_exec && !row.anon_exec && row.auth_exec && row.srv_exec;
      record(
        `Permisos en ${row.proname}: PUBLIC=0, anon=0, authenticated=1, service_role=1`,
        'SECURE',
        isSecure ? 'SECURE' : `public:${row.public_exec}, anon:${row.anon_exec}`,
        isSecure
      );
    }


    // --------------------------------------------------------------------------
    // 8. TEST REAL: ROLLBACK Y ATOMICIDAD ANTE FALLO
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 7: Rollback Real & Preservación de Estado ante Fallo ---');

    const ctaRollback = (await client.query(`
      INSERT INTO public.cuentas_financieras (empresa_id, nombre, tipo, saldo)
      VALUES ($1, 'Cuenta Rollback Test', 'BANCO', 10000000) RETURNING id, saldo;
    `, [empresaA])).rows[0];

    const invRollback = (await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-ROLL-01', current_date, 'PYG', 2000000, 'APTO_PARA_PAGO', $3) RETURNING id, status;
    `, [empresaA, provA, userA])).rows[0];

    const opRollback = (await client.query(`
      INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
      VALUES ($1, 'OP-ROLLBACK-01', $2, 'EMITIDA', $3) RETURNING id, status;
    `, [empresaA, provA, userA])).rows[0];

    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaA, opRollback.id, invRollback.id]);

    const invRollbackB = (await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-ROLL-B-01', current_date, 'PYG', 1500000, 'APTO_PARA_PAGO', $3) RETURNING id;
    `, [empresaB, provB, userB])).rows[0].id;

    await client.query('ALTER TABLE public.payment_order_invoices DISABLE TRIGGER trg_payment_order_invoices_empresa;');
    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaA, opRollback.id, invRollbackB]);
    await client.query('ALTER TABLE public.payment_order_invoices ENABLE TRIGGER trg_payment_order_invoices_empresa;');

    const rollbackExec = await execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opRollback.id, ctaRollback.id]);
    
    const ctaAfter = (await client.query('SELECT saldo FROM public.cuentas_financieras WHERE id = $1', [ctaRollback.id])).rows[0].saldo;
    const invAfter = (await client.query('SELECT status FROM public.invoices WHERE id = $1', [invRollback.id])).rows[0].status;
    const opAfter = (await client.query('SELECT status FROM public.payment_orders WHERE id = $1', [opRollback.id])).rows[0].status;
    const movsCount = (await client.query('SELECT count(*) FROM public.movimientos_tesoreria WHERE payment_order_id = $1', [opRollback.id])).rows[0].count;

    const noStateChanged = 
      Number(ctaAfter) === Number(ctaRollback.saldo) &&
      invAfter === invRollback.status &&
      opAfter === opRollback.status &&
      Number(movsCount) === 0;

    record('Rollback atómico ante fallo (Saldo intacto, status intacto, cero movimientos)', 'TRUE', String(noStateChanged), noStateChanged && !rollbackExec.success);


    // --------------------------------------------------------------------------
    // 9. TEST REAL: CONCURRENCIA Y PREVENCIÓN DE DOBLE EJECUCIÓN
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 8: Concurrencia Real (Prevención de Doble Pago) ---');

    const opConcurrency = (await client.query(`
      INSERT INTO public.payment_orders (empresa_id, code, provider_id, status, created_by)
      VALUES ($1, 'OP-CONCURRENCY-01', $2, 'EMITIDA', $3) RETURNING id;
    `, [empresaA, provA, userA])).rows[0].id;

    const invConcurrency = (await client.query(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, invoice_number, invoice_date, currency, total, status, created_by
      ) VALUES ($1, $2, 'INV-CONC-01', current_date, 'PYG', 500000, 'APTO_PARA_PAGO', $3) RETURNING id;
    `, [empresaA, provA, userA])).rows[0].id;

    await client.query(`
      INSERT INTO public.payment_order_invoices (empresa_id, payment_order_id, invoice_id)
      VALUES ($1, $2, $3);
    `, [empresaA, opConcurrency, invConcurrency]);

    const p1 = execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opConcurrency, ctaA]);
    const p2 = execAsUser(userA, 'SELECT public.ejecutar_orden_pago_atomica($1, $2, $3)', [empresaA, opConcurrency, ctaA]);
    const [res1, res2] = await Promise.all([p1, p2]);

    const oneSucceededOneFailed = (res1.success && !res2.success) || (!res1.success && res2.success);
    const movsConcCount = (await client.query('SELECT count(*) FROM public.movimientos_tesoreria WHERE payment_order_id = $1', [opConcurrency])).rows[0].count;

    record(
      'Concurrencia: exactamente una ejecución tiene éxito y no hay doble egreso',
      '1 SUCCESS, 1 FAIL, 1 MOVIMIENTO',
      `${res1.success ? 'OK' : 'FAIL'} / ${res2.success ? 'OK' : 'FAIL'}, movs: ${movsConcCount}`,
      oneSucceededOneFailed && Number(movsConcCount) === 1
    );

  } catch (globalErr: any) {
    console.error('❌ EXCEPCIÓN NO CONTROLADA EN INTEGRACIÓN POSTGRESQL:', globalErr);
    record('Ejecución global de suite de integración', 'SUCCESS', globalErr.message, false);
  } finally {
    await client.end();
  }

  // Resumen final
  console.log('\n================================================================');
  console.log('📊 RESUMEN FINAL DE INTEGRACIÓN POSTGRESQL REAL P0:');
  console.log('================================================================');
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`Total Casos Evaluados: ${total}`);
  console.log(`Pasados:                ${passed}`);
  console.log(`Fallidos:               ${failed}`);

  if (failed > 0) {
    console.error('\n❌ VEREDICTO: P0 POSTGRESQL INTEGRATION: FAIL\n');
    process.exit(1);
  } else {
    console.log('\n🎉 VEREDICTO: P0 POSTGRESQL INTEGRATION: PASS\n');
    process.exit(0);
  }
}

run();
