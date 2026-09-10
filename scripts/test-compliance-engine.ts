/**
 * TEST SUITE: COMPLIANCE ENGINE (GATE 11)
 * Evalúa pliegos de bases y condiciones complejos de obras viales (MOPC) y civiles:
 * 1. Requisitos legales y fiscales
 * 2. Ratios financieros (Liquidez corriente)
 * 3. Experiencia acumulada en montos y kilómetros
 * 4. Disponibilidad de maquinaria pesada
 * 5. Determinación de elegibilidad estricta (isEligibleToBid)
 */

import { evaluateTenderCompliance, TenderRequirement } from '../lib/procurement/compliance-engine';
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
  console.log('🧪 TEST SUITE: COMPLIANCE ENGINE (GATE 11)');
  console.log('======================================================\n');

  // Bóveda de la empresa
  const mockVault: VaultItem[] = [
    {
      id: 'v-legal',
      empresaId: 'emp-1',
      categoria: 'LEGAL',
      tipoDocumento: 'ESTATUTO_SOCIAL',
      titulo: 'Estatuto Social',
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
      titulo: 'Constancia Tributaria DNIT',
      esVencible: true,
      metadatos: {},
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2026-02-01',
      updatedAt: '2026-02-01'
    },
    {
      id: 'v-exp1',
      empresaId: 'emp-1',
      categoria: 'EXPERIENCIA',
      tipoDocumento: 'CERTIFICADO_OBRA',
      titulo: 'Pavimentación Asfáltica Ruta PY02',
      esVencible: false,
      metadatos: {
        monto_ejecutado_pyg: 25000000000, // 25.000 Millones
        km_pavimentados: 20
      },
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2024-05-10',
      updatedAt: '2024-05-10'
    },
    {
      id: 'v-equip',
      empresaId: 'emp-1',
      categoria: 'MAQUINARIA',
      tipoDocumento: 'TITULO_PROPIEDAD_EQUIPO',
      titulo: 'Motoniveladora CAT 140M',
      esVencible: false,
      metadatos: { potencia_hp: 190 },
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2024-01-15',
      updatedAt: '2024-01-15'
    }
  ];

  // CASO 1: Pliego MOPC con requisitos cumplibles
  console.log('--- TEST 1: Pliego MOPC Vial (Empresa Cumplidora) ---');
  const pliegoMopc: TenderRequirement[] = [
    { id: 'req-1', categoria: 'LEGAL', descripcion: 'Estatuto Social protocolizado e inscripto', esExcluyente: true, criterio: { tipoDocEsperado: 'ESTATUTO_SOCIAL' } },
    { id: 'req-2', categoria: 'FISCAL', descripcion: 'Certificado de Cumplimiento Tributario vigente', esExcluyente: true, criterio: { tipoDocEsperado: 'DNIT_CCT' } },
    { id: 'req-3', categoria: 'FINANCIERO', descripcion: 'Ratio de liquidez corriente mayor o igual a 1.2', esExcluyente: true, criterio: { ratioLiquidezMinimo: 1.2 } },
    { id: 'req-4', categoria: 'EXPERIENCIA', descripcion: 'Experiencia mínima en obras viales de Gs. 20.000M y 15 km', esExcluyente: true, criterio: { montoMinimoPyg: 20000000000, kmMinimos: 15 } },
    { id: 'req-5', categoria: 'MAQUINARIA', descripcion: 'Disponibilidad de motoniveladora de al menos 140 HP', esExcluyente: false, criterio: { potenciaHpMinima: 140 } }
  ];

  const report1 = evaluateTenderCompliance('LIC-MOPC-01', pliegoMopc, mockVault, { liquidezCorriente: 1.45 });
  console.log(`Dictamen Pliego MOPC: Elegible para ofertar = ${report1.isEligibleToBid} | Score = ${report1.scoreCumplimientoPct}% | Cumplidos: ${report1.cumplidosCount}/${report1.totalRequirements}`);

  assert(report1.isEligibleToBid === true, 'Empresa habilitada para ofertar en licitación MOPC');
  assert(report1.cumplidosCount === 5, '5 de 5 requerimientos en estado CUMPLIDO');
  assert(report1.scoreCumplimientoPct === 100, 'Score de cumplimiento es 100%');

  // CASO 2: Pliego con Requisito Excluyente Incumplido (Falta de Experiencia)
  console.log('\n--- TEST 2: Pliego Megapuente (Requisito Excluyente Incumplido) ---');
  const pliegoMegaPuente: TenderRequirement[] = [
    { id: 'p-1', categoria: 'LEGAL', descripcion: 'Estatuto Social', esExcluyente: true, criterio: { tipoDocEsperado: 'ESTATUTO_SOCIAL' } },
    { id: 'p-2', categoria: 'FINANCIERO', descripcion: 'Ratio de liquidez corriente mínimo 1.5', esExcluyente: true, criterio: { ratioLiquidezMinimo: 1.5 } }, // Empresa tiene 1.45
    { id: 'p-3', categoria: 'EXPERIENCIA', descripcion: 'Experiencia mínima acumulada de Gs. 100.000M', esExcluyente: true, criterio: { montoMinimoPyg: 100000000000 } } // Empresa tiene 25.000M
  ];

  const report2 = evaluateTenderCompliance('LIC-MEGAPUENTE', pliegoMegaPuente, mockVault, { liquidezCorriente: 1.45 });
  console.log(`Dictamen Megapuente: Elegible = ${report2.isEligibleToBid} | Faltantes = ${report2.faltantesCount} | Score = ${report2.scoreCumplimientoPct}%`);

  assert(report2.isEligibleToBid === false, 'Detecta correctamente que NO es elegible para licitar debido a fallas excluyentes');
  assert(report2.faltantesCount === 2, 'Detecta exactamente 2 requerimientos faltantes excluyentes (Liquidez y Experiencia)');

  // CASO 3: Inferencia dinámica de requerimientos desde metadatos de licitación
  console.log('\n--- TEST 3: Inferencia Dinámica de Requisitos (extractRequirementsFromTender) ---');
  const { extractRequirementsFromTender } = await import('../lib/procurement/compliance-engine');
  
  const inferredObras = extractRequirementsFromTender({
    id: 'lic-obra-1',
    categoria: 'works',
    procurement_method: 'open',
    monto_referencial: 15000000000 // 15.000M PYG
  });

  assert(inferredObras.some(r => r.categoria === 'LEGAL'), 'Incluye requisito Legal');
  assert(inferredObras.some(r => r.categoria === 'FISCAL'), 'Incluye requisito Fiscal');
  assert(inferredObras.some(r => r.categoria === 'FINANCIERO'), 'Incluye requisito Financiero por ser LPN > 1.000M');
  assert(inferredObras.some(r => r.categoria === 'EXPERIENCIA'), 'Incluye requisito de Experiencia en Obras');
  assert(inferredObras.some(r => r.categoria === 'MAQUINARIA'), 'Incluye requisito de Maquinaria vial');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 11 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 11:', err);
  process.exit(1);
});
