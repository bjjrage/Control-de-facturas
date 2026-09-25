import { describe, expect, it } from "vitest";
import {
  buildManualInventoryMovement,
  parsePersistedManualInventoryAttempt,
  resolveManualMovementProject,
  validateManualInventoryMovementRequest,
  type ManualInventoryMovementRequest,
} from "../manual";

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const centralId = "44444444-4444-4444-8444-444444444444";
const projectLocationId = "55555555-5555-4555-8555-555555555555";
const projectId = "66666666-6666-4666-8666-666666666666";
const idempotencyKey = "77777777-7777-4777-8777-777777777777";

function request(overrides: Partial<ManualInventoryMovementRequest> = {}): ManualInventoryMovementRequest {
  return {
    idempotencyKey,
    productoId: productId,
    quantity: 4,
    movementType: "TRANSFER",
    fromLocationId: centralId,
    toLocationId: projectLocationId,
    ...overrides,
  };
}

describe("movimientos humanos de inventario", () => {
  it("restaura solo una solicitud persistida con versión y payload válidos", () => {
    expect(parsePersistedManualInventoryAttempt({ version: 1, request: request() })).toEqual(request());
    expect(parsePersistedManualInventoryAttempt({ version: 2, request: request() })).toBeNull();
    expect(parsePersistedManualInventoryAttempt({ version: 1, request: { ...request(), quantity: 0 } })).toBeNull();
  });

  it("crea transferencias manuales con clave/origen estable y sin costo nuevo", () => {
    const movement = buildManualInventoryMovement(request(), {
      empresaId: companyId,
      createdBy: userId,
      unit: "bolsa",
      projectId,
    });

    expect(movement).toMatchObject({
      movementType: "TRANSFER",
      sourceType: "MANUAL",
      sourceId: idempotencyKey,
      sourceLineId: null,
      idempotencyKey,
      projectId,
      budgetItemId: null,
      costCurrency: null,
      unitCost: null,
    });
  });

  it("requires a reason for adjustment and a PYG conversion rate for foreign-currency increases", () => {
    const increase = request({
      movementType: "ADJUSTMENT",
      quantity: 2,
      fromLocationId: null,
      toLocationId: centralId,
      costCurrency: "USD",
      unitCost: 10,
    });

    expect(() => validateManualInventoryMovementRequest(increase)).toThrow("motivo");
    expect(() => validateManualInventoryMovementRequest({ ...increase, reason: "Conteo físico" })).toThrow("tipo de cambio");
    expect(() => validateManualInventoryMovementRequest({
      ...increase,
      reason: "Conteo físico",
      exchangeRateToCompany: 7300,
    })).not.toThrow();
  });

  it("derives negative-adjustment cost from the selected existing currency bucket", () => {
    const movement = buildManualInventoryMovement(request({
      movementType: "ADJUSTMENT",
      quantity: -1.5,
      fromLocationId: projectLocationId,
      toLocationId: null,
      costCurrency: "PYG",
      reason: "Rotura constatada",
    }), {
      empresaId: companyId,
      createdBy: userId,
      unit: "bolsa",
      projectId,
      negativeAdjustmentUnitCost: 1532.25,
    });

    expect(movement).toMatchObject({
      movementType: "ADJUSTMENT",
      quantity: -1.5,
      fromLocationId: projectLocationId,
      toLocationId: null,
      unitCost: 1532.25,
      metadata: { reason: "Rotura constatada" },
    });
  });

  it("records opening stock as an idempotent canonical adjustment with its effective date", () => {
    const movement = buildManualInventoryMovement(request({
      movementType: "ADJUSTMENT",
      quantity: 18,
      fromLocationId: null,
      toLocationId: centralId,
      costCurrency: "PYG",
      unitCost: 12500,
      initialStockDate: "2026-09-01",
      reason: "Carga inicial · inventario de apertura",
    }), {
      empresaId: companyId,
      createdBy: userId,
      unit: "bolsa",
      projectId: null,
    });

    expect(movement).toMatchObject({
      movementType: "ADJUSTMENT",
      sourceType: "MANUAL",
      sourceId: idempotencyKey,
      idempotencyKey,
      toLocationId: centralId,
      metadata: {
        reason_type: "INITIAL_STOCK",
        effective_date: "2026-09-01",
      },
    });
    expect(() => validateManualInventoryMovementRequest({
      ...request({ movementType: "ADJUSTMENT", quantity: 2, fromLocationId: null, toLocationId: centralId, costCurrency: "PYG", unitCost: 1, reason: "Carga" }),
      initialStockDate: "2026-02-30",
    })).toThrow("fecha de carga inicial");
    expect(() => validateManualInventoryMovementRequest({
      ...request(),
      initialStockDate: "2026-09-01",
    })).toThrow("fecha de carga inicial");
  });

  it("rejects malformed quantities, duplicate endpoints and missing adjustment reasons", () => {
    expect(() => validateManualInventoryMovementRequest(request({ quantity: 0.00001 }))).toThrow("4 decimales");
    expect(() => validateManualInventoryMovementRequest(request({ toLocationId: centralId }))).toThrow("distintas");
    expect(() => validateManualInventoryMovementRequest(request({
      movementType: "ADJUSTMENT",
      quantity: -1,
      fromLocationId: centralId,
      toLocationId: null,
      costCurrency: "PYG",
    }))).toThrow("motivo");
  });

  it("uses the destination project for returns into a project and preserves origin context otherwise", () => {
    expect(resolveManualMovementProject("RETURN", projectId, null)).toBe(projectId);
    expect(resolveManualMovementProject("RETURN", null, projectId)).toBe(projectId);
    expect(resolveManualMovementProject("TRANSFER", projectId, "88888888-8888-4888-8888-888888888888"))
      .toBe(projectId);
  });
});
