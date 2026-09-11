/**
 * CONTRACT ECONOMIC HISTORY & AUDIT TRAIL ENGINE (GATE 3 / GATE 5B)
 * 
 * Modela el ciclo de vida económico completo de los contratos de obras públicas:
 * PROCESO -> OFERTA ORIGINAL -> ADJUDICACIÓN -> CONTRATO ORIGINAL -> ADENDAS 1..N -> VALOR CONTRACTUAL VIGENTE / FINAL.
 * 
 * Invariante semántico canónico:
 * PRESUPUESTO REFERENCIAL != OFERTA ORIGINAL != MONTO ADJUDICADO != MONTO CONTRATO ORIGINAL != MONTO CONTRATO VIGENTE/FINAL != PAGOS REALES.
 * 
 * Invariante de incompletitud:
 * Si existen adendas económicas pero los montos o fechas no pueden resolverse a partir de la evidencia,
 * el valor contractual final es estrictamente UNKNOWN (null). NUNCA asumir 0 ni reusar el original.
 * 
 * Soporte dual DNCP de Adendas:
 * A. Adendas embebidas en contracts[].amendments[]
 * B. Registros de contrato/release vinculados mediante extendsContractID
 * (Un contrato con extendsContractID JAMÁS se ingesta como nuevo contrato original independiente).
 */

import { createHash } from 'node:crypto';

export type AmendmentType =
  | 'AMOUNT_INCREASE'
  | 'AMOUNT_DECREASE'
  | 'PRICE_ADJUSTMENT'
  | 'SCOPE_MODIFICATION'
  | 'TERM_EXTENSION'
  | 'TERM_REDUCTION'
  | 'OTHER'
  | 'UNKNOWN';

export interface AmendmentInput {
  id?: string;
  amendmentDncpId: string;
  tipo?: AmendmentType;
  dncpAmendmentTypeRaw?: string | null;
  extendsContractId?: string | null;
  dncpContractCode?: string | null;
  sourceType?: 'EMBEDDED_AMENDMENT' | 'EXTENDS_CONTRACT';
  date?: string | null;
  description?: string | null;
  amountDelta?: number | null;
  durationDeltaDays?: number | null;
  financialCode?: string | null;
  currency?: string | null;
  rawPayload?: any;
}

export interface ContractInput {
  id: string;
  contractDncpId: string;
  originalAmount: number;
  originalDurationDays?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string;
}

export interface AmendmentTimelineEntry {
  amendmentDncpId: string;
  tipo: AmendmentType;
  dncpAmendmentTypeRaw: string | null;
  extendsContractId: string | null;
  dncpContractCode: string | null;
  sourceType: 'EMBEDDED_AMENDMENT' | 'EXTENDS_CONTRACT';
  date: string | null;
  description: string;
  financialCode: string | null;
  currency: string | null;
  amountDelta: number | null;
  cumulativeAmountDelta: number | null;
  durationDeltaDays: number | null;
  cumulativeDurationDeltaDays: number | null;
  isUnresolved: boolean;
}

export interface ContractEconomicHistory {
  contractId: string;
  contractDncpId: string;
  currency: string;
  originalAmount: number;
  originalDurationDays: number | null;
  totalAmountDelta: number | null;
  totalDurationDeltaDays: number | null;
  finalContractAmount: number | null; // null = FINAL_VALUE_UNKNOWN
  finalDurationDays: number | null;    // null = DURATION_UNKNOWN
  amendmentCount: number;
  hasUnresolvedAmendments: boolean;
  hasUnresolvedAmount: boolean;
  hasUnresolvedDuration: boolean;
  growthPercentage: number | null;
  durationGrowthPercentage: number | null;
  timeline: AmendmentTimelineEntry[];
}

export interface CompetitorBehaviorMetrics {
  supplierId: string;
  preAward: {
    totalBidsSubmitted: number;
    totalAwardsWon: number;
    winRatePct: number;
    avgDiscountVsReferencePct: number | null;
  };
  postAwardExecution: {
    totalContracts: number;
    contractsWithAmendments: number;
    amendmentFrequencyPct: number;
    totalContractedAmountOriginal: number;
    totalContractedAmountFinal: number | null;
    avgCostGrowthPct: number | null;
    avgTermExtensionDays: number | null;
    unresolvedContractsCount: number;
  };
}

/**
 * Clasifica una adenda contractual en base a su evidencia cruda oficial y deltas económicos observados.
 * Prioriza dncpAmendmentTypeRaw como evidencia primaria oficial.
 */
