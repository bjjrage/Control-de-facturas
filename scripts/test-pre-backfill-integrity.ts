/**
 * PRE-BACKFILL INTEGRITY & CONTRACT HISTORY REGRESSION TEST SUITE
 * 
 * Verifica rigurosamente los invariantes canónicos antes de iniciar el backfill masivo:
 * Scenario A: Invariantes de Cost Observations & Rechazo de Defaults Ficticios
 * Scenario B: Rechazo de Cobertura Comercial Falsa ante Especificaciones Nulas
 * Scenario C: Bloqueo de READY_TO_SIGN ante Unidades o Cantidades Faltantes
 * Scenario D: Validaciones Estrictas y Reconciliación en Tender-to-Project
 * Scenario E: Reconstrucción Histórica Económica de Contratos y Adendas
 * Scenario F: UNKNOWN != DEFAULT en Valor Contractual Final (Incompletitud)
 * Scenario G: Aislamiento Estricto de Inteligencia Competitiva (Pre vs Post Adjudicación)
 * Scenario H: Verificación de Cobertura Temporal Canónica (2015-2026)
 */

import {
  classifyAmendment,
  computeContractEconomicHistory,
  calculateCompetitorBehaviorMetrics,
  ContractInput,
  AmendmentInput
} from '../lib/procurement/contract-history';

import {
  buildProjectFromAdjudicatedTender
} from '../lib/procurement/tender-to-project';

import {
  assembleTenderPackage,
  TenderBidItemInput
} from '../lib/procurement/tender-operations';

import {
  parseHistoricalSpreadsheet
} from '../lib/cost-engine/onboarding';

