export type LegacyCostEvidenceStatus = "VALIDA" | "REVISION_REQUERIDA";

export interface LegacyCostEvidence {
  originalCurrency: string | null;
  originalUnitCost: number | null;
  exchangeRateToCompany?: number | null;
  canonicalUnitCostPyg?: number | null;
  status: LegacyCostEvidenceStatus;
}

export interface LegacyCostResolution {
  status: "COMPUTABLE" | "REVISION_REQUERIDA";
  costCurrency: "PYG" | null;
  canonicalUnitCost: number | null;
  originalCurrency: string | null;
  originalUnitCost: number | null;
  exchangeRateToCompany: number | null;
  reason:
    | "LEGACY_PYG_EVIDENCE"
    | "LEGACY_FOREIGN_COST_NORMALIZED"
    | "LEGACY_FOREIGN_COST_REQUIRES_FX"
    | "LEGACY_COST_CURRENCY_UNKNOWN"
    | "LEGACY_COST_EVIDENCE_AMBIGUOUS"
    | "LEGACY_COST_INVALID";
}

const EPSILON = 0.0001;
const SUPPORTED_FOREIGN_CURRENCIES = new Set(["USD", "EUR", "BRL", "ARS"]);

function finiteNonNegative(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function normalizeCurrency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized || null;
}

function closeEnough(left: number, right: number) {
  return Math.abs(left - right) <= EPSILON;
}

/**
 * Resolves the legacy producto.costo_promedio only from explicit evidence.
 * Missing/ambiguous currency never becomes PYG by default.
 */
export function resolveLegacyInventoryCost(input: {
  legacyUnitCost: number | null;
  evidence: LegacyCostEvidence[];
}): LegacyCostResolution {
  const evidence = input.evidence.length === 1 ? input.evidence[0] : null;
  const originalCurrency = normalizeCurrency(evidence?.originalCurrency);
  const originalUnitCost = finiteNonNegative(evidence?.originalUnitCost)
    ? evidence!.originalUnitCost
    : finiteNonNegative(input.legacyUnitCost)
      ? input.legacyUnitCost
      : null;

  if (!finiteNonNegative(input.legacyUnitCost)) {
    return {
      status: "REVISION_REQUERIDA",
      costCurrency: null,
      canonicalUnitCost: null,
      originalCurrency,
      originalUnitCost,
      exchangeRateToCompany: null,
      reason: "LEGACY_COST_INVALID",
    };
  }

  if (!evidence) {
    return {
      status: "REVISION_REQUERIDA",
      costCurrency: null,
      canonicalUnitCost: null,
      originalCurrency: null,
      originalUnitCost: input.legacyUnitCost,
      exchangeRateToCompany: null,
      reason: input.evidence.length === 0 ? "LEGACY_COST_CURRENCY_UNKNOWN" : "LEGACY_COST_EVIDENCE_AMBIGUOUS",
    };
  }

  if (originalCurrency === "PYG" && evidence.status === "VALIDA" && originalUnitCost != null) {
    const canonicalUnitCost = evidence.canonicalUnitCostPyg ?? originalUnitCost;
    if (closeEnough(originalUnitCost, input.legacyUnitCost) && closeEnough(canonicalUnitCost, input.legacyUnitCost)) {
      return {
        status: "COMPUTABLE",
        costCurrency: "PYG",
        canonicalUnitCost,
        originalCurrency,
        originalUnitCost,
        exchangeRateToCompany: 1,
        reason: "LEGACY_PYG_EVIDENCE",
      };
    }
  }

  if (originalCurrency && SUPPORTED_FOREIGN_CURRENCIES.has(originalCurrency)
    && evidence.status === "VALIDA" && originalUnitCost != null) {
    const exchangeRate = evidence.exchangeRateToCompany;
    const converted = exchangeRate && exchangeRate > 0 ? originalUnitCost * exchangeRate : null;
    const canonicalUnitCost = evidence.canonicalUnitCostPyg ?? converted;
    if (exchangeRate && exchangeRate > 0 && canonicalUnitCost != null && converted != null
      && closeEnough(converted, canonicalUnitCost)
      && closeEnough(canonicalUnitCost, input.legacyUnitCost)) {
      return {
        status: "COMPUTABLE",
        costCurrency: "PYG",
        canonicalUnitCost,
        originalCurrency,
        originalUnitCost,
        exchangeRateToCompany: exchangeRate,
        reason: "LEGACY_FOREIGN_COST_NORMALIZED",
      };
    }
  }

  if (originalCurrency && SUPPORTED_FOREIGN_CURRENCIES.has(originalCurrency)
    && evidence.status === "REVISION_REQUERIDA") {
    return {
      status: "REVISION_REQUERIDA",
      costCurrency: null,
      canonicalUnitCost: null,
      originalCurrency,
      originalUnitCost,
      exchangeRateToCompany: null,
      reason: "LEGACY_FOREIGN_COST_REQUIRES_FX",
    };
  }

  return {
    status: "REVISION_REQUERIDA",
    costCurrency: null,
    canonicalUnitCost: null,
    originalCurrency,
    originalUnitCost,
    exchangeRateToCompany: null,
    reason: "LEGACY_COST_CURRENCY_UNKNOWN",
  };
}
