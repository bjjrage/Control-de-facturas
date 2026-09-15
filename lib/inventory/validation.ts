import type {
  InventoryMovementInput,
  InventoryMovementType,
  WarehouseSubmissionLineInput,
} from "./types";

export class InventoryValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryValidationError";
    this.code = code;
  }
}

function requireLocation(value: string | null | undefined, label: string): asserts value is string {
  if (!value) throw new InventoryValidationError("LOCATION_REQUIRED", `${label} es obligatoria`);
}

export function validateInventoryMovementShape(input: InventoryMovementInput): void {
  if (!Number.isFinite(input.quantity) || input.quantity === 0) {
    throw new InventoryValidationError("INVALID_QUANTITY", "La cantidad debe ser distinta de cero");
  }
  if (input.movementType !== "ADJUSTMENT" && input.quantity < 0) {
    throw new InventoryValidationError("INVALID_QUANTITY", "La cantidad debe ser positiva");
  }
  if (!input.unit.trim()) {
    throw new InventoryValidationError("UNIT_REQUIRED", "La unidad es obligatoria");
  }
  if (!input.idempotencyKey.trim()) {
    throw new InventoryValidationError("IDEMPOTENCY_REQUIRED", "La idempotency key es obligatoria");
  }

  const from = input.fromLocationId ?? null;
  const to = input.toLocationId ?? null;
  switch (input.movementType) {
    case "RECEIPT":
      if (from !== null || to === null || input.quantity < 0) {
        throw new InventoryValidationError("INVALID_RECEIPT_SHAPE", "Una recepción solo entra a una ubicación");
      }
      break;
    case "TRANSFER":
      requireLocation(from, "La ubicación origen");
      requireLocation(to, "La ubicación destino");
      if (from === to) throw new InventoryValidationError("SAME_LOCATION", "Origen y destino deben ser distintos");
      break;
    case "CONSUMPTION":
      requireLocation(from, "La ubicación origen");
      if (to !== null || !input.projectId || !input.budgetItemId) {
        throw new InventoryValidationError(
          "CONSUMPTION_CONTEXT_REQUIRED",
          "El consumo requiere origen, proyecto y partida"
        );
      }
      break;
    case "RETURN":
      requireLocation(from, "La ubicación origen");
      requireLocation(to, "La ubicación destino");
      if (from === to) throw new InventoryValidationError("SAME_LOCATION", "Origen y destino deben ser distintos");
      break;
    case "ADJUSTMENT":
      if (input.quantity > 0) {
        if (from !== null || to === null) {
          throw new InventoryValidationError("INVALID_ADJUSTMENT_SHAPE", "Un ajuste positivo entra a una ubicación");
        }
      } else if (from === null || to !== null) {
        throw new InventoryValidationError("INVALID_ADJUSTMENT_SHAPE", "Un ajuste negativo sale de una ubicación");
      }
      break;
  }

  const requiresCost = input.movementType === "RECEIPT" || input.movementType === "ADJUSTMENT";
  if (requiresCost && (!input.costCurrency || input.unitCost == null || !Number.isFinite(input.unitCost))) {
    throw new InventoryValidationError(
      "COST_REQUIRED",
      "La recepción y el ajuste requieren costo y moneda explícitos"
    );
  }
  if (input.unitCost != null && (!Number.isFinite(input.unitCost) || input.unitCost < 0)) {
    throw new InventoryValidationError("INVALID_COST", "El costo unitario no puede ser negativo");
  }
  if (
    input.exchangeRateToCompany != null &&
    (!Number.isFinite(input.exchangeRateToCompany) || input.exchangeRateToCompany <= 0)
  ) {
    throw new InventoryValidationError("INVALID_FX", "El tipo de cambio debe ser mayor a cero");
  }
}

export function isInventoryMovementType(value: string): value is InventoryMovementType {
  return ["RECEIPT", "TRANSFER", "CONSUMPTION", "RETURN", "ADJUSTMENT"].includes(value as InventoryMovementType);
}

export function validateWarehouseSubmissionLines(lines: WarehouseSubmissionLineInput[]): void {
  if (lines.length === 0) {
    throw new InventoryValidationError("EMPTY_SUBMISSION", "La rendición no tiene líneas");
  }
  const seen = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.lineNumber) || line.lineNumber <= 0 || seen.has(line.lineNumber)) {
      throw new InventoryValidationError("INVALID_LINE_NUMBER", "Las líneas deben tener números únicos y positivos");
    }
    seen.add(line.lineNumber);
    if (line.state === "CONFIRMED") {
      if (!line.productoId || !(line.quantity && line.quantity > 0) || !line.unit || !line.budgetItemId) {
        throw new InventoryValidationError(
          "INCOMPLETE_CONFIRMED_LINE",
          `La línea ${line.lineNumber} no está completa para confirmar`
        );
      }
    }
  }
}
