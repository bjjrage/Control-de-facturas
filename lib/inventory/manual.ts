import { validateInventoryMovementShape } from "./validation";
import type { InventoryMovementInput } from "./types";
import type { CurrencyCode } from "@/lib/types";

export type ManualInventoryMovementType = "TRANSFER" | "RETURN" | "ADJUSTMENT";

export interface ManualInventoryMovementRequest {
  idempotencyKey: string;
  productoId: string;
  quantity: number;
  movementType: ManualInventoryMovementType;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  costCurrency?: CurrencyCode | null;
  unitCost?: number | null;
  exchangeRateToCompany?: number | null;
  reason?: string | null;
}

export function parsePersistedManualInventoryAttempt(value: unknown): ManualInventoryMovementRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { version?: unknown; request?: unknown };
  if (record.version !== 1 || !record.request || typeof record.request !== "object") return null;
  try {
    const request = record.request as ManualInventoryMovementRequest;
    validateManualInventoryMovementRequest(request);
    return request;
  } catch {
    return null;
  }
}

export interface ManualMovementLocationOption {
  id: string;
  name: string;
  locationType: "CENTRAL" | "PROJECT" | "AUXILIARY";
  projectId: string | null;
  projectName: string | null;
}

export interface ManualMovementProductOption {
  id: string;
  name: string;
  unit: string;
}

export interface ManualMovementBalanceOption {
  productId: string;
  locationId: string;
  costCurrency: string | null;
  quantity: number;
  totalCost: number | null;
  costStatus: "COMPUTABLE" | "REVISION_REQUERIDA";
}

const CURRENCIES: CurrencyCode[] = ["PYG", "USD", "EUR", "BRL", "ARS"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasScale(value: number, places: number) {
  const factor = 10 ** places;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-7;
}

function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCIES.includes(value as CurrencyCode);
}

export function isManualInventoryMovementType(value: unknown): value is ManualInventoryMovementType {
  return value === "TRANSFER" || value === "RETURN" || value === "ADJUSTMENT";
}

export function validateManualInventoryMovementRequest(input: ManualInventoryMovementRequest) {
  if (!input || typeof input !== "object") {
    throw new Error("Los datos del movimiento no son válidos.");
  }
  if (!isManualInventoryMovementType(input.movementType)) {
    throw new Error("El tipo de movimiento manual no es válido.");
  }
  if (!UUID_PATTERN.test(input.idempotencyKey)) {
    throw new Error("La clave de idempotencia no es válida.");
  }
  if (typeof input.productoId !== "string" || !UUID_PATTERN.test(input.productoId)) {
    throw new Error("El producto no es válido.");
  }
  if (!Number.isFinite(input.quantity) || input.quantity === 0 || !hasScale(input.quantity, 4)) {
    throw new Error("La cantidad debe ser distinta de cero y tener como máximo 4 decimales.");
  }
  if (input.movementType !== "ADJUSTMENT" && input.quantity < 0) {
    throw new Error("La cantidad debe ser positiva para transferencias y devoluciones.");
  }

  const validLocationId = (value: unknown): value is string =>
    typeof value === "string" && UUID_PATTERN.test(value);
  const from = input.fromLocationId ?? null;
  const to = input.toLocationId ?? null;
  if (input.movementType === "TRANSFER" || input.movementType === "RETURN") {
    if (!validLocationId(from) || !validLocationId(to) || from === to) {
      throw new Error("Elegí ubicaciones de origen y destino distintas.");
    }
  } else if (input.quantity > 0) {
    if (from !== null || !validLocationId(to)) {
      throw new Error("El ajuste de entrada necesita solo una ubicación destino.");
    }
  } else if (!validLocationId(from) || to !== null) {
    throw new Error("El ajuste de salida necesita solo una ubicación origen.");
  }

  if (input.reason != null && typeof input.reason !== "string") {
    throw new Error("El motivo del movimiento no es válido.");
  }
  const reason = input.reason?.trim() ?? "";
  if (input.movementType === "ADJUSTMENT" && !reason) {
    throw new Error("Los ajustes requieren un motivo.");
  }
  if (reason.length > 500) {
    throw new Error("El motivo no puede superar los 500 caracteres.");
  }

  if (input.movementType === "ADJUSTMENT") {
    if (!isCurrency(input.costCurrency)) {
      throw new Error("Seleccioná una moneda válida para el ajuste.");
    }
    if (input.quantity > 0) {
      if (
        input.unitCost == null
        || !Number.isFinite(input.unitCost)
        || input.unitCost < 0
        || !hasScale(input.unitCost, 6)
      ) {
        throw new Error("El ajuste de entrada requiere costo unitario (hasta 6 decimales).");
      }
      if (input.costCurrency !== "PYG") {
        if (
          input.exchangeRateToCompany == null
          || !Number.isFinite(input.exchangeRateToCompany)
          || input.exchangeRateToCompany <= 0
          || !hasScale(input.exchangeRateToCompany, 8)
        ) {
          throw new Error("Un ajuste en moneda extranjera requiere tipo de cambio a PYG.");
        }
      }
    }
  }
}

export function resolveManualMovementProject(
  movementType: ManualInventoryMovementType,
  fromProjectId: string | null,
  toProjectId: string | null,
) {
  if (movementType === "RETURN" && toProjectId) return toProjectId;
  return fromProjectId ?? toProjectId ?? null;
}

export function buildManualInventoryMovement(
  request: ManualInventoryMovementRequest,
  context: {
    empresaId: string;
    createdBy: string;
    unit: string;
    projectId: string | null;
    negativeAdjustmentUnitCost?: number | null;
  },
): InventoryMovementInput {
  validateManualInventoryMovementRequest(request);

  const isAdjustment = request.movementType === "ADJUSTMENT";
  const isAdjustmentIncrease = isAdjustment && request.quantity > 0;
  const unitCost = isAdjustmentIncrease ? request.unitCost : context.negativeAdjustmentUnitCost;
  if (isAdjustment && unitCost == null) {
    throw new Error("No se pudo determinar el costo canónico del ajuste.");
  }

  const movement: InventoryMovementInput = {
    empresaId: context.empresaId,
    productoId: request.productoId,
    quantity: request.quantity,
    unit: context.unit.trim(),
    movementType: request.movementType,
    fromLocationId: request.fromLocationId ?? null,
    toLocationId: request.toLocationId ?? null,
    projectId: context.projectId,
    budgetItemId: null,
    sourceType: "MANUAL",
    sourceId: request.idempotencyKey,
    sourceLineId: null,
    idempotencyKey: request.idempotencyKey,
    costCurrency: isAdjustment ? request.costCurrency : null,
    unitCost: isAdjustment ? unitCost : null,
    exchangeRateToCompany: isAdjustmentIncrease ? request.exchangeRateToCompany ?? null : null,
    createdBy: context.createdBy,
    metadata: request.reason?.trim() ? { reason: request.reason.trim() } : {},
  };
  validateInventoryMovementShape(movement);
  return movement;
}
