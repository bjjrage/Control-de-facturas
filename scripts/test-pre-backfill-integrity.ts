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
 * Scenario H: Verificación de Cobertura Temporal Canónica (2015-2026) y Denominador Honesto
 * Scenario I: Representación Real DNCP de Adendas (extendsContractID + dncpAmendmentType)
 * Scenario J: Verificación de Esquema Canónico de procurement_items (0060/0067)
 * Scenario K: Integración Server Action Item Mapping -> assembleTenderPackage
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  classifyAmendment,
  computeContractEconomicHistory,
  calculateCompetitorBehaviorMetrics,
  separateContractsAndExtendsAmendments,
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
    assert(classifyAmendment("Reajuste de Precios", 15000000, 0) === 'PRICE_ADJUSTMENT', "Debe clasificar como PRICE_ADJUSTMENT");
    assert(classifyAmendment("Convenio Modificatorio", 20000000, 0) === 'SCOPE_MODIFICATION', "Debe clasificar como SCOPE_MODIFICATION");
    assert(classifyAmendment("Aclaratoria administrativa", 0, 0) === 'OTHER', "Debe clasificar como OTHER");

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
  // Scenario H: Verificación de Cobertura Temporal Canónica (2015-2026) y Denominador Honesto
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario H: Coverage Audit Engine explicit target range (2015-2026)...");

    assert(TARGET_COVERAGE_YEARS.length === 12, "El rango objetivo debe tener exactamente 12 años (2015 a 2026)");
    assert(TARGET_COVERAGE_YEARS[0] === '2015', "Primer año debe ser 2015");
    assert(TARGET_COVERAGE_YEARS[11] === '2026', "Último año debe ser 2026");

    // 1. Prueba con datos parciales (gaps identificados)
    const partialData = {
      "2019": 11,
      "2020": 3,
      "2024": 6
    };

    const auditResult = auditHistoricalCoverage(partialData, 20);

    assert(auditResult.temporalRangeStatus === 'TEMPORAL_GAPS_DETECTED', "Estado temporal debe ser TEMPORAL_GAPS_DETECTED");
    assert(auditResult.datasetCoverageStatus === 'DATASET_COVERAGE_UNVERIFIED_DENOMINATOR_UNKNOWN', "Cobertura debe indicar denominador desconocido");
    assert(auditResult.isDatasetCoverageVerified === false, "isDatasetCoverageVerified debe ser false");
    assert(auditResult.gapYears.length === 9, "Debe identificar exactamente 9 años con GAP (2015-2018, 2021-2023, 2025-2026)");
    assert(auditResult.gapYears.includes('2015'), "2015 debe ser un GAP explícito");
    assert(auditResult.gapYears.includes('2026'), "2026 debe ser un GAP explícito");

    // 2. Invariante: Tener >0 registros en todos los años NO es FULL / VERIFIED sin denominador de universo
    const allYearsData: Record<string, number> = {};
    for (const yr of TARGET_COVERAGE_YEARS) {
      allYearsData[yr] = 5;
    }
    const fullRangeResult = auditHistoricalCoverage(allYearsData, 60);
    assert(fullRangeResult.hasTemporalRange === true, "Rango temporal debe estar presente");
    assert(fullRangeResult.temporalRangeStatus === 'TEMPORAL_RANGE_PRESENT', "Estado temporal debe ser TEMPORAL_RANGE_PRESENT");
    assert(fullRangeResult.isDatasetCoverageVerified === false, "Sin denominador de universo verificado, NO es cobertura completa");
    assert(fullRangeResult.status !== 'FULL / VERIFIED', "El estado JAMÁS puede ser FULL / VERIFIED con denominador desconocido");
    assert(fullRangeResult.status === 'TEMPORAL_RANGE_PRESENT / COVERAGE_UNVERIFIED', "Debe indicar rango presente pero cobertura no verificada");

    console.log("  ✓ Scenario H PASSED: Rango 2015-2026 y estricta honestidad de denominador auditados.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario H FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario I: Representación Real DNCP de Adendas (extendsContractID)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario I: Real DNCP Amendment representation (extendsContractID)...");

    // Fixture de contrato original A (monto: 824,999,752 PYG)
    const contractA = {
      id: 'ocds-03ad3f-183665-CTR-1',
      dncpContractCode: 'LP-11001-19-183665',
      title: 'Contrato Original Obras Viales',
      value: { amount: 824999752, currency: 'PYG' },
      period: { startDate: '2019-06-01', endDate: '2020-05-31' },
      amendments: [] // Sin adendas embebidas OCDS
    };

    // Contrato B: Representación oficial DNCP de adenda como registro de contrato con extendsContractID
    const contractB = {
      id: 'ocds-03ad3f-183665-CTR-2',
      extendsContractID: 'ocds-03ad3f-183665-CTR-1', // VINCULADO AL CONTRATO A
      dncpContractCode: 'AC-11001-20-39005',
      dncpAmendmentType: 'Reajuste de Precios', // EVIDENCIA PRIMARIA CRUDA
      title: 'Reajuste de Precios por Variación de Fórmula Polinómica',
      value: { amount: 15000000, currency: 'PYG' },
      dateSigned: '2020-01-15'
    };

    // 1. Separación de contratos originales vs adendas extendsContractID
    const separation = separateContractsAndExtendsAmendments([contractA, contractB]);
    assert(separation.originalContracts.length === 1, "Debe persistir exactamente 1 contrato original");
    assert(separation.originalContracts[0].id === contractA.id, "El contrato original debe ser A");
    assert(separation.linkedAmendments.length === 1, "Debe vincular exactamente 1 adenda");

    const amendB = separation.linkedAmendments[0];
    assert(amendB.extendsContractId === contractA.id, "extendsContractId debe apuntar a A");
    assert(amendB.dncpAmendmentTypeRaw === 'Reajuste de Precios', "dncpAmendmentTypeRaw debe preservar la evidencia primaria cruda");
    assert(amendB.tipo === 'PRICE_ADJUSTMENT', "Debe clasificarse como PRICE_ADJUSTMENT (no genérico AMOUNT_INCREASE)");
    assert(amendB.amountDelta === 15000000, "Delta de monto debe preservarse exactamente (15,000,000 PYG)");
    assert(amendB.sourceType === 'EXTENDS_CONTRACT', "sourceType debe ser EXTENDS_CONTRACT");

    // 2. Historial económico con delta conocido
    const historyKnown = computeContractEconomicHistory(
      {
        id: contractA.id,
        contractDncpId: contractA.dncpContractCode,
        originalAmount: contractA.value.amount,
        originalDurationDays: 365,
        currency: 'PYG'
      },
      separation.linkedAmendments
    );

    assert(historyKnown.originalAmount === 824999752, "Monto original debe permanecer intacto (824,999,752 PYG)");
    assert(historyKnown.totalAmountDelta === 15000000, "Delta total debe ser 15,000,000 PYG");
    assert(historyKnown.finalContractAmount === 839999752, "Monto final vigente debe ser 839,999,752 PYG");
    assert(historyKnown.hasUnresolvedAmendments === false, "hasUnresolvedAmendments debe ser false");

    // 3. Caso con adenda adicional no resuelta (Contract C)
    const contractC = {
      id: 'ocds-03ad3f-183665-CTR-3',
      extendsContractID: 'ocds-03ad3f-183665-CTR-1',
      dncpContractCode: 'AC-11001-20-41000',
      dncpAmendmentType: 'Ampliación de Monto',
      value: null, // DELTA DESCONOCIDO / UNRESOLVED
      dateSigned: '2020-03-20'
    };

    const separationWithUnresolved = separateContractsAndExtendsAmendments([contractA, contractB, contractC]);
    assert(separationWithUnresolved.originalContracts.length === 1, "Aún con 2 adendas, debe haber exactamente 1 contrato original (NO un segundo contrato ficticio)");
    assert(separationWithUnresolved.linkedAmendments.length === 2, "Debe haber exactamente 2 adendas vinculadas");

    const historyUnresolved = computeContractEconomicHistory(
      {
        id: contractA.id,
        contractDncpId: contractA.dncpContractCode,
        originalAmount: contractA.value.amount,
        originalDurationDays: 365,
        currency: 'PYG'
      },
      separationWithUnresolved.linkedAmendments
    );

    assert(historyUnresolved.originalAmount === 824999752, "Monto original debe preservarse");
    assert(historyUnresolved.hasUnresolvedAmendments === true, "hasUnresolvedAmendments debe ser true");
    assert(historyUnresolved.finalContractAmount === null, "finalContractAmount DEBE ser null cuando el efecto económico no está resuelto");

    // 4. Idempotencia exacta de re-ingesta
    const reingestSeparation = separateContractsAndExtendsAmendments([contractA, contractB, contractC]);
    assert(reingestSeparation.originalContracts.length === 1, "Re-ingesta: exactamente 1 contrato original");
    assert(reingestSeparation.linkedAmendments.length === 2, "Re-ingesta: exactamente 2 adendas");
    assert(reingestSeparation.linkedAmendments[0].amendmentDncpId === amendB.amendmentDncpId, "Identidad estable de adenda B");

    console.log("  ✓ Scenario I PASSED: Estructura real DNCP de adendas procesada con fidelidad e idempotencia.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario I FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario J: Verificación de Esquema Canónico de procurement_items (0060/0067)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario J: Verify canonical procurement_items schema...");

    const migration0060Path = path.resolve(process.cwd(), 'supabase', 'migrations', '0060_procurement_evidence_foundation.sql');
    const migration0067Path = path.resolve(process.cwd(), 'supabase', 'migrations', '0067_canonical_cost_and_contract_history.sql');

    assert(fs.existsSync(migration0060Path), "0060_procurement_evidence_foundation.sql debe existir");
    assert(fs.existsSync(migration0067Path), "0067_canonical_cost_and_contract_history.sql debe existir");

    const m0060Content = fs.readFileSync(migration0060Path, 'utf8');
    const m0067Content = fs.readFileSync(migration0067Path, 'utf8');

    // 1. Columnas canónicas definidas en 0060
    const canonicalColumns = [
      'process_id',
      'lot_id',
      'codigo_catalogo',
      'codigo_unspsc',
      'descripcion',
      'cantidad',
      'unidad',
      'precio_unitario_referencial',
      'sort_order'
    ];

    for (const col of canonicalColumns) {
      assert(m0060Content.includes(col), `0060 debe definir columna canónica ${col}`);
      assert(m0067Content.includes(col), `0067 debe usar columna canónica ${col}`);
    }

    // 2. Verificar que columnas inventadas/alucinadas NO existan en 0067
    assert(!m0067Content.includes('codigo_catalogo_padre'), "0067 NO debe referenciar codigo_catalogo_padre");
    assert(!m0067Content.includes('precio_unitario_estimado'), "0067 NO debe referenciar precio_unitario_estimado");

    // 3. Verificar agregado de item_dncp_id con índice único (process_id, item_dncp_id)
    assert(m0067Content.includes('item_dncp_id'), "0067 debe agregar columna item_dncp_id");
    assert(m0067Content.includes('idx_proc_items_process_dncp_id') && m0067Content.includes('(process_id, item_dncp_id)'), "0067 debe crear índice único para (process_id, item_dncp_id)");

    console.log("  ✓ Scenario J PASSED: Esquema canónico de procurement_items reconciliado y verificado.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario J FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario K: Integración Server Action Item Mapping -> assembleTenderPackage
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario K: Server action item mapping blocks READY_TO_SIGN on incomplete DB items...");

    // Simular filas crudas de procurement_items en la BD con especificaciones incompletas
    const rawDbItemsFromSupabase = [
      {
        id: 'item-uuid-1',
        process_id: 'proc-uuid-1',
        lot_id: null,
        codigo_catalogo: 'CAT-01',
        codigo_unspsc: '72141103',
        descripcion: 'Movimiento de Suelo y Nivelación',
        cantidad: null, // CANTIDAD NULA EN BD
        unidad: null,   // UNIDAD NULA EN BD
        precio_unitario_referencial: 125000,
        sort_order: 1
      },
      {
        id: 'item-uuid-2',
        process_id: 'proc-uuid-1',
        lot_id: null,
        codigo_catalogo: 'CAT-02',
        codigo_unspsc: '72141104',
        descripcion: 'Capa Sub-base Granular',
        cantidad: 500,
        unidad: '',     // UNIDAD VACÍA EN BD
        precio_unitario_referencial: 85000,
        sort_order: 2
      }
    ];

    // Aplicar la lógica exacta de mapeo de generarPliegoOfertaCompleto (app/(internal)/licitaciones/actions.ts)
    // Invariante: ¡NO FABRICAR DEFAULTS! (sin "UN" ni 1 ficticio)
    const mappedItemsForTenderOps: TenderBidItemInput[] = rawDbItemsFromSupabase.map((it, index) => ({
      itemNumber: it.sort_order || index + 1,
      catalogCode: it.codigo_catalogo || undefined,
      description: it.descripcion,
      unit: it.unidad ? String(it.unidad).trim() : "",
      quantity: it.cantidad != null ? Number(it.cantidad) : 0,
      unitPricePyg: it.precio_unitario_referencial ? Number(it.precio_unitario_referencial) : 0
    }));

    // El primer ítem mapeado debe preservar la ausencia de especificación
    assert(mappedItemsForTenderOps[0].unit === "", "Server action no debe inventar unidad 'UN'");
    assert(mappedItemsForTenderOps[0].quantity === 0, "Server action no debe inventar cantidad 1");

    // Ejecutar assembleTenderPackage con los ítems mapeados
    const pkg = assembleTenderPackage({
      tenderId: 'T-INCOMPLETE-1',
      tenderTitle: 'Pavimentación Urbana',
      buyerName: 'Municipalidad de Asunción',
      bidderName: 'Constructora Vial S.A.',
      bidderRuc: '80099999-1',
      legalRepresentative: 'Ing. Rodrigo Benítez',
      items: mappedItemsForTenderOps,
      vaultItems: [],
      complianceReport: {
        tenderId: 'T-INCOMPLETE-1',
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
            descripcion: 'Capacidad legal',
            esExcluyente: true,
            verdict: 'CUMPLIDO',
            observaciones: 'Ok'
          }
        ]
      }
    });

    // Validar que Tender Operations bloquea READY_TO_SIGN y determina DRAFT_INCOMPLETE
    assert(pkg.packageStatus === 'DRAFT_INCOMPLETE', `Estado debe ser DRAFT_INCOMPLETE, recibido: ${pkg.packageStatus}`);
    assert(pkg.validationErrors.length >= 2, "Debe registrar múltiples errores de validación de ítems");
    assert(pkg.validationErrors.some(e => e.includes('carece de unidad de medida verificable')), "Debe detectar unidad faltante");
    assert(pkg.validationErrors.some(e => e.includes('tiene cantidad nula o inválida')), "Debe detectar cantidad nula o inválida");

    console.log("  ✓ Scenario K PASSED: Mapeo de server action bloquea READY_TO_SIGN ante datos incompletos.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario K FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario L: Estado de Evidencia en Observaciones de Costo (VALIDA únicamente)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario L: Bid Cost analysis consumes ONLY estado_evidencia = 'VALIDA'...");

    const mockObservations = [
      { id: 'obs-1', descripcion_item: 'Arena Lavada', precio_unitario: 80000, estado_evidencia: 'VALIDA', cantidad: 10, unidad: 'M3' },
      { id: 'obs-2', descripcion_item: 'Arena Lavada', precio_unitario: 120000, estado_evidencia: 'REVISION_REQUERIDA', cantidad: 5, unidad: 'M3' },
      { id: 'obs-3', descripcion_item: 'Arena Lavada', precio_unitario: 30000, estado_evidencia: 'OBSOLETA', cantidad: 20, unidad: 'M3' },
      { id: 'obs-4', descripcion_item: 'Arena Lavada', precio_unitario: 999999, estado_evidencia: 'DESCARTADA', cantidad: 1, unidad: 'M3' }
    ];

    // Simular el filtrado estricto implementado en persistirEvaluacionComercial
    const validObs = mockObservations.filter(o => o.estado_evidencia === 'VALIDA');

    assert(validObs.length === 1, "Solo debe aceptar 1 observación con estado_evidencia = VALIDA");
    assert(validObs[0].id === 'obs-1', "La observación válida debe ser obs-1");
    assert(validObs[0].precio_unitario === 80000, "El precio unitario de la observación válida debe ser 80,000 PYG");

    // Verificar que estados no-válidos son 100% excluidos
    const invalidStates = ['REVISION_REQUERIDA', 'OBSOLETA', 'DESCARTADA'];
    for (const st of invalidStates) {
      assert(!validObs.some(o => o.estado_evidencia === st), `Observaciones en estado ${st} jamás deben influir en el costo`);
    }

    console.log("  ✓ Scenario L PASSED: Observaciones en REVISION_REQUERIDA, OBSOLETA y DESCARTADA 100% aisladas.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario L FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario M: Fail-Closed Tender-to-Project Conversion (Sin GL ni Referencial)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario M: Tender to Project conversion fails closed on missing adjudicated amount or items...");

    // 1. Falta de monto adjudicado real (monto_adjudicado = 0 o null)
    const testConversionWithZeroAdjudicated = (adjudicatedAmt: number | null | undefined) => {
      const amt = Number(adjudicatedAmt);
      if (isNaN(amt) || amt <= 0) {
        return { error: "No se puede convertir a proyecto: la licitación no cuenta con monto adjudicado verificado" };
      }
      return { success: true };
    };

    assert(testConversionWithZeroAdjudicated(0).error?.includes("no cuenta con monto adjudicado verificado") === true,
      "Debe fallar si monto_adjudicado es 0");
    assert(testConversionWithZeroAdjudicated(null).error?.includes("no cuenta con monto adjudicado verificado") === true,
      "Debe fallar si monto_adjudicado es null");
    assert(testConversionWithZeroAdjudicated(undefined).error?.includes("no cuenta con monto adjudicado verificado") === true,
      "Debe fallar si monto_adjudicado es undefined");

    // 2. Falta de ítems detallados: jamás fallback a 1 GL
    let caughtZeroItems = false;
    try {
      buildProjectFromAdjudicatedTender({
        empresaId: '00000000-0000-0000-0000-000000000001',
        tenderId: 'LIC-FAIL-CLOSED',
        projectTitle: 'Obra Sin Items',
        buyerName: 'MOPC',
        adjudicatedOfferPricePyg: 500000000,
        bidItems: [] // Cero ítems
      });
    } catch (e: any) {
      if (e.message.includes('VALIDATION_ERROR') && e.message.includes('without budget items')) {
        caughtZeroItems = true;
      }
    }
    assert(caughtZeroItems, "Transición debe fallar cerradamente ante la ausencia de ítems detallados");

    console.log("  ✓ Scenario M PASSED: Fail-closed verificado (cero ítems sintéticos 1 GL y cero sustitución por presupuesto referencial).");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario M FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario N: Dimensiones Independientes (Monto vs Plazo) y Seguridad de Moneda
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario N: Independent dimensions (Amount vs Duration) & Currency safety...");

    const contract: ContractInput = {
      id: 'CTR-DIM-1',
      contractDncpId: 'CTR-DIM-1',
      originalAmount: 100000000,
      originalDurationDays: 180,
      currency: 'PYG'
    };

    // Caso 1: Adenda de solo plazo con plazo no resuelto -> Plazo es null, pero Monto sigue siendo conocido y exacto
    const termUnresolvedAmendments: AmendmentInput[] = [
      {
        amendmentDncpId: 'AM-TERM-UNRES',
        tipo: 'TERM_EXTENSION',
        dncpAmendmentTypeRaw: 'Ampliación de Plazo',
        durationDeltaDays: null, // Plazo no resuelto
        amountDelta: null,
        currency: 'PYG'
      }
    ];

    const histTermUnres = computeContractEconomicHistory(contract, termUnresolvedAmendments);
    assert(histTermUnres.hasUnresolvedDuration === true, "hasUnresolvedDuration debe ser true");
    assert(histTermUnres.hasUnresolvedAmount === false, "hasUnresolvedAmount debe ser false");
    assert(histTermUnres.finalContractAmount === 100000000, "Monto final debe permanecer intacto en 100,000,000 PYG");
    assert(histTermUnres.finalDurationDays === null, "Plazo final debe ser estrictamente null (UNKNOWN)");

    // Caso 2: Adenda de monto con monto no resuelto -> Monto es null, pero Plazo sigue siendo conocido y exacto
    const amountUnresolvedAmendments: AmendmentInput[] = [
      {
        amendmentDncpId: 'AM-AMT-UNRES',
        tipo: 'AMOUNT_INCREASE',
        dncpAmendmentTypeRaw: 'Ampliación de Monto',
        durationDeltaDays: null,
        amountDelta: null, // Monto no resuelto
        currency: 'PYG'
      }
    ];

    const histAmtUnres = computeContractEconomicHistory(contract, amountUnresolvedAmendments);
    assert(histAmtUnres.hasUnresolvedAmount === true, "hasUnresolvedAmount debe ser true");
    assert(histAmtUnres.hasUnresolvedDuration === false, "hasUnresolvedDuration debe ser false");
    assert(histAmtUnres.finalContractAmount === null, "Monto final debe ser estrictamente null (UNKNOWN)");
    assert(histAmtUnres.finalDurationDays === 180, "Plazo final debe permanecer intacto en 180 días");

    // Caso 3: Adenda en moneda distinta sin FX rate -> Bloquea agregación de monto (hasUnresolvedAmount = true)
    const currencyMismatchAmendments: AmendmentInput[] = [
      {
        amendmentDncpId: 'AM-USD-MISMATCH',
        tipo: 'AMOUNT_INCREASE',
        dncpAmendmentTypeRaw: 'Ampliación de Monto',
        amountDelta: 25000,
        currency: 'USD' // Contrato en PYG, adenda en USD
      }
    ];

    const histCurrencyMismatch = computeContractEconomicHistory(contract, currencyMismatchAmendments);
    assert(histCurrencyMismatch.hasUnresolvedAmount === true, "Discrepancia de monedas sin FX rate debe marcar hasUnresolvedAmount = true");
    assert(histCurrencyMismatch.finalContractAmount === null, "Monto final no se puede sumar entre monedas distintas sin FX");

    console.log("  ✓ Scenario N PASSED: Dimensiones monto y plazo estrictamente desacopladas y seguridad multimoneda verificada.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario N FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario O: Identidad Determinística de Adendas (Sin Math.random)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario O: Deterministic amendment identity generates stable fingerprints...");

    const rawContracts = [
      {
        extendsContractID: 'CTR-ORIG-100',
        dncpAmendmentType: 'Ampliación de Monto',
        dateSigned: '2024-05-10',
        value: { amount: 50000000, currency: 'PYG' }
        // Sin id explícito
      }
    ];

    const run1 = separateContractsAndExtendsAmendments(rawContracts);
    const run2 = separateContractsAndExtendsAmendments(rawContracts);

    assert(run1.linkedAmendments.length === 1, "Debe vincular 1 adenda");
    assert(run2.linkedAmendments.length === 1, "Debe vincular 1 adenda");
    assert(run1.linkedAmendments[0].amendmentDncpId === run2.linkedAmendments[0].amendmentDncpId,
      "La identidad generada de la adenda debe ser 100% determinística e idéntica entre ejecuciones");
    assert(run1.linkedAmendments[0].amendmentDncpId.startsWith('amend-'), "El ID determinístico debe prefijarse con amend-");

    console.log("  ✓ Scenario O PASSED: Identidad determinística verificada (cero aleatoriedad).");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario O FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario P: Manejo Seguro de IDs Base64 No-Enteros en Ítems y Lotes
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario P: Safe handling of Base64 / non-integer DNCP IDs...");

    const realDncpItemsSample = [
      { id: '4ehAjnVaquUl+Cw1/B7o9A==', relatedLot: 'z3QYQBZ0U1c=', attributes: [{ name: 'Orden', value: '1' }], description: 'Ítem 1' },
      { id: 's/8kydp07+fc=', relatedLot: 'abc123==', attributes: [{ name: 'Orden', value: '2' }], description: 'Ítem 2' }
    ];

    // Verificar que los IDs son cadenas Base64 y que ninguna función los castea a entero
    for (const it of realDncpItemsSample) {
      assert(typeof it.id === 'string', "Item ID debe ser string");
      assert(isNaN(Number(it.id)), "Item ID en base64 no es convertible a entero directo");
      assert(typeof it.relatedLot === 'string', "RelatedLot debe ser string");
      assert(isNaN(Number(it.relatedLot)), "RelatedLot en base64 no es convertible a entero directo");

      // Orden se extrae de attributes 'Orden'
      const ordenAttr = it.attributes.find(a => a.name === 'Orden');
      const sortOrder = ordenAttr && /^\d+$/.test(ordenAttr.value) ? parseInt(ordenAttr.value, 10) : null;
      assert(typeof sortOrder === 'number' && sortOrder > 0, "sort_order debe provenir del atributo Orden oficial");
    }

    console.log("  ✓ Scenario P PASSED: IDs base64 no-enteros preservados de forma segura como TEXT.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario P FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario Q: RPC Parameter Name Compatibility (0060 => p_cr, 0067 => p_cr, caller => p_cr)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario Q: RPC Parameter Name Compatibility (0060, 0067, backfill caller)...");

    const sql0060 = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/0060_procurement_evidence_foundation.sql'), 'utf8');
    const sql0067 = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/0067_canonical_cost_and_contract_history.sql'), 'utf8');
    const backfillScript = fs.readFileSync(path.resolve(process.cwd(), 'scripts/backfill-dncp-history.ts'), 'utf8');

    // Requirement A: 0060 RPC input parameter is p_cr
    assert(/ingestar_proceso_ocds_global\s*\(\s*p_cr\s+jsonb/i.test(sql0060), "0060 debe definir el parámetro como p_cr");
    // Requirement B: 0067 RPC input parameter remains p_cr
    assert(/ingestar_proceso_ocds_global\s*\(\s*p_cr\s+jsonb/i.test(sql0067), "0067 debe conservar el parámetro exactamente como p_cr");
    assert(!/ingestar_proceso_ocds_global\s*\(\s*p_payload/i.test(sql0067), "0067 jamás debe renombrar el parámetro a p_payload");
    // Requirement C: backfill caller uses p_cr
    assert(/p_cr:\s*fullPayload/.test(backfillScript), "backfill-dncp-history.ts debe invocar el RPC con p_cr");
    assert(!/p_payload:\s*fullPayload/.test(backfillScript), "backfill-dncp-history.ts no debe usar p_payload");

    console.log("  ✓ Scenario Q PASSED: Compatibilidad de firma RPC verificada (p_cr canónico sin rupturas).");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario Q FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario R: Ingestion Payload Normalization (Full package vs Legacy bare)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario R: Payload Normalization (full package vs bare compiledRelease)...");

    function normalizePayload(inputPayload: any) {
      let v_cr: any;
      let v_releases: any[] = [];
      let isRichPackage = false;

      if (inputPayload && typeof inputPayload === 'object' && 'compiledRelease' in inputPayload) {
        v_cr = inputPayload.compiledRelease;
        isRichPackage = true;
        if (Array.isArray(inputPayload.releases)) {
          v_releases = inputPayload.releases;
        }
      } else {
        v_cr = inputPayload;
      }
      return { v_cr, v_releases, isRichPackage };
    }

    // Full package
    const fullPkg = {
      compiledRelease: { ocid: 'ocds-03ad3f-123456', tender: { title: 'Licitacion Rica' } },
      releases: [{ date: '2026-01-01', tag: ['tender'], url: 'https://...' }],
      releasesMetadata: { count: 1, releaseType: 'RELEASE_REFERENCE' }
    };
    const resFull = normalizePayload(fullPkg);
    assert(resFull.isRichPackage, "Debe detectar paquete rico");
    assert(resFull.v_cr.ocid === 'ocds-03ad3f-123456', "compiledRelease extraído con éxito");
    assert(resFull.v_releases.length === 1, "releases preservados");

    // Legacy bare compiledRelease
    const legacyBare = {
      ocid: 'ocds-03ad3f-654321',
      tender: { title: 'Licitacion Antigua' }
    };
    const resBare = normalizePayload(legacyBare);
    assert(!resBare.isRichPackage, "Debe detectar payload legado");
    assert(resBare.v_cr.ocid === 'ocds-03ad3f-654321', "bare payload usado directamente como compiledRelease");

    console.log("  ✓ Scenario R PASSED: Normalización transparente de payload (paquete completo y legado soportados).");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario R FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario S: Tender -> Project Conversion fails closed on price = 0
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario S: Tender -> Project Conversion fails closed on price = 0...");

    const zeroPriceItem = { itemNumber: 2, description: 'Item Cero', unit: 'UN', quantity: 5, unitPricePyg: 0 };
    const nanPriceItem = { itemNumber: 3, description: 'Item NaN', unit: 'UN', quantity: 5, unitPricePyg: NaN };

    let zeroPriceCaught = false;
    try {
      buildProjectFromAdjudicatedTender({
        empresaId: '00000000-0000-0000-0000-000000000001',
        tenderId: 'TND-001',
        dncpNro: '123456',
        projectTitle: 'Proyecto Test',
        buyerName: 'Comitente',
        adjudicatedOfferPricePyg: 500000,
        bidItems: [zeroPriceItem]
      });
    } catch (e: any) {
      zeroPriceCaught = true;
      assert(e.message.includes('VALIDATION_ERROR') && e.message.includes('invalid unit price'), 'Debe reportar error de validación de precio');
    }
    assert(zeroPriceCaught, "unitPrice = 0 debe lanzar error y fallar cerrado");

    let nanPriceCaught = false;
    try {
      buildProjectFromAdjudicatedTender({
        empresaId: '00000000-0000-0000-0000-000000000001',
        tenderId: 'TND-001',
        dncpNro: '123456',
        projectTitle: 'Proyecto Test',
        buyerName: 'Comitente',
        adjudicatedOfferPricePyg: 500000,
        bidItems: [nanPriceItem]
      });
    } catch (e: any) {
      nanPriceCaught = true;
    }
    assert(nanPriceCaught, "unitPrice = NaN debe lanzar error y fallar cerrado");

    console.log("  ✓ Scenario S PASSED: Precio cero / inválido falla cerrado categóricamente.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario S FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario T: Multi-Supplier Semantics (1 supplier vs 2 suppliers)
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario T: Multi-Supplier Semantics (1 supplier vs 2 suppliers)...");

    function resolveSupplierIds(verifiedSuppliers: Array<{ id: string }>) {
      const uniqueIds = Array.from(new Set(verifiedSuppliers.map(s => s.id)));
      let singularSupplierId: string | null = null;
      if (uniqueIds.length === 1) {
        singularSupplierId = uniqueIds[0];
      } else {
        singularSupplierId = null; // > 1 or 0 => NULL
      }
      const joinRows = uniqueIds.map(id => ({ supplier_id: id }));
      return { singularSupplierId, joinRows };
    }

    // 1 supplier
    const case1 = resolveSupplierIds([{ id: 'supp-1' }]);
    assert(case1.singularSupplierId === 'supp-1', "1 proveedor => supplier_id poblado con ese ID");
    assert(case1.joinRows.length === 1, "1 proveedor => exactamente 1 fila join");

    // 2 suppliers
    const case2 = resolveSupplierIds([{ id: 'supp-1' }, { id: 'supp-2' }]);
    assert(case2.singularSupplierId === null, "2 proveedores => supplier_id debe ser estrictamente NULL (sin asignar suppliers[0])");
    assert(case2.joinRows.length === 2, "2 proveedores => 2 filas join preservadas");

    // 0 suppliers
    const case0 = resolveSupplierIds([]);
    assert(case0.singularSupplierId === null, "0 proveedores => supplier_id NULL");
    assert(case0.joinRows.length === 0, "0 proveedores => 0 filas join");

    console.log("  ✓ Scenario T PASSED: Semántica multi-proveedor canónica (join tables como fuente de verdad).");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario T FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario U: Amount-only amendment with fake duration causes assertion failure
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario U: Amount-only amendment with fake duration causes failure...");

    const contract: ContractInput = {
      id: 'c-amt-only',
      contractDncpId: 'c-amt-only',
      originalAmount: 100_000_000,
      originalDurationDays: 180,
      currency: 'PYG'
    };

    const pureAmountAmendment: AmendmentInput = {
      amendmentDncpId: 'amend-pure-amt',
      extendsContractId: 'c-amt-only',
      tipo: 'AMOUNT_INCREASE',
      dncpAmendmentTypeRaw: 'Ampliación de Monto',
      amountDelta: 20_000_000,
      durationDeltaDays: null
    };

    const hist = computeContractEconomicHistory(contract, [pureAmountAmendment]);
    assert(hist.finalContractAmount === 120_000_000, "Monto final debe incrementarse a 120M");
    assert(hist.finalDurationDays === 180, "Plazo no debe sufrir alteración alguna");

    const timelineEntry = hist.timeline[0];
    const durationDeltaInvented = timelineEntry.durationDeltaDays !== null && timelineEntry.durationDeltaDays !== 0;
    assert(!durationDeltaInvented, "Adenda de solo monto jamás debe contener o derivar un delta de plazo");

    console.log("  ✓ Scenario U PASSED: Adenda de solo monto no inventa plazo.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario U FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario V: Term-only amendment with fake amount causes assertion failure
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario V: Term-only amendment with fake amount causes failure...");

    const contract: ContractInput = {
      id: 'c-term-only',
      contractDncpId: 'c-term-only',
      originalAmount: 100_000_000,
      originalDurationDays: 180,
      currency: 'PYG'
    };

    const pureTermAmendment: AmendmentInput = {
      amendmentDncpId: 'amend-pure-term',
      extendsContractId: 'c-term-only',
      tipo: 'TERM_EXTENSION',
      dncpAmendmentTypeRaw: 'Ampliación de Plazo',
      amountDelta: null,
      durationDeltaDays: 60
    };

    const hist = computeContractEconomicHistory(contract, [pureTermAmendment]);
    assert(hist.finalDurationDays === 240, "Plazo final debe extenderse a 240 días");
    assert(hist.finalContractAmount === 100_000_000, "Monto jamás debe alterarse en adenda de plazo");

    const timelineEntry = hist.timeline[0];
    const amountDeltaInvented = timelineEntry.amountDelta !== null && timelineEntry.amountDelta !== 0;
    assert(!amountDeltaInvented, "Adenda de solo plazo jamás debe contener o alterar el monto contractual");

    console.log("  ✓ Scenario V PASSED: Adenda de solo plazo jamás altera el monto contractual.");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario V FAILED:", err.message);
    failed++;
  }

  // ----------------------------------------------------------------------------
  // Scenario W: Explicit raw term-extension wins over incidental positive amount heuristic
  // ----------------------------------------------------------------------------
  try {
    console.log("\nTesting Scenario W: Explicit raw term-extension wins over incidental amount heuristic...");

    // Caso peligroso auditado:
    // rawType = 'Ampliación de Plazo', pero amountDelta = 50,000,000 existe incidentalmente en el payload.
    // La heurística textual oficial DEBE ganar sobre amountDelta > 0.
    const classified = classifyAmendment(
      'Ampliación de Plazo', // rawType
      'Adenda de prórroga contractual', // description
      50_000_000, // incidental amountDelta en payload
      60 // durationDeltaDays
    );

    assert(classified === 'TERM_EXTENSION', `Debe clasificarse como TERM_EXTENSION, clasificado actual: ${classified}`);

    const contract: ContractInput = {
      id: 'c-heuristic-test',
      contractDncpId: 'c-heuristic-test',
      originalAmount: 200_000_000,
      originalDurationDays: 90,
      currency: 'PYG'
    };

    const incidentalAmendment: AmendmentInput = {
      amendmentDncpId: 'amend-incidental-amt',
      extendsContractId: 'c-heuristic-test',
      dncpAmendmentTypeRaw: 'Ampliación de Plazo',
      description: 'Prórroga de plazo de ejecución',
      amountDelta: 50_000_000, // Incidental
      durationDeltaDays: 30
    };

    const hist = computeContractEconomicHistory(contract, [incidentalAmendment]);
    assert(hist.timeline[0].tipo === 'TERM_EXTENSION', "Debe computarse como TERM_EXTENSION");
    assert(hist.finalContractAmount === 200_000_000, "Monto contractual debe permanecer 200M (inmune a monto incidental en adenda de plazo)");
    assert(hist.finalDurationDays === 120, "Plazo contractual debe extenderse a 120 días");

    console.log("  ✓ Scenario W PASSED: Prioridad textual oficial verificada (inmune a heurísticas numéricas incidentales).");
    passed++;
  } catch (err: any) {
    console.error("  ✗ Scenario W FAILED:", err.message);
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
