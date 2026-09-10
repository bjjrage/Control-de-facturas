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

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 19 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 19:', err);
  process.exit(1);
});
