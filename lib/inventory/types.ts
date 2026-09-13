export const INVENTORY_MOVEMENT_TYPES = [
  "RECEIPT",
  "TRANSFER",
  "CONSUMPTION",
  "RETURN",
  "ADJUSTMENT",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
export type InventoryLocationType = "CENTRAL" | "PROJECT" | "AUXILIARY";
export type InventoryMovementStatus = "DRAFT" | "CONFIRMED" | "VOIDED";
export type WarehouseSubmissionStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "NEEDS_REVIEW"
  | "READY"
  | "CONFIRMED"
  | "VOIDED";
export type WarehouseSubmissionLineState = "PROPOSED" | "CONFIRMED" | "REJECTED";

export interface InventoryLocationRef {
  id: string;
  empresaId: string;
  type: InventoryLocationType;
  projectId: string | null;
  active?: boolean;
}

export interface InventoryProductRef {
  id: string;
  empresaId: string;
  unit: string;
}

export interface InventoryBudgetItemRef {
  id: string;
  empresaId: string;
  projectId: string;
}

export interface InventoryMovementInput {
  empresaId: string;
  productoId: string;
  quantity: number;
  unit: string;
  movementType: InventoryMovementType;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  projectId?: string | null;
  budgetItemId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  sourceLineId?: string | null;
  idempotencyKey: string;
  costCurrency?: string | null;
  unitCost?: number | null;
  exchangeRateToCompany?: number | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}

export interface InventoryCostLine {
  quantity: number;
  costCurrency: string;
  unitCost: number;
  totalCost: number;
}

export interface InventoryMovementResult {
  id: string;
  empresaId: string;
  productoId: string;
  quantity: number;
  movementType: InventoryMovementType;
  fromLocationId: string | null;
  toLocationId: string | null;
  projectId: string | null;
  budgetItemId: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceLineId: string | null;
  idempotencyKey: string;
  costLines: InventoryCostLine[];
  costTotal: number;
}

export interface InventoryBalance {
  empresaId: string;
  productoId: string;
  locationId: string;
  costCurrency: string;
  quantity: number;
  totalCost: number;
}

export interface WarehouseSubmissionLineInput {
  lineNumber: number;
  rawDescription: string;
  productoId?: string | null;
  quantity?: number | null;
  unit?: string | null;
  budgetItemId?: string | null;
  state?: WarehouseSubmissionLineState;
  confidence?: number | null;
  uncertaintyReason?: string | null;
  sourceEvidenceId?: string | null;
  notes?: string | null;
}

export interface EvidenceProcessingProposal {
  kind: "PHOTO_OR_DOCUMENT" | "SPREADSHEET";
  status: "PROPOSAL_ONLY";
  requiresHumanConfirmation: true;
  message: string;
  rows?: WarehouseSubmissionLineInput[];
}
