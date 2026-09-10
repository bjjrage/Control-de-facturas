/**
 * TEST SUITE: EXTERNAL DOCUMENT CONNECTORS (GATE 10)
 * Verifica:
 * 1. Validación de cumplimiento fiscal DNIT con cálculo de DV.
 * 2. Emisión y vigencia de certificado de solvencia patronal IPS.
 * 3. Verificación de inhabilitaciones en DNCP.
 * 4. Auditoría integral tripartita de cumplimiento público.
 */

import {
  checkDnitCompliance,
  checkIpsCompliance,
  checkDncpInhabilitacion,
  runFullStateComplianceAudit
} from '../lib/procurement/external-connectors';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: EXTERNAL DOCUMENT CONNECTORS (GATE 10)');
  console.log('======================================================\n');

  // TEST 1: RUC Válido de Constructora Paraguaya - Verificación DV y Fail-Closed
  console.log('--- TEST 1: Verificación DNIT con RUC Válido (Fail-Closed) ---');
  const validRuc = '80009735-1'; // RUC real paraguayo (DV = 1)
  const dnitValid = await checkDnitCompliance(validRuc);
  console.log('Resultado DNIT:', dnitValid.statusText);
  assert(dnitValid.isCompliant === false, 'RUC válido retorna fail-closed (isCompliant: false) al no haber conector real configurado');
  assert(dnitValid.statusText.includes('NOT_IMPLEMENTED'), 'Status indica explícitamente NOT_IMPLEMENTED');
  assert(dnitValid.sourceReachable === false, 'sourceReachable es false');

  // TEST 2: Rechazo de RUC Inválido o Malformado
  console.log('\n--- TEST 2: Rechazo Inmediato de RUC Inválido ---');
  const invalidRuc = '12345'; // Sin formato válido
  const dnitInvalid = await checkDnitCompliance(invalidRuc);
  assert(dnitInvalid.isCompliant === false, 'RUC inválido es rechazado de inmediato');
  assert(dnitInvalid.statusText.includes('INVÁLIDO'), 'Mensaje de RUC inválido correcto');

  // TEST 3: Verificación IPS (Fail-Closed)
  console.log('\n--- TEST 3: Verificación Patronal IPS (Fail-Closed) ---');
  const ipsResult = await checkIpsCompliance('80009735-1', 'PAT-9988');
  console.log('Resultado IPS:', ipsResult.statusText);
  assert(ipsResult.isCompliant === false, 'IPS retorna fail-closed');
  assert(ipsResult.statusText.includes('NOT_IMPLEMENTED'), 'Status indica NOT_IMPLEMENTED');

  // TEST 4: Verificación DNCP (Fail-Closed)
  console.log('\n--- TEST 4: Verificación de Inhabilitaciones DNCP (Fail-Closed) ---');
  const dncpResult = await checkDncpInhabilitacion('80009735-1');
  console.log('Resultado DNCP:', dncpResult.statusText);
  assert(dncpResult.isCompliant === false, 'DNCP retorna fail-closed');
  assert(dncpResult.statusText.includes('NOT_IMPLEMENTED'), 'Status indica NOT_IMPLEMENTED');

  // TEST 5: Auditoría Integral Tripartita (Fail-Closed)
  console.log('\n--- TEST 5: Auditoría Estatal Consolidada (Fail-Closed) ---');
  const fullAudit = await runFullStateComplianceAudit('80009735-1', 'PAT-9988');
  console.log(`Auditoría consolidada para RUC ${fullAudit.ruc}: ${fullAudit.allCompliant ? '100% CUMPLIDO' : 'FAIL-CLOSED / RECHAZADO POR SEGURIDAD'}`);
  assert(fullAudit.allCompliant === false, 'La auditoría es fail-closed mientras no existan conexiones oficiales reales');
  assert(!fullAudit.results.dnit.isCompliant && !fullAudit.results.ips.isCompliant && !fullAudit.results.dncp.isCompliant, 'Ningún ente estatal genera certificados falsos');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 10 (FAIL-CLOSED) PASARON');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 10:', err);
  process.exit(1);
});
