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

  // TEST 1: RUC Válido de Constructora Paraguaya
  console.log('--- TEST 1: Verificación DNIT con RUC Válido ---');
  const validRuc = '80009735-1'; // RUC real paraguayo (DV = 1)
  const dnitValid = await checkDnitCompliance(validRuc);
  console.log('Resultado DNIT:', dnitValid.statusText, '| Certificado:', dnitValid.certificateNumber);
  assert(dnitValid.isCompliant === true, 'RUC válido obtiene cumplimiento tributario positivo');
  assert(!!dnitValid.certificateNumber, 'Certificado tributario asignado con número de serie');
  assert(!!dnitValid.expiryDate, 'Fecha de vencimiento calculada');

  // TEST 2: Rechazo de RUC Inválido o Malformado
  console.log('\n--- TEST 2: Rechazo Inmediato de RUC Inválido ---');
  const invalidRuc = '12345'; // Sin formato válido
  const dnitInvalid = await checkDnitCompliance(invalidRuc);
  assert(dnitInvalid.isCompliant === false, 'RUC inválido es rechazado de inmediato');

  // TEST 3: Verificación IPS
  console.log('\n--- TEST 3: Verificación Patronal IPS ---');
  const ipsResult = await checkIpsCompliance('80009735-1', 'PAT-9988');
  console.log('Resultado IPS:', ipsResult.statusText, '| Certificado:', ipsResult.certificateNumber);
  assert(ipsResult.isCompliant === true, 'IPS aprueba solvencia patronal');

  // TEST 4: Verificación DNCP
  console.log('\n--- TEST 4: Verificación de Inhabilitaciones DNCP ---');
  const dncpResult = await checkDncpInhabilitacion('80009735-1');
  console.log('Resultado DNCP:', dncpResult.statusText);
  assert(dncpResult.isCompliant === true, 'DNCP certifica ausencia de inhabilitaciones');

  // TEST 5: Auditoría Integral Tripartita
  console.log('\n--- TEST 5: Auditoría Estatal Consolidada ---');
  const fullAudit = await runFullStateComplianceAudit('80009735-1', 'PAT-9988');
  console.log(`Auditoría consolidada para RUC ${fullAudit.ruc}: ${fullAudit.allCompliant ? '100% CUMPLIDO' : 'OBSERVADO'}`);
  assert(fullAudit.allCompliant === true, 'La constructora cumple con todos los requerimientos estatales');
  assert(fullAudit.results.dnit.isCompliant && fullAudit.results.ips.isCompliant && fullAudit.results.dncp.isCompliant, 'Los 3 entes estatales respondieron satisfactoriamente');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 10 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 10:', err);
  process.exit(1);
});
