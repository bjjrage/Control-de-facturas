import { describe, expect, it } from "vitest";
import { InventoryLedger } from "../domain";
import { InventoryValidationError, validateWarehouseSubmissionLines } from "../validation";
import type { InventoryMovementInput } from "../types";

const tenantA = "empresa-a";
const tenantB = "empresa-b";
const projectA = "obra-a";
const projectB = "obra-b";
const projectC = "obra-c";
const product = "cemento";
const budgetA = "partida-a";

function makeLedger() {
  const ledger = new InventoryLedger();
  ledger.addProduct({ id: product, empresaId: tenantA, unit: "bolsa" });
  ledger.addProduct({ id: "producto-b", empresaId: tenantB, unit: "bolsa" });
  ledger.addProject(projectA, tenantA);
  ledger.addProject(projectB, tenantB);
  ledger.addProject(projectC, tenantA);
  ledger.addBudgetItem({ id: budgetA, empresaId: tenantA, projectId: projectA });
  ledger.addBudgetItem({ id: "partida-b", empresaId: tenantB, projectId: projectB });
  ledger.addLocation({ id: "obra-a", empresaId: tenantA, type: "PROJECT", projectId: projectA });
  ledger.addLocation({ id: "obra-b", empresaId: tenantA, type: "PROJECT", projectId: projectA });
  ledger.addLocation({ id: "central-a", empresaId: tenantA, type: "CENTRAL", projectId: null });
  ledger.addLocation({ id: "obra-c", empresaId: tenantA, type: "PROJECT", projectId: projectC });
  ledger.addLocation({ id: "obra-b-foreign", empresaId: tenantB, type: "PROJECT", projectId: projectB });
  return ledger;
}

function receipt(overrides: Partial<InventoryMovementInput> = {}): InventoryMovementInput {
  return {
    empresaId: tenantA,
    productoId: product,
    quantity: 100,
    unit: "bolsa",
    movementType: "RECEIPT",
    toLocationId: "obra-a",
    sourceType: "OC_RECEPCION",
    sourceId: "receipt-1",
    sourceLineId: "receipt-line-1",
    idempotencyKey: "receipt-1-line-1",
    costCurrency: "PYG",
    unitCost: 10,
    ...overrides,
  };
}

function transfer(overrides: Partial<InventoryMovementInput> = {}): InventoryMovementInput {
  return {
    empresaId: tenantA,
    productoId: product,
    quantity: 20,
    unit: "bolsa",
    movementType: "TRANSFER",
    fromLocationId: "obra-a",
    toLocationId: "obra-b",
    sourceType: "TRANSFER",
    sourceId: "transfer-1",
    idempotencyKey: "transfer-1",
    ...overrides,
  };
}

function consumption(overrides: Partial<InventoryMovementInput> = {}): InventoryMovementInput {
  return {
    empresaId: tenantA,
    productoId: product,
    quantity: 10,
    unit: "bolsa",
    movementType: "CONSUMPTION",
    fromLocationId: "obra-a",
    projectId: projectA,
    budgetItemId: budgetA,
    sourceType: "WAREHOUSE_SUBMISSION",
    sourceId: "submission-1",
    sourceLineId: "submission-line-1",
    idempotencyKey: "submission-1-line-1",
    ...overrides,
  };
}

