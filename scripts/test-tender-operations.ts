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
import { TenderComplianceReport } from '../lib/procurement/compliance-engine';

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

  // Matriz real de cumplimiento extraída del PBC (Gate 11) con 100% de requerimientos resueltos
  const validComplianceReport: TenderComplianceReport = {
    tenderId: 'LIC-MOPC-445566',
    isEligibleToBid: true,
    evidenceOrigin: 'EXTRACTED_FROM_PBC',
    scoreCumplimientoPct: 100,
    totalRequirements: 3,
    cumplidosCount: 3,
    generablesCount: 0,
    faltantesCount: 0,
    reviewRequiredCount: 0,
    evaluations: [
      {
        requirementId: 'pbc-legal-poder',
        categoria: 'LEGAL',
        descripcion: 'Estatutos Sociales y Poder de Representación',
        esExcluyente: true,
        verdict: 'CUMPLIDO',
        documentoRespaldo: { id: 'v-legal', titulo: 'Estatuto Social Modificado', estado: 'VIGENTE' },
        observaciones: 'Vigente y verificado'
      },
      {
        requirementId: 'pbc-fiscal-cct',
        categoria: 'FISCAL',
        descripcion: 'Certificado de Cumplimiento Tributario DNIT',
        esExcluyente: true,
        verdict: 'CUMPLIDO',
        documentoRespaldo: { id: 'v-fiscal', titulo: 'Constancia de Cumplimiento Tributario DNIT', estado: 'VIGENTE' },
        observaciones: 'Vigente al día'
      },
      {
        requirementId: 'pbc-exp-asfalto',
        categoria: 'EXPERIENCIA',
        descripcion: 'Experiencia técnica acumulada en obras viales',
        esExcluyente: true,
        verdict: 'CUMPLIDO',
        documentoRespaldo: { id: 'v-exp', titulo: 'Certificado de Pavimentación Asfáltica', estado: 'VIGENTE' },
        observaciones: 'Supera el monto mínimo'
      }
    ]
  };

  // Ítems cotizados con el Cost Engine
  const itemsCotizados: TenderBidItemInput[] = [
    { itemNumber: 1, description: 'Replanteo y Marcación de Obras Viales', unit: 'GL', quantity: 1, unitPricePyg: 15000000 },
    { itemNumber: 2, description: 'Excavación en Suelo Común', unit: 'M3', quantity: 2500, unitPricePyg: 38000 },
    { itemNumber: 3, description: 'Sub-base de Suelo Cemento e=0.15m', unit: 'M3', quantity: 1200, unitPricePyg: 145000 },
    { itemNumber: 4, description: 'Carpeta Asfáltica en Caliente con Asfalto Modificado e=0.05m', unit: 'M2', quantity: 8000, unitPricePyg: 95000 }
  ];

  // CASO 1: Ensamblaje Exitoso de Oferta Completa con Matriz PBC Resuelta
  console.log('--- TEST 1: Ensamblaje Completo (READY_TO_SIGN con PBC Resuelto) ---');
  const pkg1 = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'Ministerio de Obras Públicas y Comunicaciones',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: mockVault,
    complianceReport: validComplianceReport
  });

  console.log(`Estado del Paquete: ${pkg1.packageStatus} | Formularios: ${pkg1.preparedForms.length} | Documentos Adjuntos: ${pkg1.attachedEvidenceDocs.length} | Monto Total: Gs. ${pkg1.totalOfferAmountPyg.toLocaleString('es-PY')}`);

  assert(pkg1.packageStatus === 'READY_TO_SIGN', 'Paquete de licitación armado en estado READY_TO_SIGN');
  assert(pkg1.totalOfferAmountPyg === 15000000 + 2500 * 38000 + 1200 * 145000 + 8000 * 95000, 'Cálculo aritmético de monto total es exacto (Gs. 1.044.000.000)');
  assert(pkg1.preparedForms.length === 3, 'Generados los 3 formularios canónicos (Carta, Declaración, Planilla)');
  assert(pkg1.attachedEvidenceDocs.length === 3, 'Vinculados los 3 documentos probatorios desde la Bóveda');
  assert(pkg1.validationErrors.length === 0, 'Cero errores de validación');

  // CASO 2: Sin Matriz PBC o con Requisito Excluyente no Resuelto => DRAFT_INCOMPLETE
  console.log('\n--- TEST 2: Bloqueo READY_TO_SIGN sin PBC o con Requisitos en Revisión ---');
  
  // 2A: Sin matriz PBC
  const pkgSinPbc = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: mockVault,
    complianceReport: null
  });
  assert(pkgSinPbc.packageStatus === 'DRAFT_INCOMPLETE', 'Sin matriz PBC el estado es DRAFT_INCOMPLETE');
  assert(pkgSinPbc.validationErrors.some(e => e.includes('Falta matriz formal de requisitos extraída')), 'Reporta falta de pliego analizado');

  // 2B: Con requisito excluyente en REVIEW_REQUIRED
  const complianceConRevision: TenderComplianceReport = {
    ...validComplianceReport,
    isEligibleToBid: false,
    evaluations: [
      ...validComplianceReport.evaluations.slice(0, 2),
      {
        requirementId: 'pbc-exp-asfalto',
        categoria: 'EXPERIENCIA',
        descripcion: 'Experiencia técnica en pavimentos',
        esExcluyente: true,
        verdict: 'REVIEW_REQUIRED',
        observaciones: 'Monto no cuantificado numéricamente'
      }
    ]
  };
  const pkgReviewRequired = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: mockVault,
    complianceReport: complianceConRevision
  });
  assert(pkgReviewRequired.packageStatus === 'DRAFT_INCOMPLETE', 'Con REVIEW_REQUIRED excluyente el estado es DRAFT_INCOMPLETE');
  assert(pkgReviewRequired.validationErrors.some(e => e.includes('REVIEW_REQUIRED')), 'Reporta requisito en revisión');

  // 2C: Con requisito NO excluyente en REVIEW_REQUIRED (ANY REVIEW_REQUIRED blocks READY_TO_SIGN)
  const complianceNonExcluyenteReview: TenderComplianceReport = {
    ...validComplianceReport,
    isEligibleToBid: true,
    evaluations: [
      ...validComplianceReport.evaluations,
      {
        requirementId: 'pbc-sug-topografo',
        categoria: 'PERSONAL',
        descripcion: 'Se sugiere contar con topógrafo certificado',
        esExcluyente: false,
        verdict: 'REVIEW_REQUIRED',
        observaciones: 'Requiere revisión manual antes de presentar'
      }
    ]
  };
  const pkgNonExcluyenteReview = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: mockVault,
    complianceReport: complianceNonExcluyenteReview
  });
  assert(pkgNonExcluyenteReview.packageStatus === 'DRAFT_INCOMPLETE', 'Incluso con esExcluyente=false, ANY REVIEW_REQUIRED bloquea READY_TO_SIGN a DRAFT_INCOMPLETE');
  assert(pkgNonExcluyenteReview.validationErrors.some(e => e.includes('REVIEW_REQUIRED')), 'Reporta el requisito no excluyente en revisión');

  // 2D: Con requisito excluyente FALTANTE
  const complianceFaltante: TenderComplianceReport = {
    ...validComplianceReport,
    isEligibleToBid: false,
    evaluations: [
      ...validComplianceReport.evaluations.slice(0, 2),
      {
        requirementId: 'pbc-exp-asfalto',
        categoria: 'EXPERIENCIA',
        descripcion: 'Experiencia técnica en pavimentos',
        esExcluyente: true,
        verdict: 'FALTANTE',
        observaciones: 'Sin certificado en bóveda'
      }
    ]
  };
  const pkgFaltante = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsCotizados,
    vaultItems: mockVault,
    complianceReport: complianceFaltante
  });
  assert(pkgFaltante.packageStatus === 'DRAFT_INCOMPLETE', 'Requisito excluyente FALTANTE bloquea a DRAFT_INCOMPLETE');
  assert(pkgFaltante.validationErrors.some(e => e.includes('FALTANTE')), 'Reporta el requisito faltante');

  // CASO 3: Detección de Placeholders en Oferente (80000000-1)
  console.log('\n--- TEST 3: Rechazo de Placeholders Sintéticos ---');
  const pkg3 = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'Empresa Oferente',
    bidderRuc: '80000000-1',
    legalRepresentative: 'Representante Legal',
    items: itemsCotizados,
    vaultItems: mockVault
  });

  console.log(`Estado con Placeholders: ${pkg3.packageStatus} | Errores: ${pkg3.validationErrors.join('; ')}`);
  assert(pkg3.packageStatus === 'DRAFT_INCOMPLETE', 'Identifica correctamente que la oferta no puede ser READY_TO_SIGN con placeholders');
  assert(pkg3.validationErrors.some(e => e.includes('80000000-1')), 'Detecta RUC de prueba/placeholder');
  assert(pkg3.validationErrors.some(e => e.includes('Razón social')), 'Detecta Razón Social genérica');
  assert(pkg3.validationErrors.some(e => e.includes('Representante Legal')), 'Detecta Representante Legal genérico');

  // CASO 4: Detección de Ítems sin Precio Unitario Cotizado
  console.log('\n--- TEST 4: Detección de Ítems no Cotizados (unitPrice = 0) ---');
  const itemsIncompletos: TenderBidItemInput[] = [
    { itemNumber: 1, description: 'Ítem Con Costo', unit: 'UN', quantity: 10, unitPricePyg: 50000 },
    { itemNumber: 2, description: 'Ítem Sin Costo (Cero)', unit: 'M2', quantity: 100, unitPricePyg: 0 }
  ];

  const pkg4 = assembleTenderPackage({
    tenderId: 'LIC-MOPC-445566',
    tenderTitle: 'Pavimentación de Acceso a Nueva Asunción',
    buyerName: 'MOPC',
    bidderName: 'INGENIERIA & VIAL S.A.',
    bidderRuc: '80009735-1',
    legalRepresentative: 'Ing. Carlos Gonzalez',
    items: itemsIncompletos,
    vaultItems: mockVault
  });

  console.log(`Estado con Ítem Sin Precio: ${pkg4.packageStatus} | Errores: ${pkg4.validationErrors.join('; ')}`);
  assert(pkg4.packageStatus === 'DRAFT_INCOMPLETE', 'No permite READY_TO_SIGN si algún ítem tiene precio cero');
  assert(pkg4.validationErrors.some(e => e.includes('precio unitario cotizado')), 'Reporta ítem específico sin precio');

  // CASO 5: Generación del Índice Maestro y Exportación HTML del Expediente
  console.log('\n--- TEST 5: Índice Maestro y Exportación Completa del Expediente ---');
  const { generateMasterIndex, exportBidPackageAsDocument } = await import('../lib/procurement/tender-operations');

  const masterIndex = generateMasterIndex(pkg1);
  console.log('Índice Maestro generado:\n', masterIndex);
  assert(masterIndex.includes('ÍNDICE MAESTRO DEL EXPEDIENTE DE OFERTA'), 'Encabezado formal del índice maestro');
  assert(masterIndex.includes('SECCIÓN I: BORRADORES / PLANTILLAS INTERNAS DE PRESENTACIÓN'), 'Encabezado formal de borradores/plantillas internas en índice maestro');
  assert(masterIndex.includes('DRAFT-FORM-01'), 'Incluye Formulario 1 en índice');
  assert(masterIndex.includes('DRAFT-FORM-02'), 'Incluye Formulario 2 en índice');
  assert(masterIndex.includes('DRAFT-FORM-03'), 'Incluye Formulario 3 en índice');
  assert(masterIndex.includes('Estatuto Social'), 'Incluye documento legal en índice');
  assert(masterIndex.includes('Cumplimiento Tributario DNIT'), 'Incluye documento fiscal en índice');

  const exportDoc = exportBidPackageAsDocument(pkg1);
  assert(exportDoc.includes('<!DOCTYPE html>'), 'Documento generado es HTML estándar válido');
  assert(exportDoc.includes('EXPEDIENTE DE OFERTA LICITATORIA'), 'Título formal en documento');
  assert(exportDoc.includes('Borradores / Plantillas Internas de Presentación'), 'Sección 2 titulada formalmente como plantillas internas');
  assert(exportDoc.includes('READY_TO_SIGN'), 'Refleja estado READY_TO_SIGN');
  assert(exportDoc.includes('Gs. 1.044.000.000'), 'Refleja monto total de oferta formateado');
  assert(exportDoc.includes('REPRESENTANTE LEGAL'), 'Bloque de firma de Representante Legal presente');
  assert(exportDoc.includes('RESPONSABLE TÉCNICO'), 'Bloque de firma de Responsable Técnico presente');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 14 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 14:', err);
  process.exit(1);
});

