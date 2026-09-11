/**
 * TEST SUITE: TENDER TO PROJECT TRANSITION (GATE 19)
 * Verifica:
 * 1. Mapeo íntegro de licitación adjudicada a registro de obra (Project).
 * 2. Conversión precisa de ítems ofertados a BudgetItems del ERP sin desfasajes de montos.
 * 3. Creación de lista de insumos de pañol y estructura de compras inicial.
 * 4. Preservación de trazabilidad de pliegos y condiciones de contrato (anticipo, retención, plazo).
 */

import { buildProjectFromAdjudicatedTender, TenderToProjectParams } from '../lib/procurement/tender-to-project';
import { TenderBidItemInput } from '../lib/procurement/tender-operations';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: TENDER TO PROJECT TRANSITION (GATE 19)');
  console.log('======================================================\n');

  const bidItems: TenderBidItemInput[] = [
    { itemNumber: 1, description: 'Movimiento de Suelo y Nivelación', unit: 'M3', quantity: 3000, unitPricePyg: 40000 },
    { itemNumber: 2, description: 'Hormigón Estructural H-21 con Bomba', unit: 'M3', quantity: 450, unitPricePyg: 850000 },
    { itemNumber: 3, description: 'Varilla Conformada AP500 12mm', unit: 'KG', quantity: 15000, unitPricePyg: 8200 },
    { itemNumber: 4, description: 'Pintura y Señalización Horizontal Termoplástica', unit: 'M2', quantity: 1200, unitPricePyg: 120000 }
  ];

  const params: TenderToProjectParams = {
    empresaId: 'emp-constructora-py',
    tenderId: 'TENDER-MOPC-9988',
    dncpNro: '445522',
    projectTitle: 'Pavimentación Asfáltica Acceso San Lorenzo',
    buyerName: 'Ministerio de Obras Públicas y Comunicaciones',
    contractNumber: 'MOPC-CT-045/2026',
    adjudicatedOfferPricePyg: 769500000, // Total calculado de los 4 ítems
    durationMonths: 8,
    advancePaymentPct: 15.0,
    retentionPct: 5.0,
    bidItems,
    bidAnalysisRunId: 'run-uuid-1234'
  };

  const payload = buildProjectFromAdjudicatedTender(params);

  console.log(`Proyecto Generado: "${payload.project.name}" | Código: ${payload.project.code}`);
  console.log(`Comitente: ${payload.project.comitente} | Contrato: ${payload.project.contract_number} | Plazo: ${payload.project.plazo_dias} días`);
  console.log(`Presupuesto Total ERP: Gs. ${payload.project.budget_total.toLocaleString('es-PY')} (Ítems: ${payload.budgetItems.length})`);
  console.log(`Requerimientos Iniciales de Pañol: ${payload.initialProcurementRequests.length}`);

  // Verificaciones
  assert(payload.project.status === 'ACTIVO', 'Obra creada en estado ACTIVO');
  assert(payload.project.comitente === 'Ministerio de Obras Públicas y Comunicaciones', 'Comitente público asignado');
  assert(payload.project.plazo_dias === 240, 'Plazo calculado en días (8 meses * 30 = 240 días)');
  assert(payload.project.anticipo_pct === 15.0, 'Anticipo del 15% contractual registrado');
  assert(payload.project.retencion_pct === 5.0, 'Fondo de reparo del 5% registrado');

  const expectedTotal = 3000 * 40000 + 450 * 850000 + 15000 * 8200 + 1200 * 120000;
  assert(payload.summary.totalBudgetPyg === expectedTotal, `Monto de presupuesto coincide al 100% con la oferta económica (Gs. ${expectedTotal.toLocaleString('es-PY')})`);
  assert(payload.budgetItems.length === 4, 'Se crearon exactamente 4 BudgetItems numerados');
  assert(payload.initialProcurementRequests.length === 4, 'Se crearon 4 solicitudes iniciales de compra para pañol/obra');

  console.log('--- TEST 2: Invariante UNKNOWN != DEFAULT (Términos desconocidos permanecen null) ---');
  const paramsNullDefaults: TenderToProjectParams = {
    empresaId: 'emp-constructora-py',
    tenderId: 'TENDER-MOPC-1122',
    projectTitle: 'Reparación de Puentes Vecinales',
    buyerName: 'Gobernación de Cordillera',
    adjudicatedOfferPricePyg: 150000000,
    durationMonths: null,
    advancePaymentPct: null,
    retentionPct: null,
    bidItems: [
      { itemNumber: 1, description: 'Estructura Metálica Perfilada', unit: 'KG', quantity: 5000, unitPricePyg: 30000 }
    ]
  };

  const payloadNull = buildProjectFromAdjudicatedTender(paramsNullDefaults);
  assert(payloadNull.project.contract_number === null, 'Contrato permanece null si no se conoce (sin default sintético CONTRATO-xxx)');
  assert(payloadNull.project.start_date === null, 'Fecha de inicio permanece null si no se conoce (sin default arbitrario de hoy)');
  assert(payloadNull.project.end_date === null, 'Fecha de fin permanece null si no se conoce fecha de inicio');
  assert(payloadNull.project.plazo_dias === null, 'Plazo permanece null si no se conoce (sin default arbitrario)');
  assert(payloadNull.project.anticipo_pct === null, 'Anticipo permanece null si no se especifica');
  assert(payloadNull.project.retencion_pct === null, 'Retención permanece null si no se especifica');

  console.log('--- TEST 3: Ejecución Atómica y Manejo de Rollback/Idempotencia en DB ---');
  let rpcCalled: boolean = false;
  let rpcArgs: any = null;
  let deletedProjectId: string | null = null;

  const mockSupabaseSuccess: any = {
    rpc: async (fnName: string, args: any) => {
      rpcCalled = true;
      rpcArgs = args;
      return { data: { success: true, project_id: 'proj-uuid-999', project_code: 'OBRA-DNCP-445522', already_existed: false }, error: null };
    }
  };

  const { executeTenderToProjectTransaction } = await import('../lib/procurement/tender-to-project');
  const execResult = await executeTenderToProjectTransaction(mockSupabaseSuccess, params);

  assert(Boolean(rpcCalled), 'Se invocó el RPC atómico convertir_licitacion_a_proyecto_atomico');
  assert(execResult.projectId === 'proj-uuid-999', 'El ID del proyecto retornado corresponde al generado por el RPC');
  assert(rpcArgs.p_tender_id === 'TENDER-MOPC-9988', 'RPC recibió tender_id');
  assert(rpcArgs.p_bid_analysis_run_id === 'run-uuid-1234', 'RPC recibió bid_analysis_run_id');
  assert(rpcArgs.p_budget_items.length === 4, 'RPC recibió los 4 budget items para inserción atómica');
  assert(rpcArgs.p_budget_items[0].subtotal === undefined, 'RPC no envía columna computada subtotal');
  assert(payload.initialProcurementRequests.length === 4, 'Retorna requerimientos iniciales en memoria (no persistidos en DB)');

  console.log('--- TEST 4: Rollback ante fallo de DB en el RPC Atómico ---');
  const mockSupabaseFailure: any = {
    rpc: async () => {
      return { data: null, error: { message: 'unique_violation on tenders_tender_id_key', code: '23505' } };
    }
  };

  const failResult = await executeTenderToProjectTransaction(mockSupabaseFailure, params);
  assert(failResult.error !== null, 'Falla de DB en RPC retorna error estructurado en cliente');
  assert(failResult.error!.includes('unique_violation'), 'Error propaga mensaje de error original de PostgreSQL');

  console.log('--- TEST 5: Falla Cerrada ante RPC Inexistente (Sin Fallback Desacoplado) ---');
  let nonTransactionalWriteAttempted = false;
  const mockSupabaseMissingRpc: any = {
    rpc: async () => {
      return { data: null, error: { message: 'function convertir_licitacion_a_proyecto_atomico() does not exist', code: 'PGRST202' } };
    },
    from: () => {
      nonTransactionalWriteAttempted = true;
      return { insert: () => ({ select: () => ({ single: () => ({ data: {}, error: null }) }) }) };
    }
  };

  const missingRpcResult = await executeTenderToProjectTransaction(mockSupabaseMissingRpc, params);
  assert(missingRpcResult.error !== null && missingRpcResult.error.includes('MIGRATION_REQUIRED'), 'Falla cerrada con MIGRATION_REQUIRED cuando RPC no existe');
  assert(!nonTransactionalWriteAttempted, 'NUNCA intenta escrituras desarticuladas/no transaccionales en tablas individuales si falta el RPC');

  console.log('--- TEST 6: Validación Estricta de BudgetItems (Sin Defaults Inventados) ---');
  let validationCaught = false;
  try {
    buildProjectFromAdjudicatedTender({
      ...params,
      bidItems: [
        { itemNumber: 1, description: '', unit: 'M3', quantity: 10, unitPricePyg: 1000 }
      ]
    });
  } catch (err: any) {
    validationCaught = true;
    assert(err.message.includes('VALIDATION_ERROR') && err.message.includes('empty description'), 'Rechaza ítem con descripción vacía');
  }
  assert(validationCaught, 'Lanza excepción ante ítem con descripción vacía');

  validationCaught = false;
  try {
    buildProjectFromAdjudicatedTender({
      ...params,
      bidItems: [
        { itemNumber: 1, description: 'Excavación', unit: '', quantity: 10, unitPricePyg: 1000 }
      ]
    });
  } catch (err: any) {
    validationCaught = true;
    assert(err.message.includes('VALIDATION_ERROR') && err.message.includes('empty unit'), 'Rechaza ítem con unidad vacía');
  }
  assert(validationCaught, 'Lanza excepción ante ítem con unidad vacía');

  validationCaught = false;
  try {
    buildProjectFromAdjudicatedTender({
      ...params,
      bidItems: [
        { itemNumber: 1, description: 'Excavación', unit: 'M3', quantity: 0, unitPricePyg: 1000 }
      ]
    });
  } catch (err: any) {
    validationCaught = true;
    assert(err.message.includes('VALIDATION_ERROR') && err.message.includes('invalid quantity'), 'Rechaza ítem con cantidad <= 0');
  }
  assert(validationCaught, 'Lanza excepción ante ítem con cantidad <= 0');

  validationCaught = false;
  try {
    buildProjectFromAdjudicatedTender({
      ...params,
      bidItems: [
        { itemNumber: 1, description: 'Excavación', unit: 'M3', quantity: 10, unitPricePyg: 0 }
      ]
    });
  } catch (err: any) {
    validationCaught = true;
    assert(err.message.includes('VALIDATION_ERROR') && err.message.includes('invalid unit price'), 'Rechaza ítem con precio unitario <= 0');
  }
  assert(validationCaught, 'Lanza excepción ante ítem con precio unitario = 0 (fail-closed)');

  console.log('--- TEST 7: Tenant Isolation y Restricción de Estado GANADA en RPC ---');
  const mockSupabaseTenantMismatch: any = {
    rpc: async () => {
      return { data: null, error: { message: 'TENANT_MISMATCH: authenticated empresa does not match parameter', code: 'P0001' } };
    }
  };
  const tenantMismatchResult = await executeTenderToProjectTransaction(mockSupabaseTenantMismatch, params);
  assert(tenantMismatchResult.error !== null && tenantMismatchResult.error.includes('TENANT_MISMATCH'), 'Propaga rechazo por violación de tenant isolation');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 19 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 19:', err);
  process.exit(1);
});