describe("inventario canónico: invariantes de dominio", () => {
  it("una recepción directa aumenta obra y global una sola vez", () => {
    const ledger = makeLedger();
    const movement = ledger.post(receipt());

    expect(ledger.getStock(product, "obra-a")).toBe(100);
    expect(ledger.getGlobalStock(product)).toBe(100);
    expect(ledger.getMovements()).toHaveLength(1);
    expect(movement.sourceType).toBe("OC_RECEPCION");
  });

  it("una transferencia baja origen, sube destino y no cambia global", () => {
    const ledger = makeLedger();
    ledger.post(receipt());
    ledger.post(transfer());

    expect(ledger.getStock(product, "obra-a")).toBe(80);
    expect(ledger.getStock(product, "obra-b")).toBe(20);
    expect(ledger.getGlobalStock(product)).toBe(100);
    expect(ledger.getMovements()[1].costTotal).toBe(200);
  });

  it("el consumo baja obra/global y lleva costo real a la partida", () => {
    const ledger = makeLedger();
    ledger.post(receipt());
    const movement = ledger.post(consumption({ quantity: 20 }));

    expect(ledger.getStock(product, "obra-a")).toBe(80);
    expect(ledger.getGlobalStock(product)).toBe(80);
    expect(movement.budgetItemId).toBe(budgetA);
    expect(movement.costTotal).toBe(200);
    expect(movement.costLines[0].costCurrency).toBe("PYG");
  });

  it("rechaza consumo mayor al stock sin dejar cambios parciales", () => {
    const ledger = makeLedger();
    ledger.post(receipt({ quantity: 5 }));

    expect(() => ledger.post(consumption({ quantity: 6 }))).toThrowError(/faltan/);
    expect(ledger.getGlobalStock(product)).toBe(5);
    expect(ledger.getMovements()).toHaveLength(1);
  });

  it("rechaza operar un material o ubicación de otro tenant", () => {
    const ledger = makeLedger();
    expect(() => ledger.post(receipt({ productoId: "producto-b" }))).toThrowError(InventoryValidationError);
    expect(() => ledger.post(receipt({ toLocationId: "obra-b-foreign" }))).toThrowError(/tenant/);
  });

  it("rechaza consumo desde una obra distinta al proyecto contextual", () => {
    const ledger = makeLedger();
    ledger.post(receipt());
    expect(() => ledger.post(consumption({ fromLocationId: "obra-c" }))).toThrowError(/pañol/);
  });

  it("rechaza una partida que pertenece a otra obra o empresa", () => {
    const ledger = makeLedger();
    ledger.post(receipt());
    expect(() => ledger.post(consumption({ budgetItemId: "partida-b" }))).toThrowError(/partida/);
  });

  it("una OC de otro tenant no puede ser registrada como origen conocido", () => {
    const ledger = makeLedger();
    ledger.addSource("OC_RECEPCION", "foreign-receipt", tenantB);
    expect(() => ledger.post(receipt({ sourceId: "foreign-receipt" }))).toThrowError(/tenant/);
  });

  it("retry de recepción con la misma clave no duplica saldo", () => {
    const ledger = makeLedger();
    const first = ledger.post(receipt());
    const retry = ledger.post(receipt());

    expect(retry.id).toBe(first.id);
    expect(ledger.getGlobalStock(product)).toBe(100);
    expect(ledger.getMovements()).toHaveLength(1);
  });

  it("retry de consumo con la misma clave no duplica imputación", () => {
    const ledger = makeLedger();
    ledger.post(receipt());
    const first = ledger.post(consumption());
    const retry = ledger.post(consumption());

    expect(retry.id).toBe(first.id);
    expect(ledger.getGlobalStock(product)).toBe(90);
    expect(ledger.getMovements()).toHaveLength(2);
  });

  it("una rendición propuesta no genera movimientos hasta su confirmación", () => {
    const ledger = makeLedger();
    validateWarehouseSubmissionLines([
      { lineNumber: 1, rawDescription: "Cemento", quantity: 10, unit: "bolsa", state: "PROPOSED" },
    ]);
    expect(ledger.getMovements()).toHaveLength(0);
    ledger.post(receipt());
    expect(ledger.getMovements()).toHaveLength(1);
  });

  it("una rendición confirmada genera una salida una sola vez", () => {
    const ledger = makeLedger();
    ledger.post(receipt());
    const confirmed = ledger.post(consumption({ sourceId: "submission-2", sourceLineId: "line-1", idempotencyKey: "submission-2-line-1" }));
    const retry = ledger.post(consumption({ sourceId: "submission-2", sourceLineId: "line-1", idempotencyKey: "retry-with-new-key" }));

    expect(confirmed.id).toBe(retry.id);
    expect(ledger.getGlobalStock(product)).toBe(90);
  });

  it("return y adjustment conservan la invariante de stock global", () => {
    const ledger = makeLedger();
    ledger.post(receipt({ quantity: 10 }));
    const returned = ledger.post({
      ...receipt({ quantity: 2, toLocationId: "central-a" }),
      movementType: "RETURN",
      fromLocationId: "obra-a",
      costCurrency: null,
      unitCost: null,
      sourceType: "RETURN",
      sourceId: "return-1",
      sourceLineId: null,
      idempotencyKey: "return-1",
    });
    ledger.post({
      ...receipt({ quantity: -1 }),
      movementType: "ADJUSTMENT",
      fromLocationId: "obra-a",
      toLocationId: null,
      sourceType: "ADJUSTMENT",
      sourceId: "adjustment-1",
      sourceLineId: null,
      idempotencyKey: "adjustment-1",
    });
    expect(ledger.getStock(product, "obra-a")).toBe(7);
    expect(ledger.getStock(product, "central-a")).toBe(2);
    expect(ledger.getGlobalStock(product)).toBe(9);
    expect(returned.costLines[0].totalCost).toBe(20);
  });

  it("preserva costos en monedas distintas sin convertirlas sin FX", () => {
    const ledger = makeLedger();
    ledger.post(receipt({ quantity: 5, costCurrency: "USD", unitCost: 2, sourceId: "usd-receipt", sourceLineId: "usd-line", idempotencyKey: "usd" }));
    ledger.post(receipt({ quantity: 5, costCurrency: "PYG", unitCost: 10000, sourceId: "pyg-receipt", sourceLineId: "pyg-line", idempotencyKey: "pyg" }));
    const movement = ledger.post(transfer({ quantity: 7 }));

    expect(ledger.getGlobalStock(product)).toBe(10);
    expect(movement.costLines.map((line) => line.costCurrency)).toEqual(["PYG", "USD"]);
    expect(movement.costLines.map((line) => line.totalCost)).toEqual([50000, 4]);
  });

  it("guarda origen y línea para reconstruir la auditoría", () => {
    const ledger = makeLedger();
    const movement = ledger.post(receipt());
    expect(movement.sourceId).toBe("receipt-1");
    expect(movement.sourceLineId).toBe("receipt-line-1");
    expect(movement.idempotencyKey).toBe("receipt-1-line-1");
  });
});
