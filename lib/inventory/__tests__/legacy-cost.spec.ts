import { describe, expect, it } from "vitest";
import { resolveLegacyInventoryCost } from "../legacy-cost";

describe("backfill legacy: semántica de moneda y costo", () => {
  it("costo PYG válido es computable", () => {
    const result = resolveLegacyInventoryCost({
      legacyUnitCost: 65000,
      evidence: [{ originalCurrency: "PYG", originalUnitCost: 65000, status: "VALIDA" }],
    });

    expect(result).toMatchObject({
      status: "COMPUTABLE",
      costCurrency: "PYG",
      canonicalUnitCost: 65000,
      originalCurrency: "PYG",
      exchangeRateToCompany: 1,
    });
  });

  it("moneda extranjera con FX válido se convierte y conserva el nominal original", () => {
    const result = resolveLegacyInventoryCost({
      legacyUnitCost: 187500,
      evidence: [{
        originalCurrency: "USD",
        originalUnitCost: 25,
        exchangeRateToCompany: 7500,
        canonicalUnitCostPyg: 187500,
        status: "VALIDA",
      }],
    });

    expect(result).toMatchObject({
      status: "COMPUTABLE",
      costCurrency: "PYG",
      canonicalUnitCost: 187500,
      originalCurrency: "USD",
      originalUnitCost: 25,
      exchangeRateToCompany: 7500,
    });
  });

  it("moneda extranjera sin FX queda en revisión y no computable", () => {
    const result = resolveLegacyInventoryCost({
      legacyUnitCost: 25,
      evidence: [{ originalCurrency: "USD", originalUnitCost: 25, exchangeRateToCompany: null, status: "REVISION_REQUERIDA" }],
    });

    expect(result).toMatchObject({
      status: "REVISION_REQUERIDA",
      costCurrency: null,
      canonicalUnitCost: null,
      originalCurrency: "USD",
      originalUnitCost: 25,
      reason: "LEGACY_FOREIGN_COST_REQUIRES_FX",
    });
  });

  it("moneda desconocida falla cerrada", () => {
    const result = resolveLegacyInventoryCost({
      legacyUnitCost: 100000,
      evidence: [{
        originalCurrency: "JPY",
        originalUnitCost: 100,
        exchangeRateToCompany: 1000,
        canonicalUnitCostPyg: 100000,
        status: "VALIDA",
      }],
    });

    expect(result.status).toBe("REVISION_REQUERIDA");
    expect(result.costCurrency).toBeNull();
    expect(result.canonicalUnitCost).toBeNull();
    expect(result.originalCurrency).toBe("JPY");
    expect(result.reason).toBe("LEGACY_COST_CURRENCY_UNKNOWN");
  });

  it("sin evidencia no reinterpreta silenciosamente el nominal como PYG", () => {
    const result = resolveLegacyInventoryCost({ legacyUnitCost: 25, evidence: [] });

    expect(result).toMatchObject({
      status: "REVISION_REQUERIDA",
      costCurrency: null,
      canonicalUnitCost: null,
      originalCurrency: null,
      originalUnitCost: 25,
      reason: "LEGACY_COST_CURRENCY_UNKNOWN",
    });
    expect(result.costCurrency).not.toBe("PYG");
  });
});
