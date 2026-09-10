/**
 * TEST SUITE: COMPANY BID VAULT (GATE 9)
 * Verifica:
 * 1. Estructura de documentos por categorías canónicas de licitación
 * 2. Evaluación de vigencias (VIGENTE, POR_VENCER, VENCIDO)
 * 3. Almacenamiento y consulta de metadatos estructurados (montos de experiencia, potencia de maquinaria, matrículas)
 * 4. Resumen de salud documental de la empresa
 */

import { evaluateDocumentValidity, summarizeVaultHealth, VaultItem } from '../lib/procurement/bid-vault';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: COMPANY BID VAULT (GATE 9)');
  console.log('======================================================\n');

  const today = '2026-03-01';

  // TEST 1: Evaluación de vigencia
  console.log('--- TEST 1: Evaluación de Estados de Vigencia ---');
  assert(evaluateDocumentValidity('2026-05-15', true, today) === 'VIGENTE', 'Documento con vencimiento a más de 30 días es VIGENTE');
  assert(evaluateDocumentValidity('2026-03-15', true, today, 30) === 'POR_VENCER', 'Documento con vencimiento dentro de 14 días es POR_VENCER');
  assert(evaluateDocumentValidity('2026-02-15', true, today) === 'VENCIDO', 'Documento vencido hace 14 días es VENCIDO');
  assert(evaluateDocumentValidity(undefined, false, today) === 'VIGENTE', 'Documento no vencible (ej: Estatuto Social) es siempre VIGENTE');

  // TEST 2: Bóveda completa de una constructora paraguaya
  console.log('\n--- TEST 2: Mock de Bóveda Documental Paraguaya ---');
  const mockVault: VaultItem[] = [
    {
      id: 'v1',
      empresaId: 'emp-1',
      categoria: 'LEGAL',
      tipoDocumento: 'ESTATUTO_SOCIAL',
      titulo: 'Estatuto Social Modificado y Protocolizado',
      esVencible: false,
      metadatos: { notario: 'Esc. Juan Perez', nro_escritura: 45 },
      estado: 'VIGENTE',
      version: 2,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01'
    },
    {
      id: 'v2',
      empresaId: 'emp-1',
      categoria: 'FISCAL',
      tipoDocumento: 'CUMPLIMIENTO_TRIBUTARIO_DNIT',
      titulo: 'Constancia de Cumplimiento Tributario DNIT',
      fechaEmision: '2026-02-01',
      fechaVencimiento: '2026-03-15', // Vence en 14 días
      esVencible: true,
      metadatos: { ruc: '80099887-1' },
      estado: 'POR_VENCER',
      version: 1,
      createdAt: '2026-02-01',
      updatedAt: '2026-02-01'
    },
    {
      id: 'v3',
      empresaId: 'emp-1',
      categoria: 'FISCAL',
      tipoDocumento: 'CONSTANCIA_IPS',
      titulo: 'Certificado de no adeudar a IPS',
      fechaEmision: '2026-01-01',
      fechaVencimiento: '2026-01-31', // Vencido
      esVencible: true,
      metadatos: { nro_patronal: '54321' },
      estado: 'VENCIDO',
      version: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    },
    {
      id: 'v4',
      empresaId: 'emp-1',
      categoria: 'EXPERIENCIA',
      tipoDocumento: 'CERTIFICADO_OBRA',
      titulo: 'Pavimentación Asfáltica Tramo San Lorenzo - Luque',
      esVencible: false,
      metadatos: {
        convocante: 'MOPC',
        monto_ejecutado_pyg: 28500000000,
        km_pavimentados: 18.5,
        fecha_recepcion_definitiva: '2023-11-30'
      },
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2024-01-10',
      updatedAt: '2024-01-10'
    },
    {
      id: 'v5',
      empresaId: 'emp-1',
      categoria: 'MAQUINARIA',
      tipoDocumento: 'TITULO_PROPIEDAD_EQUIPO',
      titulo: 'Motoniveladora Caterpillar 140M Año 2022',
      esVencible: false,
      metadatos: {
        marca: 'Caterpillar',
        modelo: '140M',
        potencia_hp: 193,
        chasis: 'CAT0140MA987654'
      },
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2024-02-15',
      updatedAt: '2024-02-15'
    }
  ];

  const health = summarizeVaultHealth(mockVault, today);
  console.log('Resumen de Salud de la Bóveda:', JSON.stringify(health, null, 2));

  assert(health.total === 5, 'Total de documentos en bóveda es 5');
  assert(health.vigentes === 3, '3 documentos en estado VIGENTE');
  assert(health.porVencer === 1, '1 documento POR_VENCER detectado oportunamente');
  assert(health.vencidos === 1, '1 documento VENCIDO alertado');
  assert(health.byCategory.EXPERIENCIA.total === 1, 'Categoría EXPERIENCIA presente con metadatos estructurados');
  assert(health.byCategory.MAQUINARIA.total === 1, 'Categoría MAQUINARIA presente con especificaciones de potencia');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 9 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 9:', err);
  process.exit(1);
});
