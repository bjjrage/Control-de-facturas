import * as XLSX from "xlsx";
import type { EvidenceProcessingProposal, WarehouseSubmissionLineInput } from "./types";

const DESCRIPTION_HEADERS = ["descripcion", "descripción", "producto", "material", "item", "ítem", "detalle"];
const QUANTITY_HEADERS = ["cantidad", "qty", "consumo", "salida", "quantity"];
const UNIT_HEADERS = ["unidad", "unit", "u.m.", "um"];
const BUDGET_HEADERS = ["partida", "budget_item", "budget item", "codigo partida", "código partida", "rubro"];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function pick(row: Record<string, unknown>, candidates: string[]) {
  const entry = Object.entries(row).find(([key]) => candidates.includes(normalizeHeader(key)));
  return entry?.[1] ?? null;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses XLSX/CSV evidence into proposals. It intentionally does not resolve
 * product or budget ids: those are tenant-owned decisions made during review.
 */
export function parseInventorySpreadsheet(input: Uint8Array | ArrayBuffer): {
  rows: WarehouseSubmissionLineInput[];
  errors: string[];
  failed: boolean;
} {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  if (!workbook.SheetNames.length) return { rows: [], errors: ["La planilla no tiene hojas"], failed: true };
  const proposals: WarehouseSubmissionLineInput[] = [];
  const errors: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null });
    sheetRows.forEach((row, index) => {
      const sourceRowNumber = index + 2;
      const sourceRow = `Hoja ${sheetName}, fila ${sourceRowNumber}`;
      const rawDescription = String(pick(row, DESCRIPTION_HEADERS) ?? "").trim();
      const quantity = numberValue(pick(row, QUANTITY_HEADERS));
      const unit = String(pick(row, UNIT_HEADERS) ?? "").trim() || null;
      const budgetItemCode = String(pick(row, BUDGET_HEADERS) ?? "").trim() || null;
      const hasRowContent = Object.values(row).some((value) => value != null && String(value).trim() !== "");
      if (!hasRowContent) return;

      const rowErrors: string[] = [];
      if (!rawDescription) rowErrors.push(`${sourceRow}: falta descripción`);
      if (quantity == null || quantity <= 0) rowErrors.push(`${sourceRow}: cantidad inválida`);
      errors.push(...rowErrors);
      proposals.push({
        lineNumber: proposals.length + 1,
        rawDescription: rawDescription || `Fila ${sourceRowNumber}: descripción pendiente`,
        quantity: quantity != null && quantity > 0 ? quantity : null,
        unit,
        // The code is retained for the reviewer; it is not treated as a UUID.
        notes: budgetItemCode ? `Partida sugerida desde planilla: ${budgetItemCode}` : null,
        state: "PROPOSED",
        confidence: rowErrors.length ? 0.5 : 1,
        uncertaintyReason: rowErrors.length
          ? `${rowErrors.join("; ")}. Comparar con el archivo original.`
          : `Importado de ${sourceRow}; falta confirmar material y partida`,
      });
    });
  }
  return { rows: proposals, errors, failed: false };
}

export function photoEvidenceProposal(fileName: string): EvidenceProcessingProposal {
  return {
    kind: "PHOTO_OR_DOCUMENT",
    status: "PROPOSAL_ONLY",
    requiresHumanConfirmation: true,
    message: `La evidencia ${fileName} quedó almacenada. La escritura manuscrita debe revisarse manualmente; no se generaron movimientos.`,
  };
}
