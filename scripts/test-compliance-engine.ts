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

  const report1 = evaluateTenderCompliance(
    'LIC-MOPC-01',
    pliegoMopc,
    mockVault,
    { liquidezCorriente: 1.45 },
    'EXTRACTED_FROM_PBC'
  );
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

  const report2 = evaluateTenderCompliance(
    'LIC-MEGAPUENTE',
    pliegoMegaPuente,
    mockVault,
    { liquidezCorriente: 1.45 },
    'EXTRACTED_FROM_PBC'
  );
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

  // CASO 4: Extracción real desde texto del Pliego de Bases y Condiciones (PBC)
  console.log('\n--- TEST 4: Extracción Determinística desde PBC Oficial (extractRequirementsFromPbcText) ---');
  const { extractRequirementsFromPbcText } = await import('../lib/procurement/pbc-extractor');

  const pbcRealista = `
    PLIEGO DE BASES Y CONDICIONES - LLAMADO A LICITACIÓN PÚBLICA NACIONAL N° 12/2026
    CONTRATACIÓN DE OBRAS DE PAVIMENTACIÓN ASFÁLTICA Y OBRAS DE ARTE
    PRESUPUESTO ESTIMADO: Gs. 20.000.000.000 (VEINTE MIL MILLONES DE GUARANÍES)

    SECCIÓN I: INSTRUCCIONES A LOS OFERENTES
    1.1 CAPACIDAD LEGAL:
    Los oferentes deberán presentar Estatutos Sociales inscriptos en el Registro Público y Poder del Representante Legal.
    Asimismo, deberán adjuntar Declaración Jurada de no encontrarse inhabilitados para contratar conforme al Art. 40 de la Ley 2051/03 y Ley 7021/22.

    SECCIÓN II: SOLVENCIA TRIBUTARIA Y SOCIAL
    2.1 El oferente presentará el Certificado de Cumplimiento Tributario (CCT) emitido por la DNIT vigente a la fecha de apertura.
    2.2 Constancia expedida por el Instituto de Previsión Social (IPS) de no adeudar aportes obrero-patronales.

    SECCIÓN III: CAPACIDAD FINANCIERA
    3.1 Se requerirá balance auditado de los últimos tres ejercicios fiscales cerrados.
    3.2 El ratio de liquidez corriente mínima exigida será mayor o igual a 1.2.
    3.3 El ratio de endeudamiento máximo admitido no superará 0.80.

    SECCIÓN IV: EXPERIENCIA TÉCNICA
    4.1 Experiencia mínima acumulada en obras viales similares de al menos Gs. 10.000.000.000 en los últimos 5 años.
    4.2 El oferente deberá acreditar la disponibilidad de equipo vial mínimo consistente en Motoniveladora de 140 HP. Se autoriza el arrendamiento mediante carta de compromiso de disponibilidad.
    4.3 Se exigirá la designación de un Jefe de Obra que sea Ingeniero Civil matriculado. Se permite carta de compromiso de prestar servicios.
  `;

  const extraction = extractRequirementsFromPbcText(pbcRealista, 20000000000);
  console.log(`Requisitos extraídos: ${extraction.requirements.length} | Secciones detectadas: ${extraction.detectedSections.join(', ')} | Confianza: ${extraction.extractionConfidencePct}%`);

  assert(extraction.requirements.length >= 6, 'Extrae al menos 6 requisitos formales del pliego');
  assert(extraction.detectedSections.includes('CAPACIDAD_LEGAL'), 'Detecta sección legal');
  assert(extraction.detectedSections.includes('SOLVENCIA_FISCAL'), 'Detecta sección fiscal');
  assert(extraction.detectedSections.includes('CAPACIDAD_FINANCIERA'), 'Detecta sección financiera');
  assert(extraction.detectedSections.includes('EXPERIENCIA_TECNICA'), 'Detecta sección técnica');

  // 1. Con bóveda incompleta (le faltan IPS y Declaración Jurada Art. 40), DEBE fallar cerrado
  const pbcComplianceIncomplete = evaluateTenderCompliance(
    'LIC-PBC-REAL-01',
    extraction.requirements,
    mockVault,
    { liquidezCorriente: 1.45, endeudamientoTotal: 0.65 },
    'EXTRACTED_FROM_PBC'
  );

  console.log(`Evaluación con PBC Real (Bóveda incompleta): Elegible = ${pbcComplianceIncomplete.isEligibleToBid} | Score = ${pbcComplianceIncomplete.scoreCumplimientoPct}% | Faltantes = ${pbcComplianceIncomplete.faltantesCount}`);
  assert(pbcComplianceIncomplete.evidenceOrigin === 'EXTRACTED_FROM_PBC', 'Origen de evidencia es EXTRACTED_FROM_PBC');
  assert(pbcComplianceIncomplete.isEligibleToBid === false, 'Falla cerrado si el PBC exige IPS y Art 40 y la bóveda no los posee');

  // 2. Con bóveda integral completa (posee Estatutos, Art 40, DNIT, IPS, Maquinaria, Experiencia y Personal)
  const completeVault: VaultItem[] = [
    ...mockVault,
    {
      id: 'v-art40',
      empresaId: 'emp-1',
      categoria: 'LEGAL',
      tipoDocumento: 'DECLARACION_JURADA',
      titulo: 'Declaración Jurada Art. 40 Ley 2051/03',
      esVencible: false,
      metadatos: {},
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    },
    {
      id: 'v-ips',
      empresaId: 'emp-1',
      categoria: 'FISCAL',
      tipoDocumento: 'CERTIFICADO_NO_ADEUDAR_IPS',
      titulo: 'Certificado de No Adeudar IPS',
      esVencible: true,
      metadatos: {},
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2026-02-15',
      updatedAt: '2026-02-15'
    },
    {
      id: 'v-personal',
      empresaId: 'emp-1',
      categoria: 'PERSONAL',
      tipoDocumento: 'MATRICULA_PROFESIONAL',
      titulo: 'Ing. Civil Residente / Jefe de Obra',
      esVencible: false,
      metadatos: { cargo: 'Jefe de Obra', experiencia_anos: 12 },
      estado: 'VIGENTE',
      version: 1,
      createdAt: '2025-01-01',
      updatedAt: '2025-01-01'
    }
  ];

  const pbcComplianceComplete = evaluateTenderCompliance(
    'LIC-PBC-REAL-01',
    extraction.requirements,
    completeVault,
    { liquidezCorriente: 1.45, endeudamientoTotal: 0.65 },
    'EXTRACTED_FROM_PBC'
  );

  console.log(`Evaluación con PBC Real (Bóveda completa): Elegible = ${pbcComplianceComplete.isEligibleToBid} | Score = ${pbcComplianceComplete.scoreCumplimientoPct}% | Cumplidos = ${pbcComplianceComplete.cumplidosCount}/${pbcComplianceComplete.totalRequirements}`);
  assert(pbcComplianceComplete.isEligibleToBid === true, 'Confiere habilitación formal cuando todos los requisitos del PBC real están cubiertos');
  assert(pbcComplianceComplete.cumplidosCount >= 6, 'Al menos 6 requisitos quedan formalmente CUMPLIDOS con documentación vigente');

  // CASO 5: P0 FAIL-CLOSED: Array de Requerimientos Vacío NUNCA Habilita
  console.log('\n--- TEST 5: Array Vacío de Requisitos NUNCA Habilita (Fail-Closed) ---');
  const emptyReport = evaluateTenderCompliance('LIC-VACIA', [], completeVault, { liquidezCorriente: 2.0 }, 'EXTRACTED_FROM_PBC');
  assert(emptyReport.isEligibleToBid === false, 'Array vacío nunca confiere isEligibleToBid=true');
  assert(emptyReport.scoreCumplimientoPct === 0, 'Array vacío nunca otorga score=100%, otorga score=0%');
  assert(emptyReport.totalRequirements === 0, 'Total de requisitos es 0');

  // CASO 6: P0 INVARIANTE: Criterio Desconocido en Pliego NO Inventa 1.2 ni 50% ni 120 HP
  console.log('\n--- TEST 6: Cero Supuestos Sintéticos ante Criterio no Cuantificado ---');
  const pbcTextoVago = `
    El oferente deberá presentar balance auditado demostrando solvencia y liquidez corriente.
    Asimismo deberá acreditar experiencia acumulada en obras civiles similares y maquinaria propia.
  `;
  const extractionVaga = extractRequirementsFromPbcText(pbcTextoVago, 10000000000);
  const reqLiq = extractionVaga.requirements.find(r => r.id === 'pbc-fin-liquidez');
  const reqExp = extractionVaga.requirements.find(r => r.id === 'pbc-exp-obras');
  const reqMaq = extractionVaga.requirements.find(r => r.id === 'pbc-maq-vial');

  assert(reqLiq !== undefined && reqLiq.extractionState === 'CRITERION_UNKNOWN', 'Liquidez sin número marcado como CRITERION_UNKNOWN (no 1.2 inventado)');
  assert(reqLiq?.criterio.ratioLiquidezMinimo === undefined, 'No inventa ratioLiquidezMinimo = 1.2');

  assert(reqExp !== undefined && reqExp.extractionState === 'CRITERION_UNKNOWN', 'Experiencia sin monto marcado como CRITERION_UNKNOWN (no 50% inventado)');
  assert(reqExp?.criterio.montoMinimoPyg === undefined, 'No inventa montoMinimoPyg = 50% del referencial');

  assert(reqMaq !== undefined && reqMaq.extractionState === 'CRITERION_UNKNOWN', 'Maquinaria sin HP marcado como CRITERION_UNKNOWN (no 120 HP inventado)');
  assert(reqMaq?.criterio.potenciaHpMinima === undefined, 'No inventa potenciaHpMinima = 120');

  const evalVaga = evaluateTenderCompliance('LIC-VAGA', extractionVaga.requirements, completeVault, { liquidezCorriente: 1.5 }, 'EXTRACTED_FROM_PBC');
  assert(evalVaga.isEligibleToBid === false, 'Pliego con criterios no especificados falla cerrado a NO elegible');
  assert(evalVaga.evaluations.some(e => e.verdict === 'REVIEW_REQUIRED'), 'Genera dictamen REVIEW_REQUIRED para criterios desconocidos');

  // CASO 7: Maquinaria sin Permiso de Alquiler en Pliego Falla a FALTANTE
  console.log('\n--- TEST 7: Maquinaria sin Permiso Explícito de Alquiler Falla a FALTANTE (No Generable) ---');
  const reqMaqSinPermiso: TenderRequirement = {
    id: 'req-maq-estricta',
    categoria: 'MAQUINARIA',
    descripcion: 'Camión Volquete 15m3 propio',
    esExcluyente: true,
    permiteAlquilerOCompromiso: false, // Pliego NO autoriza alquiler
    criterio: {}
  };
  const vaultSinVolquete = completeVault.filter(v => v.categoria !== 'MAQUINARIA');
  const reportMaq = evaluateTenderCompliance('LIC-MAQ', [reqMaqSinPermiso], vaultSinVolquete, undefined, 'EXTRACTED_FROM_PBC');
  assert(reportMaq.evaluations[0].verdict === 'FALTANTE', 'Sin permiso de alquiler, maquinaria ausente resulta en FALTANTE (no GENERABLE)');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 11 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 11:', err);
  process.exit(1);
});