export function classifyAmendment(
  rawTypeOrDescription?: string | null,
  descriptionOrAmountDelta?: string | number | null,
  amountDeltaParam?: number | null,
  durationDeltaDaysParam?: number | null
): AmendmentType {
  let rawType: string = '';
  let description: string = '';
  let amountDelta: number | null = null;
  let durationDeltaDays: number | null = null;

  if (typeof descriptionOrAmountDelta === 'string') {
    rawType = (rawTypeOrDescription || '').trim().toLowerCase();
    description = descriptionOrAmountDelta.trim().toLowerCase();
    amountDelta = amountDeltaParam != null ? Number(amountDeltaParam) : null;
    durationDeltaDays = durationDeltaDaysParam != null ? Number(durationDeltaDaysParam) : null;
  } else {
    description = (rawTypeOrDescription || '').trim().toLowerCase();
    amountDelta = descriptionOrAmountDelta != null ? Number(descriptionOrAmountDelta) : null;
    durationDeltaDays = amountDeltaParam != null ? Number(amountDeltaParam) : null;
  }

  const combined = `${rawType} ${description}`.trim();

  // PRIORITY 1: EXPLICIT OFFICIAL / RAW AMENDMENT TEXTUAL SEMANTICS
  // 1.1 Price Adjustment (Reajuste de precios)
  if (combined.includes('reajuste') || rawType.includes('reajuste')) {
    return 'PRICE_ADJUSTMENT';
  }

  // 1.2 Term extension / Prórroga
  if (
    combined.includes('ampliación de plazo') ||
    combined.includes('ampliacion de plazo') ||
    combined.includes('extensión de plazo') ||
    combined.includes('extension de plazo') ||
    combined.includes('prórroga') ||
    combined.includes('prorroga')
  ) {
    return 'TERM_EXTENSION';
  }

  // 1.3 Term reduction
  if (
    combined.includes('reducción de plazo') ||
    combined.includes('reduccion de plazo')
  ) {
    return 'TERM_REDUCTION';
  }

  // 1.4 Amount increase
  if (
    combined.includes('ampliación de monto') ||
    combined.includes('ampliacion de monto') ||
    combined.includes('aumento de monto') ||
    combined.includes('adicional')
  ) {
    return 'AMOUNT_INCREASE';
  }

  // 1.5 Amount decrease
  if (
    combined.includes('disminución de monto') ||
    combined.includes('disminucion de monto') ||
    combined.includes('reducción de monto') ||
    combined.includes('reduccion de monto')
  ) {
    return 'AMOUNT_DECREASE';
  }

  // 1.6 Explicit Scope modification (Convenio modificatorio / modificación de alcance)
  if (
    combined.includes('modificación de alcance') ||
    combined.includes('modificacion de alcance') ||
    combined.includes('convenio modificatorio') ||
    combined.includes('nuevo item') ||
    combined.includes('nuevos items')
  ) {
    return 'SCOPE_MODIFICATION';
  }

  // PRIORITY 2: EXPLICIT DIMENSION EVIDENCE (When textual semantics are absent/generic)
  if (durationDeltaDays != null && durationDeltaDays !== 0) {
    return durationDeltaDays > 0 ? 'TERM_EXTENSION' : 'TERM_REDUCTION';
  }

  if (amountDelta != null && amountDelta !== 0) {
    return amountDelta > 0 ? 'AMOUNT_INCREASE' : 'AMOUNT_DECREASE';
  }

  // Generic modification mention without dimension
  if (combined.includes('modificación') || combined.includes('modificacion')) {
    return 'SCOPE_MODIFICATION';
  }

  if (combined === '' && amountDelta == null && durationDeltaDays == null) {
    return 'UNKNOWN';
  }

  return 'OTHER';
}

/**
 * Separa y estructura contratos originales vs contratos de adenda (extendsContractID)
 * Regla de Oro: Un contrato con extendsContractID JAMÁS se ingesta como nuevo contrato independiente.
 */
