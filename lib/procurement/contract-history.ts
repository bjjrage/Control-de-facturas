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
 * Invariante de competencia:
 * Separación rigurosa entre métricas pre-adjudicación (agresividad de oferta) y métricas post-adjudicación (modificaciones contractuales).
 * Cero inferencias causales especulativas sin prueba documental.
 */

export type AmendmentType =
  | 'AMOUNT_INCREASE'
  | 'AMOUNT_DECREASE'
  | 'TERM_EXTENSION'
  | 'TERM_REDUCTION'
  | 'SCOPE_MODIFICATION'
  | 'ADMINISTRATIVE'
  | 'OTHER';

export interface AmendmentInput {
  id?: string;
  amendmentDncpId: string;
  tipo?: AmendmentType;
  date?: string | null;
  description?: string | null;
  amountDelta?: number | null;
  durationDeltaDays?: number | null;
  financialCode?: string | null;
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
  date: string | null;
  description: string;
  financialCode: string | null;
  amountDelta: number;
  cumulativeAmountDelta: number;
  durationDeltaDays: number;
  cumulativeDurationDeltaDays: number;
  isUnresolved: boolean;
}

export interface ContractEconomicHistory {
  contractId: string;
  contractDncpId: string;
  currency: string;
  originalAmount: number;
  originalDurationDays: number | null;
  totalAmountDelta: number;
  totalDurationDeltaDays: number;
  finalContractAmount: number | null; // null = FINAL_VALUE_UNKNOWN
  finalDurationDays: number | null;    // null = DURATION_UNKNOWN
  amendmentCount: number;
  hasUnresolvedAmendments: boolean;
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
 * Clasifica una adenda contractual en base a su descripción y deltas económicos observados
 */
export function classifyAmendment(
  description?: string | null,
  amountDelta?: number | null,
  durationDeltaDays?: number | null
): AmendmentType {
  const desc = (description || '').toLowerCase().trim();
  const amt = amountDelta != null ? Number(amountDelta) : null;
  const days = durationDeltaDays != null ? Number(durationDeltaDays) : null;

  if ((amt != null && amt > 0) || desc.includes('ampliación de monto') || desc.includes('ampliacion de monto') || desc.includes('aumento de monto') || desc.includes('adicional')) {
    return 'AMOUNT_INCREASE';
  }

  if ((amt != null && amt < 0) || desc.includes('disminución de monto') || desc.includes('disminucion de monto') || desc.includes('reducción de monto') || desc.includes('reduccion de monto')) {
    return 'AMOUNT_DECREASE';
  }

  if ((days != null && days > 0) || desc.includes('prórroga') || desc.includes('prorroga') || desc.includes('ampliación de plazo') || desc.includes('ampliacion de plazo') || desc.includes('extensión de plazo') || desc.includes('extension de plazo')) {
    return 'TERM_EXTENSION';
  }

  if ((days != null && days < 0) || desc.includes('reducción de plazo') || desc.includes('reduccion de plazo')) {
    return 'TERM_REDUCTION';
  }

  if (desc.includes('modificación') || desc.includes('modificacion') || desc.includes('ajuste') || desc.includes('alcance') || desc.includes('especificaciones')) {
    return 'SCOPE_MODIFICATION';
  }

  if (desc.includes('aclaratoria') || desc.includes('administrativ') || desc.includes('cambio de cuenta') || desc.includes('representante')) {
    return 'ADMINISTRATIVE';
  }

  return 'OTHER';
}

/**
 * Computa la reconstrucción histórica económica estricta de un contrato público
 * Cumple con el principio UNKNOWN != DEFAULT:
 * Si una adenda declara ampliación/disminución de monto pero el valor numérico no puede ser resuelto,
 * `finalContractAmount` queda como `null` (UNKNOWN) y jamás se inventa un valor 0.
 */
export function computeContractEconomicHistory(
  contract: ContractInput,
  rawAmendments: AmendmentInput[]
): ContractEconomicHistory {
  let totalAmountDelta = 0;
  let totalDurationDeltaDays = 0;
  let hasUnresolved = false;
  const timeline: AmendmentTimelineEntry[] = [];

  // Ordenar adendas cronológicamente si tienen fecha
  const sortedAmendments = [...rawAmendments].sort((a, b) => {
    if (!a.date || !b.date) return 0;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  for (const amend of sortedAmendments) {
    const rawDesc = amend.description || '';
    const inferredType = amend.tipo || classifyAmendment(rawDesc, amend.amountDelta, amend.durationDeltaDays);
    
    let deltaAmt = 0;
    let deltaDays = 0;
    let entryUnresolved = false;

    // Verificar si la adenda implica impacto en monto
    if (inferredType === 'AMOUNT_INCREASE' || inferredType === 'AMOUNT_DECREASE' || rawDesc.toLowerCase().includes('monto')) {
      if (amend.amountDelta === undefined || amend.amountDelta === null || isNaN(amend.amountDelta)) {
        entryUnresolved = true;
        hasUnresolved = true;
      } else {
        deltaAmt = Number(amend.amountDelta);
      }
    } else if (amend.amountDelta != null && !isNaN(amend.amountDelta) && amend.amountDelta !== 0) {
      deltaAmt = Number(amend.amountDelta);
    }

    // Verificar si la adenda implica impacto en plazo
    if (inferredType === 'TERM_EXTENSION' || inferredType === 'TERM_REDUCTION' || rawDesc.toLowerCase().includes('plazo')) {
      if (amend.durationDeltaDays === undefined || amend.durationDeltaDays === null || isNaN(amend.durationDeltaDays)) {
        entryUnresolved = true;
        hasUnresolved = true;
      } else {
        deltaDays = Number(amend.durationDeltaDays);
      }
    } else if (amend.durationDeltaDays != null && !isNaN(amend.durationDeltaDays) && amend.durationDeltaDays !== 0) {
      deltaDays = Number(amend.durationDeltaDays);
    }

    totalAmountDelta += deltaAmt;
    totalDurationDeltaDays += deltaDays;

    timeline.push({
      amendmentDncpId: amend.amendmentDncpId,
      tipo: inferredType,
      date: amend.date || null,
      description: rawDesc,
      financialCode: amend.financialCode || null,
      amountDelta: deltaAmt,
      cumulativeAmountDelta: totalAmountDelta,
      durationDeltaDays: deltaDays,
      cumulativeDurationDeltaDays: totalDurationDeltaDays,
      isUnresolved: entryUnresolved
    });
  }

  const originalAmt = Number(contract.originalAmount) || 0;
  const finalAmt = hasUnresolved ? null : originalAmt + totalAmountDelta;
  const growthPct = (finalAmt !== null && originalAmt > 0)
    ? ((finalAmt - originalAmt) / originalAmt) * 100
    : null;

  const originalDays = contract.originalDurationDays != null ? Number(contract.originalDurationDays) : null;
  const finalDays = (originalDays !== null && !hasUnresolved)
    ? originalDays + totalDurationDeltaDays
    : null;
  const durationGrowthPct = (finalDays !== null && originalDays !== null && originalDays > 0)
    ? ((finalDays - originalDays) / originalDays) * 100
    : null;

  return {
    contractId: contract.id,
    contractDncpId: contract.contractDncpId,
    currency: contract.currency || 'PYG',
    originalAmount: originalAmt,
    originalDurationDays: originalDays,
    totalAmountDelta,
    totalDurationDeltaDays,
    finalContractAmount: finalAmt,
    finalDurationDays: finalDays,
    amendmentCount: sortedAmendments.length,
    hasUnresolvedAmendments: hasUnresolved,
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

    if (item.history.totalDurationDeltaDays > 0) {
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
