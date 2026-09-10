/**
 * TEST SUITE: TENDER OPERATIONS AGENT V1 (GATE 14)
 * Verifica:
 * 1. Generación de Carta de Presentación de Oferta (Formulario 1)
 * 2. Generación de Declaración Jurada de Inhabilidades Art. 40 (Formulario 2)
 * 3. Armado de Planilla Económica de Precios Unitarios (Formulario 3)
 * 4. Vinculación probatoria de documentos vigentes desde el Bid Vault
 * 5. Ensamblaje de paquete en estado READY_TO_SIGN
 */

import { assembleTenderPackage, TenderBidItemInput } from '../lib/procurement/tender-operations';
import { VaultItem } from '../lib/procurement/bid-vault';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: TENDER OPERATIONS AGENT (GATE 14)');
  console.log('======================================================\n');

  // Documentos en bóveda de la constructora
  const mockVault: VaultItem[] = [
    {
      id: 'v-legal',
      empresaId: 'emp-1',
      categoria: 'LEGAL',
      tipoDocumento: 'ESTATUTO_SOCIAL',
      titulo: 'Estatuto Social Modificado',
      esVencible: false,
      metadatos: {},
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01'
    },
    {
      id: 'v-fiscal',
      empresaId: 'emp-1',
      categoria: 'FISCAL',
      tipoDocumento: 'DNIT_CCT',
      titulo: 'Constancia de Cumplimiento Tributario DNIT',
      esVencible: true,
      metadatos: {},
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2026-02-01',
      updatedAt: '2026-02-01'
    },
    {
      id: 'v-exp',
      empresaId: 'emp-1',
      categoria: 'EXPERIENCIA',
      tipoDocumento: 'CERTIFICADO_OBRA',
      titulo: 'Certificado de Pavimentación Asfáltica',
      esVencible: false,
      metadatos: { monto_ejecutado_pyg: 30000000000 },
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2024-05-10',
      updatedAt: '2024-05-10'
    }
  ];

  // Ítems cotizados con el Cost Engine
  const itemsCotizados: TenderBidItemInput[] = [
    { itemNumber: 1, description: 'Replanteo y Marcación de Obras Viales', unit: 'GL', quantity: 1, unitPricePyg: 15000000 },
    { itemNumber: 2, description: 'Excavación en Suelo Común', unit: 'M3', quantity: 2500, unitPricePyg: 38000 },
    { itemNumber: 3, description: 'Sub-base de Suelo Cemento e=0.15m', unit: 'M3', quantity: 1200, unitPricePyg: 145000 },
    { itemNumber: 4, description: 'Carpeta Asfáltica en Caliente con Asfalto Modificado e=0.05m', unit: 'M2', quantity: 8000, unitPricePyg: 95000 }
  ];

  // CASO 1: Ensamblaje Exitoso de Oferta Completa
  console.log('--- TEST 1: Ensamblaje Completo (READY_TO_SIGN) ---');
  const pkg1 = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'Ministerio de Obras Públicas y Comunicaciones',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: mockVault
  });

  console.log(`Estado del Paquete: ${pkg1.packageStatus} | Formularios: ${pkg1.preparedForms.length} | Documentos Adjuntos: ${pkg1.attachedEvidenceDocs.length} | Monto Total: Gs. ${pkg1.totalOfferAmountPyg.toLocaleString('es-PY')}`);

  assert(pkg1.packageStatus === 'READY_TO_SIGN', 'Paquete de licitación armado en estado READY_TO_SIGN');
  assert(pkg1.totalOfferAmountPyg === 15000000 + 2500 * 38000 + 1200 * 145000 + 8000 * 95000, 'Cálculo aritmético de monto total es exacto (Gs. 1.044.000.000)');
  assert(pkg1.preparedForms.length === 3, 'Generados los 3 formularios canónicos (Carta, Declaración, Planilla)');
  assert(pkg1.attachedEvidenceDocs.length === 3, 'Vinculados los 3 documentos probatorios desde la Bóveda');
  assert(pkg1.validationErrors.length === 0, 'Cero errores de validación');

  // CASO 2: Detección de Faltantes y Estado Incompleto
  console.log('\n--- TEST 2: Ensamblaje con Documento Faltante en Bóveda ---');
  const vaultIncompleto = mockVault.filter(v => v.categoria !== 'FISCAL');
  const pkg2 = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: vaultIncompleto
  });

  console.log(`Estado con Falta Fiscal: ${pkg2.packageStatus} | Errores: ${pkg2.validationErrors.join(', ')}`);
  assert(pkg2.packageStatus === 'DRAFT_INCOMPLETE', 'Identifica correctamente que la oferta está incompleta');
  assert(pkg2.validationErrors.some(e => e.includes('FISCAL')), 'Reporta omisión de documento fiscal');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 14 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 14:', err);
  process.exit(1);
});