export function separateContractsAndExtendsAmendments(rawContracts: any[]): {
  originalContracts: any[];
  linkedAmendments: AmendmentInput[];
} {
  const originalContracts: any[] = [];
  const linkedAmendments: AmendmentInput[] = [];

  for (const c of rawContracts || []) {
    const extendsId = c.extendsContractID ? String(c.extendsContractID).trim() : '';

    if (extendsId !== '') {
      // Es un registro de adenda vinculado a un contrato previo
      const rawType = c.dncpAmendmentType || c.amendmentType || c.title || '';
      const amountVal = c.value?.amount != null ? Number(c.value.amount) : null;
      const currency = c.value?.currency ? String(c.value.currency).toUpperCase() : null;
      
      let durationDays: number | null = null;
      const isPureAmount = (rawType.toLowerCase().includes('monto') || rawType.toLowerCase().includes('reajuste')) &&
        !rawType.toLowerCase().includes('plazo') &&
        !rawType.toLowerCase().includes('prorroga') &&
        !rawType.toLowerCase().includes('prórroga');

      if (!isPureAmount && c.period?.startDate && c.period?.endDate) {
        const start = new Date(c.period.startDate).getTime();
        const end = new Date(c.period.endDate).getTime();
        if (!isNaN(start) && !isNaN(end)) {
          durationDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
        }
      }

      // Identidad determinística libre de aleatoriedad (SHA-256 fingerprint de atributos estables)
      const deterministicFallbackId = 'amend-' + createHash('sha256')
        .update(`${extendsId}:${c.dncpContractCode || ''}:${c.dateSigned || ''}:${amountVal ?? ''}:${rawType}`)
        .digest('hex')
        .slice(0, 16);

      linkedAmendments.push({
        amendmentDncpId: c.id || c.dncpContractCode || deterministicFallbackId,
        extendsContractId: extendsId,
        dncpContractCode: c.dncpContractCode || null,
        dncpAmendmentTypeRaw: rawType || null,
        sourceType: 'EXTENDS_CONTRACT',
        tipo: classifyAmendment(rawType, c.description || c.title, amountVal, durationDays),
        date: c.dateSigned || c.period?.startDate || null,
        description: c.description || c.title || rawType,
        amountDelta: amountVal,
        durationDeltaDays: durationDays,
        financialCode: c.financialCode || null,
        currency,
        rawPayload: c
      });
    } else {
      // Contrato original legítimo
      originalContracts.push(c);
    }
  }

  return { originalContracts, linkedAmendments };
}

/**
 * Computa la reconstrucción histórica económica estricta de un contrato público
 * Cumple con el principio UNKNOWN != DEFAULT:
 * Si una adenda declara ampliación/reajuste/modificación pero el valor numérico no puede ser resuelto,
 * `finalContractAmount` queda como `null` (UNKNOWN) y jamás se inventa un valor 0 ni se reusa el original.
 * 
 * Dimensiones desacopladas:
 * Incertidumbre en monto y en plazo se manejan de forma estrictamente independiente
 * (hasUnresolvedAmount y hasUnresolvedDuration).
 */
