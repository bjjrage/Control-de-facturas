import type {
  InventoryBalance,
  InventoryBudgetItemRef,
  InventoryCostLine,
  InventoryLocationRef,
  InventoryMovementInput,
  InventoryMovementResult,
  InventoryProductRef,
} from "./types";
import { InventoryValidationError, validateInventoryMovementShape } from "./validation";

type MutableBalance = InventoryBalance;

function balanceKey(productId: string, locationId: string, currency: string) {
  return `${productId}:${locationId}:${currency}`;
}

function sourceKey(input: InventoryMovementInput) {
  if (!input.sourceId) return null;
  return [input.sourceType, input.sourceId, input.sourceLineId ?? "", input.movementType].join(":");
}

function cloneBalances(source: Map<string, MutableBalance>) {
  return new Map([...source].map(([key, balance]) => [key, { ...balance }]));
}

/**
 * Deterministic in-memory model used by the functional domain tests and by
 * callers that need to validate a batch before sending it to the RPC. The
 * database RPC is the production authority; both implement the same rules.
 */
export class InventoryLedger {
  private readonly products = new Map<string, InventoryProductRef>();
  private readonly locations = new Map<string, InventoryLocationRef>();
  private readonly projects = new Map<string, string>();
  private readonly budgetItems = new Map<string, InventoryBudgetItemRef>();
  private balances = new Map<string, MutableBalance>();
  private readonly movements = new Map<string, InventoryMovementResult>();
  private readonly idempotency = new Map<string, InventoryMovementResult>();
  private readonly sources = new Map<string, InventoryMovementResult>();
  private readonly sourceRecords = new Map<string, string>();
  private sequence = 0;

  addProduct(product: InventoryProductRef) {
    this.products.set(product.id, product);
  }

  addLocation(location: InventoryLocationRef) {
    this.locations.set(location.id, location);
    if (location.projectId) this.projects.set(location.projectId, location.empresaId);
  }

  addProject(projectId: string, empresaId: string) {
    this.projects.set(projectId, empresaId);
  }

  addBudgetItem(item: InventoryBudgetItemRef) {
    this.budgetItems.set(item.id, item);
    this.projects.set(item.projectId, item.empresaId);
  }

  addSource(sourceType: string, sourceId: string, empresaId: string) {
    this.sourceRecords.set(`${sourceType}:${sourceId}`, empresaId);
  }

  seedBalance(balance: InventoryBalance) {
    this.assertTenant(balance.empresaId);
    if (!this.products.has(balance.productoId)) throw new InventoryValidationError("UNKNOWN_PRODUCT", "Material inexistente");
    if (!this.locations.has(balance.locationId)) throw new InventoryValidationError("UNKNOWN_LOCATION", "Ubicación inexistente");
    this.balances.set(balanceKey(balance.productoId, balance.locationId, balance.costCurrency), { ...balance });
  }

  post(input: InventoryMovementInput): InventoryMovementResult {
    validateInventoryMovementShape(input);
    const idempotencyKey = `${input.empresaId}:${input.idempotencyKey}`;
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) return existing;

    const existingSource = sourceKey(input);
    if (input.sourceId) {
      const sourceEmpresa = this.sourceRecords.get(`${input.sourceType}:${input.sourceId}`);
      if (sourceEmpresa && sourceEmpresa !== input.empresaId) {
        throw new InventoryValidationError("TENANT_MISMATCH", "El origen pertenece a otro tenant");
      }
    }
    if (existingSource) {
      const sourceMovement = this.sources.get(`${input.empresaId}:${existingSource}`);
      if (sourceMovement) return sourceMovement;
    }

    const product = this.products.get(input.productoId);
    if (!product) throw new InventoryValidationError("UNKNOWN_PRODUCT", "Material inexistente");
    this.assertTenant(product.empresaId, input.empresaId);
    if (product.unit.trim() !== input.unit.trim()) {
      throw new InventoryValidationError("UNIT_MISMATCH", "La unidad no coincide con el material");
    }

    const from = input.fromLocationId ? this.location(input.fromLocationId, input.empresaId) : null;
    const to = input.toLocationId ? this.location(input.toLocationId, input.empresaId) : null;
    if (input.projectId) {
      if (this.projects.get(input.projectId) !== input.empresaId) {
        throw new InventoryValidationError("UNKNOWN_PROJECT", "Proyecto inexistente");
      }
    }
    if (input.budgetItemId) {
      const budget = this.budgetItems.get(input.budgetItemId);
      if (!budget || budget.empresaId !== input.empresaId || budget.projectId !== input.projectId) {
        throw new InventoryValidationError("BUDGET_PROJECT_MISMATCH", "La partida no pertenece al proyecto");
      }
    }
    if (input.movementType === "CONSUMPTION" && from?.projectId !== input.projectId) {
      throw new InventoryValidationError("CONSUMPTION_NOT_FROM_PROJECT", "El consumo debe salir del pañol de la obra");
    }
    if (to?.type === "PROJECT" && input.projectId && to.projectId !== input.projectId) {
      throw new InventoryValidationError("LOCATION_PROJECT_MISMATCH", "La ubicación no pertenece al proyecto");
    }