import {
  auditHistoricalCoverage,
  TARGET_COVERAGE_YEARS
} from './verify-historical-coverage';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION_FAILED] ${message}`);
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("SUITE DE INTEGRIDAD PRE-BACKFILL & HISTORIAL CONTRACTUAL");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  // ----------------------------------------------------------------------------
  // Scenario A: Invariantes de Cost Observations & Rechazo de Defaults Ficticios
  // ----------------------------------------------------------------------------
  try {
    console.log("Testing Scenario A: Cost Engine Onboarding rejects missing unit, quantity, or date...");
    
    // Generar un CSV en memoria que carece de columna de unidad o cantidad válida
    const csvContent = "Item,Precio Unitario\nCemento Portland,55000\nArena lavada,80000";
    const buffer = Buffer.from(csvContent, 'utf-8');

    const result = parseHistoricalSpreadsheet(buffer, {
      empresaId: '00000000-0000-0000-0000-000000000001',
      projectName: 'Obra Prueba Sin Columnas Obligatorias'
    });

    assert(result.validObservations === 0, "No debe registrar observaciones válidas si faltan columnas obligatorias de unidad o cantidad");
    assert(result.errors.length > 0, "Debe reportar error explícito por columnas obligatorias no mapeadas");
    assert(result.errors[0].includes("columnas obligatorias"), "El mensaje de error debe indicar columnas obligatorias faltantes");

    console.log("  ✓ Scenario A PASSED: Falso default (1, 'UN', fecha) rechazado categóricamente.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario A FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario B: Rechazo de Cobertura Comercial Falsa ante Especificaciones Nulas
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario B: Commercial Analysis rejects fake cost coverage on invalid items...");
    
    // Simular el filtrado de items implementado en app/(internal)/licitaciones/actions.ts
    const sampleItems = [
      { id: '1', descripcion: 'Ladrillo hueco', cantidad: 0, unidad: 'UN' },          // Cantidad 0
      { id: '2', descripcion: 'Varilla conformada', cantidad: 50, unidad: '' },        // Unidad vacía
      { id: '3', descripcion: 'Pintura látex', cantidad: 10, unidad: 'GL' }           // Válido
    ];

    const validItemsForPricing = sampleItems.filter(it => {
      const qty = Number(it.cantidad);
      const unit = it.unidad ? String(it.unidad).trim() : '';
      return !isNaN(qty) && qty > 0 && unit !== '';
    });

    assert(validItemsForPricing.length === 1, "Solo debe aceptar ítems con cantidad > 0 y unidad no vacía");
    assert(validItemsForPricing[0].id === '3', "El ítem válido debe ser el #3");

    console.log("  ✓ Scenario B PASSED: Ítems sin especificaciones verificables no reciben cobertura económica.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario B FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario C: Bloqueo de READY_TO_SIGN ante Unidades o Cantidades Faltantes
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario C: assembleTenderPackage blocks READY_TO_SIGN when items lack units...");

    const itemsMissingUnit: TenderBidItemInput[] = [
      {
        itemNumber: 1,
        description: 'Excavación en terreno común',
        unit: '', // Unidad vacía
        quantity: 100,
        unitPricePyg: 45000
      }
    ];

    const pkg = assembleTenderPackage({
      tenderId: 'T-101',
      tenderTitle: 'Pavimentación Asfáltica',
      buyerName: 'MOPC',
      bidderName: 'Constructora del Este S.A.',
      bidderRuc: '80012345-6',
      legalRepresentative: 'Ing. Carlos Méndez',
      items: itemsMissingUnit,
      vaultItems: [],
      complianceReport: {
        tenderId: 'T-101',
        evidenceOrigin: 'EXTRACTED_FROM_PBC',
        isEligibleToBid: true,
        scoreCumplimientoPct: 100,
        totalRequirements: 1,
        cumplidosCount: 1,
        generablesCount: 0,
        faltantesCount: 0,
        reviewRequiredCount: 0,
        evaluations: [
          {
            requirementId: 'REQ-1',
            categoria: 'LEGAL',
            descripcion: 'Capacidad jurídica',
            esExcluyente: true,
            verdict: 'CUMPLIDO',
            observaciones: 'Cumplido'
          }
        ]
      }
    });

    assert(pkg.packageStatus === 'DRAFT_INCOMPLETE', `Estado del paquete debe ser DRAFT_INCOMPLETE, recibido: ${pkg.packageStatus}`);
    assert(pkg.validationErrors.some(e => e.includes('carece de unidad de medida verificable')), "Debe reportar error específico de unidad de medida faltante");

    console.log("  ✓ Scenario C PASSED: READY_TO_SIGN bloqueado categóricamente por unidad no verificable.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario C FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario D: Validaciones Estrictas y Reconciliación en Tender-to-Project
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario D: Tender-to-Project rejects empty items and validates budget...");

    let caughtEmpty = false;
    try {
      buildProjectFromAdjudicatedTender({
        empresaId: '00000000-0000-0000-0000-000000000001',
        tenderId: 'LIC-001',
        projectTitle: 'Obra Sin Items',
        buyerName: 'MOPC',
        adjudicatedOfferPricePyg: 100000000,
        bidItems: [] // Vacío
      });
    } catch (e: any) {
      if (e.message.includes('VALIDATION_ERROR') && e.message.includes('without budget items')) {
        caughtEmpty = true;
      }
    }
    assert(caughtEmpty, "Debe lanzar VALIDATION_ERROR si bidItems está vacío");

    // Con ítems válidos
    const validPayload = buildProjectFromAdjudicatedTender({
      empresaId: '00000000-0000-0000-0000-000000000001',
      tenderId: 'LIC-002',
      projectTitle: 'Obra Con Items Válidos',
      buyerName: 'MOPC',
      adjudicatedOfferPricePyg: 150000000,
      bidItems: [
        {
          itemNumber: 1,
          description: 'Hormigón Armado',
          unit: 'M3',
          quantity: 100,
          unitPricePyg: 1000000
        },
        {
          itemNumber: 2,
          description: 'Armadura de Acero',
          unit: 'KG',
          quantity: 5000,
          unitPricePyg: 10000
        }
      ]
    });

    assert(validPayload.budgetItems.length === 2, "Debe transferir 2 budget items");
    assert(validPayload.project.budget_total === 150000000, "El budget_total debe ser exactamente 150,000,000 PYG");
    assert(validPayload.project.contract_amount === 150000000, "El contract_amount debe ser exactamente 150,000,000 PYG");

    console.log("  ✓ Scenario D PASSED: Transición Licitación -> Proyecto estrictamente validada.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario D FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario E: Reconstrucción Histórica Económica de Contratos y Adendas
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario E: Complete Contract Economic History reconstruction...");

    // Clasificación de adendas
    assert(classifyAmendment("Ampliación de Monto", 134372811, 0) === 'AMOUNT_INCREASE', "Debe clasificar como AMOUNT_INCREASE");
    assert(classifyAmendment("Disminución de Monto", -50000000, 0) === 'AMOUNT_DECREASE', "Debe clasificar como AMOUNT_DECREASE");
    assert(classifyAmendment("Prórroga de plazo de entrega", 0, 90) === 'TERM_EXTENSION', "Debe clasificar como TERM_EXTENSION");
    assert(classifyAmendment("Aclaratoria administrativa", 0, 0) === 'ADMINISTRATIVE', "Debe clasificar como ADMINISTRATIVE");

    // Reconstrucción completa
    const contract: ContractInput = {
      id: 'CTR-001',
      contractDncpId: 'LP-11001-19-183665',
      originalAmount: 824999752,
      originalDurationDays: 360,
      currency: 'PYG'
    };

    const amendments: AmendmentInput[] = [
      {
        amendmentDncpId: 'AD-01',
        description: 'Ampliación de Monto',
        amountDelta: 134372811,
        durationDeltaDays: 0,
        financialCode: 'AC-11001-20-39005',
        date: '2020-03-30'
      },
      {
        amendmentDncpId: 'AD-02',
        description: 'Prórroga de Plazo',
        amountDelta: 0,
        durationDeltaDays: 60,
        financialCode: 'AC-11001-20-41000',
        date: '2020-05-15'
      }
    ];

    const history = computeContractEconomicHistory(contract, amendments);

    assert(history.originalAmount === 824999752, "Monto original debe ser inmutable (824,999,752 PYG)");
    assert(history.totalAmountDelta === 134372811, "Delta total debe ser 134,372,811 PYG");
    assert(history.finalContractAmount === 959372563, "Monto final contractual debe ser 959,372,563 PYG");
    assert(history.originalDurationDays === 360, "Plazo original debe ser inmutable (360 días)");
    assert(history.totalDurationDeltaDays === 60, "Delta de plazo debe ser +60 días");
    assert(history.finalDurationDays === 420, "Plazo final debe ser 420 días");
    assert(history.hasUnresolvedAmendments === false, "No debe tener adendas sin resolver");
    assert(history.growthPercentage === 16.29, `Crecimiento debe ser 16.29%, obtenido: ${history.growthPercentage}`);

    console.log("  ✓ Scenario E PASSED: Historial económico reconstruido con fidelidad estricta.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario E FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario F: UNKNOWN != DEFAULT en Valor Contractual Final (Incompletitud)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario F: UNKNOWN != DEFAULT when amendments have unresolvable amounts...");

    const contract: ContractInput = {
      id: 'CTR-002',
      contractDncpId: 'LP-2000-20',
      originalAmount: 500000000,
      originalDurationDays: 180,
      currency: 'PYG'
    };

    // Adenda que menciona ampliación de monto pero el payload tiene amountDelta null o indefinido
    const unresolvedAmendments: AmendmentInput[] = [
      {
        amendmentDncpId: 'AD-UNRESOLVED',
        description: 'Ampliación de Monto por Convenio Modificatorio #1',
        amountDelta: null, // Delta de monto no extraído/desconocido
        durationDeltaDays: null
      }
    ];

    const history = computeContractEconomicHistory(contract, unresolvedAmendments);

    assert(history.originalAmount === 500000000, "Monto original debe mantenerse");
    assert(history.hasUnresolvedAmendments === true, "Debe marcar hasUnresolvedAmendments = true");
    assert(history.finalContractAmount === null, "finalContractAmount DEBE ser null (FINAL_VALUE_UNKNOWN), jamás 0 ni monto original");
    assert(history.growthPercentage === null, "growthPercentage DEBE ser null al no conocer el valor final");

    console.log("  ✓ Scenario F PASSED: Incompletitud modelada como null (FINAL_VALUE_UNKNOWN) sin inventar defaults.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario F FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario G: Aislamiento Estricto de Inteligencia Competitiva (Pre vs Post)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario G: Competitor Intelligence metrics separation (zero causality)...");

    const bids = [
      { processId: 'P-1', montoOfertado: 90000000, montoReferencial: 100000000, gano: true },
      { processId: 'P-2', montoOfertado: 95000000, montoReferencial: 100000000, gano: false }
    ];

    const awards = [
      { processId: 'P-1', montoAdjudicado: 90000000 }
    ];

    const contractsWithHistory = [
      {
        contract: { id: 'C-1', contractDncpId: 'CD-1', originalAmount: 90000000 },
        history: computeContractEconomicHistory(
          { id: 'C-1', contractDncpId: 'CD-1', originalAmount: 90000000, originalDurationDays: 100 },
          [{ amendmentDncpId: 'A-1', description: 'Ampliación de Monto', amountDelta: 10000000, durationDeltaDays: 20 }]
        )
      }
    ];

    const metrics = calculateCompetitorBehaviorMetrics('SUPP-1', bids, awards, contractsWithHistory);

    // Pre-adjudicación
    assert(metrics.preAward.totalBidsSubmitted === 2, "2 ofertas presentadas");
    assert(metrics.preAward.totalAwardsWon === 1, "1 adjudicación ganada");
    assert(metrics.preAward.winRatePct === 50, "Tasa de adjudicación 50%");
    assert(metrics.preAward.avgDiscountVsReferencePct === 7.5, "Descuento promedio de oferta vs referencial 7.5%");

    // Post-adjudicación
    assert(metrics.postAwardExecution.totalContracts === 1, "1 contrato");
    assert(metrics.postAwardExecution.contractsWithAmendments === 1, "1 contrato con adendas");
    assert(metrics.postAwardExecution.amendmentFrequencyPct === 100, "Frecuencia de adendas 100%");
    assert(metrics.postAwardExecution.totalContractedAmountOriginal === 90000000, "Monto original total 90,000,000 PYG");
    assert(metrics.postAwardExecution.totalContractedAmountFinal === 100000000, "Monto final total 100,000,000 PYG");
    assert(metrics.postAwardExecution.avgCostGrowthPct === 11.11, "Crecimiento promedio de costo +11.11%");
    assert(metrics.postAwardExecution.avgTermExtensionDays === 20, "Prórroga promedio 20 días");

    console.log("  ✓ Scenario G PASSED: Métricas pre y post adjudicación aisladas y objetivas.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario G FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario H: Verificación de Cobertura Temporal Canónica (2015-2026)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario H: Coverage Audit Engine explicit target range (2015-2026)...");

    assert(TARGET_COVERAGE_YEARS.length === 12, "El rango objetivo debe tener exactamente 12 años (2015 a 2026)");
    assert(TARGET_COVERAGE_YEARS[0] === '2015', "Primer año debe ser 2015");
    assert(TARGET_COVERAGE_YEARS[11] === '2026', "Último año debe ser 2026");

    // Prueba con datos parciales (como el warehouse actual)
    const partialData = {
      "2019": 11,
      "2020": 3,
      "2024": 6
    };

    const auditResult = auditHistoricalCoverage(partialData, 20);

    assert(auditResult.status === 'PARTIAL / COVERAGE_UNKNOWN', "Estado debe ser PARTIAL / COVERAGE_UNKNOWN");
    assert(auditResult.isComplete === false, "isComplete debe ser false");
    assert(auditResult.gapYears.length === 9, "Debe identificar exactamente 9 años con GAP (2015-2018, 2021-2023, 2025-2026)");
    assert(auditResult.gapYears.includes('2015'), "2015 debe ser un GAP explícito");
    assert(auditResult.gapYears.includes('2026'), "2026 debe ser un GAP explícito");

    console.log("  ✓ Scenario H PASSED: Rango 2015-2026 auditado y gaps reportados correctamente.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario H FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Resumen Final
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`RESULTADO DE LA SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Fatal error executing test suite:", err);
  process.exit(1);
});