export function computeContractEconomicHistory(
  contract: ContractInput,
  rawAmendments: AmendmentInput[]
): ContractEconomicHistory {
  let totalAmountDelta = 0;
  let totalDurationDeltaDays = 0;
  let hasUnresolvedAmount = false;
  let hasUnresolvedDuration = false;
  const contractCurrency = (contract.currency || 'PYG').toUpperCase();
  const timeline: AmendmentTimelineEntry[] = [];

  // Ordenar adendas cronológicamente si tienen fecha
  const sortedAmendments = [...rawAmendments].sort((a, b) => {
    if (!a.date || !b.date) return 0;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  for (const amend of sortedAmendments) {
    const rawDesc = amend.description || '';
    const rawType = amend.dncpAmendmentTypeRaw || '';
    const inferredType = amend.tipo || classifyAmendment(rawType, rawDesc, amend.amountDelta, amend.durationDeltaDays);
    const amendCurrency = amend.currency ? amend.currency.toUpperCase() : null;
    
    let deltaAmt: number | null = null;
    let deltaDays: number | null = null;
    let entryUnresolved = false;

    // Verificar si es una adenda de plazo (TERM ONLY) vs monto (AMOUNT ONLY)
    const isExplicitTermType = inferredType === 'TERM_EXTENSION' || inferredType === 'TERM_REDUCTION';
    const isExplicitAmountType = inferredType === 'AMOUNT_INCREASE' || inferredType === 'AMOUNT_DECREASE' || inferredType === 'PRICE_ADJUSTMENT';

    // Verificar si la adenda implica impacto en monto
    const affectsAmount = isExplicitAmountType || (!isExplicitTermType && (
      rawDesc.toLowerCase().includes('monto') ||
      rawType.toLowerCase().includes('monto') ||
      rawType.toLowerCase().includes('reajuste')
    ));

    // Verificar si es una adenda exclusivamente de plazo
    const isTermOnly = isExplicitTermType && !affectsAmount;

    // Verificar si es una adenda exclusivamente de monto
    const isAmountOnly = affectsAmount && !isExplicitTermType &&
      !rawDesc.toLowerCase().includes('plazo') &&
      !rawType.toLowerCase().includes('plazo') &&
      !rawDesc.toLowerCase().includes('prorroga') &&
      !rawType.toLowerCase().includes('prórroga');

    // 1. DIMENSIÓN MONETARIA
    if (isTermOnly) {
      // Invariante P0: Adenda de SOLO PLAZO jamás altera el monto contractual
      deltaAmt = null;
    } else if (affectsAmount) {
      if (amendCurrency && amendCurrency !== contractCurrency) {
        // Discrepancia de monedas sin FX rate verificado bloquea agregación económica
        entryUnresolved = true;
        hasUnresolvedAmount = true;
      } else if (amend.amountDelta === undefined || amend.amountDelta === null || isNaN(amend.amountDelta)) {
        entryUnresolved = true;
        hasUnresolvedAmount = true;
      } else {
        deltaAmt = Number(amend.amountDelta);
        totalAmountDelta += deltaAmt;
      }
    } else if (amend.amountDelta != null && !isNaN(amend.amountDelta) && amend.amountDelta !== 0) {
      if (amendCurrency && amendCurrency !== contractCurrency) {
        entryUnresolved = true;
        hasUnresolvedAmount = true;
      } else {
        deltaAmt = Number(amend.amountDelta);
        totalAmountDelta += deltaAmt;
      }
    }

    // 2. DIMENSIÓN DE PLAZO
    const affectsDuration =
      isExplicitTermType || (!isAmountOnly && (
        rawDesc.toLowerCase().includes('plazo') ||
        rawDesc.toLowerCase().includes('prorroga') ||
        rawDesc.toLowerCase().includes('prórroga') ||
        rawType.toLowerCase().includes('plazo') ||
        rawType.toLowerCase().includes('prorroga') ||
        rawType.toLowerCase().includes('prórroga')
      ));

    if (affectsDuration) {
      if (amend.durationDeltaDays === undefined || amend.durationDeltaDays === null || isNaN(amend.durationDeltaDays)) {
        entryUnresolved = true;
        hasUnresolvedDuration = true;
      } else {
        deltaDays = Number(amend.durationDeltaDays);
        totalDurationDeltaDays += deltaDays;
      }
    } else if (amend.durationDeltaDays != null && !isNaN(amend.durationDeltaDays) && amend.durationDeltaDays !== 0) {
      // Si la adenda declara explícitamente un delta de plazo
      deltaDays = Number(amend.durationDeltaDays);
      totalDurationDeltaDays += deltaDays;
    }

    timeline.push({
      amendmentDncpId: amend.amendmentDncpId,
      tipo: inferredType,
      dncpAmendmentTypeRaw: amend.dncpAmendmentTypeRaw || null,
      extendsContractId: amend.extendsContractId || null,
      dncpContractCode: amend.dncpContractCode || null,
      sourceType: amend.sourceType || 'EMBEDDED_AMENDMENT',
      date: amend.date || null,
      description: rawDesc,
      financialCode: amend.financialCode || null,
      currency: amendCurrency || contractCurrency,
      amountDelta: deltaAmt,
      cumulativeAmountDelta: hasUnresolvedAmount ? null : totalAmountDelta,
      durationDeltaDays: deltaDays,
      cumulativeDurationDeltaDays: hasUnresolvedDuration ? null : totalDurationDeltaDays,
      isUnresolved: entryUnresolved
    });
  }

  const originalAmt = Number(contract.originalAmount) || 0;
  const finalAmt = hasUnresolvedAmount ? null : originalAmt + totalAmountDelta;
  const growthPct = (finalAmt !== null && originalAmt > 0)
    ? ((finalAmt - originalAmt) / originalAmt) * 100
    : null;

  const originalDays = contract.originalDurationDays != null ? Number(contract.originalDurationDays) : null;
  const finalDays = (originalDays !== null && !hasUnresolvedDuration)
    ? originalDays + totalDurationDeltaDays
    : null;
  const durationGrowthPct = (finalDays !== null && originalDays !== null && originalDays > 0)
    ? ((finalDays - originalDays) / originalDays) * 100
    : null;

  return {
    contractId: contract.id,
    contractDncpId: contract.contractDncpId,
    currency: contractCurrency,
    originalAmount: originalAmt,
    originalDurationDays: originalDays,
    totalAmountDelta: hasUnresolvedAmount ? null : totalAmountDelta,
    totalDurationDeltaDays: hasUnresolvedDuration ? null : totalDurationDeltaDays,
    finalContractAmount: finalAmt,
    finalDurationDays: finalDays,
    amendmentCount: sortedAmendments.length,
    hasUnresolvedAmendments: hasUnresolvedAmount || hasUnresolvedDuration,
    hasUnresolvedAmount,
    hasUnresolvedDuration,
    growthPercentage: growthPct != null ? Math.round(growthPct * 100) / 100 : null,
    durationGrowthPercentage: durationGrowthPct != null ? Math.round(durationGrowthPct * 100) / 100 : null,
    timeline
  };
}

/**
 * Calcula métricas de comportamiento histórico de un competidor
 * Mantiene pre-adjudicación y post-adjudicación estrictamente desacopladas sin asunciones causales.
 */
export function calculateCompetitorBehaviorMetrics(
  supplierId: string,
  bids: Array<{
    processId: string;
    montoOfertado?: number | null;
    montoReferencial?: number | null;
    gano?: boolean;
  }>,
  awards: Array<{
    processId: string;
    montoAdjudicado: number;
  }>,
  contractsWithHistory: Array<{
    contract: ContractInput;
    history: ContractEconomicHistory;
  }>
): CompetitorBehaviorMetrics {
  // 1. Métricas Pre-Adjudicación (Ofertas y Licitaciones)
  const totalBids = bids.length;
  const wonBids = bids.filter(b => b.gano === true).length;
  const winRatePct = totalBids > 0 ? Math.round((wonBids / totalBids) * 10000) / 100 : 0;

  const discounts: number[] = [];
  for (const b of bids) {
    if (b.montoOfertado && b.montoReferencial && b.montoReferencial > 0) {
      const discount = ((b.montoReferencial - b.montoOfertado) / b.montoReferencial) * 100;
      discounts.push(discount);
    }
  }
  const avgDiscount = discounts.length > 0
    ? Math.round((discounts.reduce((a, b) => a + b, 0) / discounts.length) * 100) / 100
    : null;

  // 2. Métricas Post-Adjudicación (Ejecución Contractual)
  const totalContracts = contractsWithHistory.length;
  const amendedContracts = contractsWithHistory.filter(c => c.history.amendmentCount > 0).length;
  const amendFreq = totalContracts > 0
    ? Math.round((amendedContracts / totalContracts) * 10000) / 100
    : 0;

  let totalOrigAmt = 0;
  let totalFinalAmt: number | null = 0;
  let unresolvedCount = 0;
  const growthPcts: number[] = [];
  const termExtensions: number[] = [];

  for (const item of contractsWithHistory) {
    totalOrigAmt += item.history.originalAmount;

    if (item.history.hasUnresolvedAmendments || item.history.finalContractAmount === null) {
      unresolvedCount++;
      totalFinalAmt = null; // Si al menos uno es desconocido, el agregado estricto no puede inventar el total
    } else if (totalFinalAmt !== null) {
      totalFinalAmt += item.history.finalContractAmount;
    }

    if (item.history.growthPercentage !== null) {
      growthPcts.push(item.history.growthPercentage);
    }

    if (item.history.totalDurationDeltaDays !== null && item.history.totalDurationDeltaDays > 0) {
      termExtensions.push(item.history.totalDurationDeltaDays);
    }
  }

  const avgCostGrowth = growthPcts.length > 0
    ? Math.round((growthPcts.reduce((a, b) => a + b, 0) / growthPcts.length) * 100) / 100
    : null;

  const avgTermExt = termExtensions.length > 0
    ? Math.round(termExtensions.reduce((a, b) => a + b, 0) / termExtensions.length)
    : null;

  return {
    supplierId,
    preAward: {
      totalBidsSubmitted: totalBids,
      totalAwardsWon: Math.max(wonBids, awards.length),
      winRatePct,
      avgDiscountVsReferencePct: avgDiscount
    },
    postAwardExecution: {
      totalContracts,
      contractsWithAmendments: amendedContracts,
      amendmentFrequencyPct: amendFreq,
      totalContractedAmountOriginal: totalOrigAmt,
      totalContractedAmountFinal: totalFinalAmt,
      avgCostGrowthPct: avgCostGrowth,
      avgTermExtensionDays: avgTermExt,
      unresolvedContractsCount: unresolvedCount
    }
  };
}