    const nextBalances = cloneBalances(this.balances);
    const costLines: InventoryCostLine[] = [];
    const quantity = input.quantity;
    let costTotal = 0;

    const add = (locationId: string, qty: number, currency: string, totalCost: number) => {
      const key = balanceKey(input.productoId, locationId, currency);
      const current = nextBalances.get(key) ?? {
        empresaId: input.empresaId,
        productoId: input.productoId,
        locationId,
        costCurrency: currency,
        quantity: 0,
        totalCost: 0,
      };
      current.quantity += qty;
      current.totalCost += totalCost;
      if (current.quantity < -1e-9 || current.totalCost < -1e-9) {
        throw new InventoryValidationError("NEGATIVE_BALANCE", "El saldo no puede ser negativo");
      }
      nextBalances.set(key, current);
    };

    const remove = (locationId: string, qty: number) => {
      let remaining = qty;
      const candidates = [...nextBalances.values()]
        .filter((balance) => balance.productoId === input.productoId && balance.locationId === locationId && balance.quantity > 0)
        .sort((a, b) => a.costCurrency.localeCompare(b.costCurrency));
      for (const balance of candidates) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, balance.quantity);
        const unitCost = balance.quantity === 0 ? 0 : balance.totalCost / balance.quantity;
        const total = take === balance.quantity ? balance.totalCost : take * unitCost;
        balance.quantity -= take;
        balance.totalCost -= total;
        if (balance.quantity < 1e-9) balance.quantity = 0;
        if (balance.totalCost < 1e-9) balance.totalCost = 0;
        costLines.push({ quantity: take, costCurrency: balance.costCurrency, unitCost, totalCost: total });
        costTotal += total;
        remaining -= take;
      }
      if (remaining > 1e-9) {
        throw new InventoryValidationError("INSUFFICIENT_STOCK", `Stock insuficiente: faltan ${remaining}`);
      }
    };

    switch (input.movementType) {
      case "RECEIPT": {
        add(to!.id, quantity, input.costCurrency!, quantity * input.unitCost!);
        costLines.push({
          quantity,
          costCurrency: input.costCurrency!,
          unitCost: input.unitCost!,
          totalCost: quantity * input.unitCost!,
        });
        costTotal = quantity * input.unitCost!;
        break;
      }
      case "TRANSFER":
      case "RETURN":
        remove(from!.id, quantity);
        for (const line of costLines) add(to!.id, line.quantity, line.costCurrency, line.totalCost);
        break;
      case "CONSUMPTION":
        remove(from!.id, quantity);
        break;
      case "ADJUSTMENT":
        if (quantity > 0) {
          add(to!.id, quantity, input.costCurrency!, quantity * input.unitCost!);
          costLines.push({ quantity, costCurrency: input.costCurrency!, unitCost: input.unitCost!, totalCost: quantity * input.unitCost! });
          costTotal = quantity * input.unitCost!;
        } else {
          remove(from!.id, Math.abs(quantity));
          costTotal = -costLines.reduce((sum, line) => sum + line.totalCost, 0);
        }
        break;
    }

    const movement: InventoryMovementResult = {
      id: `inventory-movement-${++this.sequence}`,
      empresaId: input.empresaId,
      productoId: input.productoId,
      quantity,
      movementType: input.movementType,
      fromLocationId: from?.id ?? null,
      toLocationId: to?.id ?? null,
      projectId: input.projectId ?? null,
      budgetItemId: input.budgetItemId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceLineId: input.sourceLineId ?? null,
      idempotencyKey: input.idempotencyKey,
      costLines,
      costTotal,
    };
    this.balances = nextBalances;
    this.movements.set(movement.id, movement);
    this.idempotency.set(idempotencyKey, movement);
    if (existingSource) this.sources.set(`${input.empresaId}:${existingSource}`, movement);
    return movement;
  }

  getStock(productId: string, locationId?: string) {
    return [...this.balances.values()]
      .filter((balance) => balance.productoId === productId && (!locationId || balance.locationId === locationId))
      .reduce((total, balance) => total + balance.quantity, 0);
  }

  getGlobalStock(productId: string) {
    return this.getStock(productId);
  }

  getBalance(productId: string, locationId: string, currency: string) {
    return this.balances.get(balanceKey(productId, locationId, currency)) ?? null;
  }

  getMovements() {
    return [...this.movements.values()];
  }

  private location(id: string, empresaId: string) {
    const location = this.locations.get(id);
    if (!location) throw new InventoryValidationError("UNKNOWN_LOCATION", "Ubicación inexistente");
    this.assertTenant(location.empresaId, empresaId);
    if (location.active === false) throw new InventoryValidationError("INACTIVE_LOCATION", "La ubicación está inactiva");
    return location;
  }

  private assertTenant(actual: string, expected?: string) {
    if (expected && actual !== expected) {
      throw new InventoryValidationError("TENANT_MISMATCH", "La operación referencia otro tenant");
    }
  }
}
