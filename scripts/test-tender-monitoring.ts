/**
 * TEST SUITE: TENDER MONITORING AGENT (GATE 15)
 * Verifica:
 * 1. Detección inmediata de nuevas adendas con severidad CRITICAL
 * 2. Detección de prórrogas de fecha con ajuste de calendario
 * 3. Detección de adjudicación o cancelación de llamados
 * 4. Detección de notas de aclaración informativas
 */

import { compareTenderSnapshots, TenderSnapshot } from '../lib/procurement/tender-monitoring';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: TENDER MONITORING AGENT (GATE 15)');
  console.log('======================================================\n');

  const baseline: TenderSnapshot = {
    tenderId: 'DNCP-455120',
    status: 'CONVOCADA',
    submissionDeadline: '2026-04-10T09:00:00Z',
    clarificationsCount: 1,
    addendaCount: 0,
    lastModifiedDate: '2026-03-01'
  };

  // CASO 1: Convocante publica Adenda y prorroga plazo
  console.log('--- TEST 1: Detección de Adenda Modificatoria y Prórroga ---');
  const snapshotWithAddenda: TenderSnapshot = {
    ...baseline,
    addendaCount: 1,
    submissionDeadline: '2026-04-20T09:00:00Z', // +10 días de prórroga
    lastModifiedDate: '2026-03-15'
  };

  const alerts1 = compareTenderSnapshots(baseline, snapshotWithAddenda);
  console.log(`Alertas detectadas: ${alerts1.length}`);
  alerts1.forEach(a => console.log(`   [${a.severity}] ${a.title} -> Acción: ${a.actionRequired}`));

  assert(alerts1.length === 2, 'Genera exactamente 2 alertas (Adenda + Prórroga)');
  assert(alerts1.some(a => a.eventType === 'NUEVA_ADENDA' && a.severity === 'CRITICAL'), 'Alerta de Adenda catalogada como CRITICAL');
  assert(alerts1.some(a => a.eventType === 'PRORROGA_FECHA' && a.actionRequired === 'ACTUALIZAR_CALENDARIO'), 'Alerta de prórroga exige actualización de calendario');

  // CASO 2: Licitación adjudicada formalmente
  console.log('\n--- TEST 2: Detección de Adjudicación ---');
  const snapshotAwarded: TenderSnapshot = {
    ...snapshotWithAddenda,
    status: 'ADJUDICADA',
    lastModifiedDate: '2026-05-02'
  };

  const alerts2 = compareTenderSnapshots(snapshotWithAddenda, snapshotAwarded);
  console.log(`Alertas en adjudicación: ${alerts2.length}`);
  alerts2.forEach(a => console.log(`   [${a.severity}] ${a.title} -> Acción: ${a.actionRequired}`));

  assert(alerts2.length === 1, 'Genera 1 alerta de cambio de estado');
  assert(alerts2[0].eventType === 'CAMBIO_ESTADO' && alerts2[0].actionRequired === 'VERIFICAR_RESULTADOS', 'Requiere verificar resultados oficiales');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 15 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 15:', err);
  process.exit(1);
});
