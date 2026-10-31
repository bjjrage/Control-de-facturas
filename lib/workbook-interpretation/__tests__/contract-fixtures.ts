import * as XLSX from "xlsx";
import { parseWorkbook } from "../parser";
import { buildCanonicalImportCandidate } from "../canonical-import";
import type { ImportBlock, WorkbookInterpretationResult } from "../types";

type Role = ImportBlock["columnMappings"][number]["role"];
const field = (value: string | null) => ({ status: value === null ? "NOT_FOUND" as const : "FOUND" as const, value, confidence: 1 });
export const block = (patch: Partial<ImportBlock> = {}): ImportBlock => ({ id: "budget", sheet: "Entrada", sourceRange: "A1:F2", target: "BUDGET", confidence: 1, needsReview: false, headerRowStart: 1, headerRowEnd: 1, dataRowStart: 2, dataRowEnd: 2, columnMappings: [], repeatedHeaderRows: [], subtotalRows: [], footerRows: [], excludedRows: [], notes: "", ...patch });
export function budgetFixture(options: { columns?: Role[]; top?: number; items?: (Record<string, unknown> | null)[] } = {}) {
  const roles = options.columns ?? ["code", "description", "unit", "quantity", "unitPrice", "subtotal"];
  const top = options.top ?? 0;
  const items = options.items ?? [{ code: "1", description: "Excavación", unit: "m3", quantity: 2, unitPrice: 125.5, subtotal: 251 }];
  const sheet = XLSX.utils.aoa_to_sheet([...Array.from({ length: top }, () => []), roles.map(r => "Campo " + r), ...items.map(item => roles.map(r => item?.[r] ?? null))]);
  const workbook = parseWorkbook(XLSX.write({ SheetNames: ["Entrada"], Sheets: { Entrada: sheet } }, { type: "buffer", bookType: "xlsx" }), "different-layout.xlsx");
  const result: WorkbookInterpretationResult = { documentType: "CONSTRUCTION_PROJECT", workbookSummary: { summary: "Prueba de contrato", sheetCount: 1 }, project: { name: field("Obra"), code: field("QA"), client: field(null), contractor: field(null), location: field(null), contractNumber: field(null), totalAmount: field(null), startDate: field(null), endDate: field(null) }, importPlan: { workbookType: "CONSTRUCTION_PROJECT", overallConfidence: 1, blocks: [block({ sourceRange: workbook.sheets[0].usedRange, headerRowStart: top + 1, headerRowEnd: top + 1, dataRowStart: top + 2, dataRowEnd: top + 1 + items.length, columnMappings: roles.map((role, i) => ({ role, column: XLSX.utils.encode_col(i), confidence: 1, notes: "mapeo explícito" })) })], relationships: [], unresolvedRegions: [], warnings: [] }, detectedSections: [], budgetItems: [], coverage: [], warnings: [], unknownSections: [], overallConfidence: 1 };
  return { workbook, result, candidate: () => buildCanonicalImportCandidate(workbook, result) };
}
export function certificateFixture() {
  const f = budgetFixture();
  const roles: Role[] = ["code", "description", "unit", "quantity", "unitPrice", "previousQuantity", "currentQuantity", "cumulativeQuantity", "previousAmount", "currentAmount", "cumulativeAmount"];
  const sheet = XLSX.utils.aoa_to_sheet([roles, ["1", "Excavación", "m3", 2, 125.5, 0, 1, 1, 0, 126, 126], ["Certificado", 2, "Desde", "2026-09-01", "Hasta", "2026-09-30"]]);
  const extra = parseWorkbook(XLSX.write({ SheetNames: ["Certificación"], Sheets: { Certificación: sheet } }, { type: "buffer", bookType: "xlsx" }), "certificate.xlsx").sheets[0];
  f.workbook.sheets.push({ ...extra, sheetIndex: 1 });
  f.result.importPlan.blocks.push(block({ id: "cert", sheet: extra.sheetName, target: "CERTIFICATE", sourceRange: "A1:K3", columnMappings: roles.map((role, i) => ({ role, column: XLSX.utils.encode_col(i), confidence: 1, notes: "" })), keyValues: [{ key: "certificateNumber", cell: "B3", value: 2, notes: "" }, { key: "periodStart", cell: "D3", value: "2026-09-01", notes: "" }, { key: "periodEnd", cell: "F3", value: "2026-09-30", notes: "" }] }));
  f.result.importPlan.relationships = [{ from: "budget", to: "cert", type: "SAME_ITEMS", factor: null, confidence: 1, evidence: "código, descripción y unidad coincidentes" }];
  return f;
}
