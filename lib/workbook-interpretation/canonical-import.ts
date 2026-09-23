import * as XLSX from "xlsx";
import { extractBudgetItems, rawNumber, validateImportPlan, type ImportPlanCheck } from "./import-plan";
import type {
  DetectedField,
  ImportBlock,
  ImportPlan,
  WorkbookBudgetItem,
  WorkbookInterpretationResult,
  WorkbookRepresentation,
} from "./types";

export type CanonicalCertificateItem = {
  code: string;
  description: string;
  unit: string | null;
  quantityContractual: number;
  quantityPrevious: number;
  quantityCurrent: number;
  quantityCumulative: number;
  unitPrice: number;
  amountPrevious: number | null;
  amountCurrent: number | null;
  amountCumulative: number | null;
  percentage: number | null;
  source: { sheet: string; row: number; range: string };
};

export type CanonicalMeasurementAudit = {
  status: "NOT_DETECTED" | "DETECTED_NOT_APPLIED";
  blockCount: number;
  detailRows: number;
  matchingItems: number;
  reason: string;
  identity: Record<string, string>;
  canonicalIdentity: Record<string, string>;
};

export type CanonicalCertificateAudit = {
  status: "NOT_DETECTED" | "SAFE_TO_APPLY" | "DETECTED_NOT_APPLIED";
  itemCount: number;
  matchedBudgetItems: number;
  number: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  reason: string;
  items: CanonicalCertificateItem[];
};

export type CanonicalImportCandidate = {
  budgetItems: WorkbookBudgetItem[];
  budgetBlockingRows: Array<{ sheet: string; row: number; reason: string }>;
  budgetQuantitySource: "BUDGET" | "CERTIFICATE_CONTRACT_QUANTITY";
  budgetTotal: number;
  certificate: CanonicalCertificateAudit;
  measurement: CanonicalMeasurementAudit;
  warnings: string[];
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldText(field: DetectedField): string | null {
  if (field.status === "NOT_FOUND" || field.value === null) return null;
  const value = String(field.value).trim();
  return value || null;
}

function columnName(column: string): string {
  return column.replace(/[0-9]/g, "").toUpperCase();
}

function valueAt(sheet: WorkbookRepresentation["sheets"][number], row: number, column: string): unknown {
  return sheet.cells.find((cell) => cell.row === row && cell.column === XLSX.utils.decode_col(columnName(column)) + 1)?.raw ?? null;
}

function mappingColumn(block: ImportBlock, roles: string[]): string | null {
  return block.columnMappings.find((mapping) => roles.includes(mapping.role))?.column ?? null;
}

function excludedRows(block: ImportBlock): Set<number> {
  return new Set([
    ...block.repeatedHeaderRows,
    ...block.subtotalRows,
    ...block.footerRows,
    ...block.excludedRows.map((row) => row.row),
  ]);
}

function certificateBlocks(plan: ImportPlan): ImportBlock[] {
  return plan.blocks.filter((block) => block.target === "CERTIFICATE" && !block.needsReview);
}

function readCertificateBlock(
  workbook: WorkbookRepresentation,
  block: ImportBlock
): CanonicalCertificateItem[] {
  const sheet = workbook.sheets.find((candidate) => candidate.sheetName === block.sheet);
  if (!sheet) return [];
  const codeColumn = mappingColumn(block, ["code"]);
  const descriptionColumn = mappingColumn(block, ["description"]);
  const unitColumn = mappingColumn(block, ["unit"]);
  const contractualColumn = mappingColumn(block, ["quantity"]);
  const previousColumn = mappingColumn(block, ["previousQuantity"]);
  const currentColumn = mappingColumn(block, ["currentQuantity"]);
  const cumulativeColumn = mappingColumn(block, ["cumulativeQuantity"]);
  const unitPriceColumn = mappingColumn(block, ["unitPrice"]);
  if (!codeColumn || !descriptionColumn || !contractualColumn || !previousColumn || !currentColumn || !cumulativeColumn || !unitPriceColumn) return [];

  const excluded = excludedRows(block);
  const result: CanonicalCertificateItem[] = [];
  for (let row = block.dataRowStart; row <= block.dataRowEnd; row++) {
    if (excluded.has(row)) continue;
    const code = String(valueAt(sheet, row, codeColumn) ?? "").trim();
    const description = String(valueAt(sheet, row, descriptionColumn) ?? "").trim();
    const contractual = rawNumber(valueAt(sheet, row, contractualColumn));
    if (!code || !description || contractual === null) continue;
    const previous = rawNumber(valueAt(sheet, row, previousColumn));
    const current = rawNumber(valueAt(sheet, row, currentColumn));
    const cumulative = rawNumber(valueAt(sheet, row, cumulativeColumn));
    const unitPrice = rawNumber(valueAt(sheet, row, unitPriceColumn));
    if (previous === null || current === null || cumulative === null || unitPrice === null) continue;
    const amountPreviousColumn = mappingColumn(block, ["subtotal"]);
    const amountCurrentColumn = block.columnMappings.find((mapping) => mapping.column === "J" && mapping.role === "value")?.column ?? null;
    const amountCumulativeColumn = block.columnMappings.find((mapping) => mapping.column === "K" && mapping.role === "value")?.column ?? null;
    const percentageColumn = mappingColumn(block, ["percentage"]);
    result.push({
      code,
      description,
      unit: unitColumn ? String(valueAt(sheet, row, unitColumn) ?? "").trim() || null : null,
      quantityContractual: contractual,
      quantityPrevious: previous,
      quantityCurrent: current,
      quantityCumulative: cumulative,
      unitPrice,
      amountPrevious: amountPreviousColumn ? rawNumber(valueAt(sheet, row, amountPreviousColumn)) : null,
      amountCurrent: amountCurrentColumn ? rawNumber(valueAt(sheet, row, amountCurrentColumn)) : null,
      amountCumulative: amountCumulativeColumn ? rawNumber(valueAt(sheet, row, amountCumulativeColumn)) : null,
      percentage: percentageColumn ? rawNumber(valueAt(sheet, row, percentageColumn)) : null,
      source: { sheet: block.sheet, row, range: block.sourceRange },
    });
  }
  return result;
}

export function extractCertificateItems(
  workbook: WorkbookRepresentation,
  plan: ImportPlan
): CanonicalCertificateItem[] {
  return certificateBlocks(plan).flatMap((block) => readCertificateBlock(workbook, block));
}

function firstRowsText(sheet: WorkbookRepresentation["sheets"][number], maxRow = 25): string {
  return sheet.cells
    .filter((cell) => cell.row <= maxRow && (typeof cell.raw === "string" || typeof cell.raw === "number"))
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((cell) => String(cell.raw))
    .join(" ");
}

function identityFromText(text: string): Record<string, string> {
  const identity: Record<string, string> = {};
  const patterns: Array<[string, RegExp]> = [
    ["package", /paquete\s+0*(\d+)/i],
    ["id", /\bid\s+0*(\d+)/i],
    ["sipp", /sipp\s+0*(\d+)/i],
    ["housingCount", /cantidad\s+de\s+viviendas\s*(?::\s*)?(\d+)/i],
  ];
  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) identity[key] = match[1];
  }
  return identity;
}

function targetSheets(workbook: WorkbookRepresentation, plan: ImportPlan, target: string) {
  return [...new Set(plan.blocks.filter((block) => block.target === target).map((block) => block.sheet))]
    .map((name) => workbook.sheets.find((sheet) => sheet.sheetName === name))
    .filter((sheet): sheet is WorkbookRepresentation["sheets"][number] => Boolean(sheet));
}

function extractPeriodAndNumber(workbook: WorkbookRepresentation, sheets: WorkbookRepresentation["sheets"]): { periodStart: string | null; periodEnd: string | null; number: number | null } {
  const text = sheets.map((sheet) => firstRowsText(sheet, 35)).join(" ");
  const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizeDate = (day: string, month: string, year: string) => {
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };
  const normalizedPeriod = normalizedText.match(/periodo\s*:\s*desde\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\s*hasta\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/i);
  const normalizedCertificate = normalizedText.match(/certificado(?:\s+de\s+ejecucion\s+de\s+obras)?\s*n\s*[\u00b0\u00bao]?\s*(\d+)/i);
  return {
    periodStart: normalizedPeriod ? normalizeDate(normalizedPeriod[1], normalizedPeriod[2], normalizedPeriod[3]) : null,
    periodEnd: normalizedPeriod ? normalizeDate(normalizedPeriod[4], normalizedPeriod[5], normalizedPeriod[6]) : null,
    number: normalizedCertificate ? Number(normalizedCertificate[1]) : null,
  };
}

function measurementEvidence(workbook: WorkbookRepresentation, plan: ImportPlan, budgetSheets: WorkbookRepresentation["sheets"], certificateSheets: WorkbookRepresentation["sheets"], certificateItems: CanonicalCertificateItem[]): CanonicalMeasurementAudit {
  const sheets = targetSheets(workbook, plan, "MEASUREMENT");
  if (!sheets.length) {
    return { status: "NOT_DETECTED", blockCount: 0, detailRows: 0, matchingItems: 0, reason: "No se detect\u00f3 un bloque de medici\u00f3n.", identity: {}, canonicalIdentity: {} };
  }
  const canonicalIdentity = identityFromText([...budgetSheets, ...certificateSheets].map((sheet) => firstRowsText(sheet)).join(" "));
  const identity = identityFromText(sheets.map((sheet) => firstRowsText(sheet)).join(" "));
  const identityMismatch = Object.entries(canonicalIdentity).some(([key, value]) => identity[key] && identity[key] !== value);
  const detailRows = sheets.reduce((count, sheet) => count + sheet.cells.filter((cell) => cell.column === 1 && /^V\d+\s+M\d+\s+L\d+/i.test(String(cell.raw ?? ""))).length, 0);
  const blockCount = sheets.reduce((count, sheet) => count + sheet.cells.filter((cell) => cell.column === 1 && /^\d+\.\d+$/.test(String(cell.raw ?? ""))).length, 0);
  const certificateDescriptions = new Set(certificateItems.map((item) => normalized(item.description)));
  const matchingItems = sheets.reduce((count, sheet) => count + sheet.cells.filter((cell) => cell.column === 2 && certificateDescriptions.has(normalized(cell.raw))).length, 0);
  const reason = identityMismatch
    ? "La medici\u00f3n detectada pertenece a una identidad de obra distinta del presupuesto/certificado; no se aplica a execution_entries ni al certificado."
    : matchingItems === 0
      ? "La medici\u00f3n fue detectada, pero no existe una correspondencia inequ\u00edvoca con las partidas can\u00f3nicas."
      : "La medici\u00f3n contiene cantidades por bloque y no se convierte autom\u00e1ticamente en hechos fechados de ejecuci\u00f3n.";
  return { status: "DETECTED_NOT_APPLIED", blockCount, detailRows, matchingItems, reason, identity, canonicalIdentity };
}

function sameItem(left: WorkbookBudgetItem, right: CanonicalCertificateItem): boolean {
  return Boolean(left.code && right.code && normalized(left.code) === normalized(right.code))
    && normalized(left.description) === normalized(right.description)
    && normalized(left.unit) === normalized(right.unit);
}

export function buildCanonicalImportCandidate(
  workbook: WorkbookRepresentation,
  result: WorkbookInterpretationResult,
  checked?: ImportPlanCheck
): CanonicalImportCandidate {
  const planCheck = checked ?? validateImportPlan(result.importPlan, workbook);
  const extracted = extractBudgetItems(workbook, planCheck.plan, planCheck.coverage);
  const budgetLines = extracted.items.filter((item) => {
    const code = normalized(item.code);
    const description = normalized(item.description);
    return !["item", "total", "subtotal", "total general"].includes(code)
      && !["item", "total", "subtotal", "total general"].includes(description);
  });
  const certificateItems = extractCertificateItems(workbook, planCheck.plan);
  const budgetSheets = targetSheets(workbook, planCheck.plan, "BUDGET");
  const certificateSheets = targetSheets(workbook, planCheck.plan, "CERTIFICATE");
  const matched = budgetLines.filter((budgetItem) => certificateItems.some((certificateItem) => sameItem(budgetItem, certificateItem)));
  const fullJoin = budgetLines.length > 0 && matched.length === budgetLines.length && matched.length === certificateItems.length;
  const canonicalBudgetItems = fullJoin
    ? budgetLines.map((budgetItem) => {
        const certificateItem = certificateItems.find((candidate) => sameItem(budgetItem, candidate));
        return certificateItem ? { ...budgetItem, quantity: certificateItem.quantityContractual, unitPrice: certificateItem.unitPrice } : budgetItem;
      })
    : budgetLines;
  const certificateMetadata = extractPeriodAndNumber(workbook, certificateSheets);
  const certificateReason = !certificateItems.length
    ? "No se extrajeron l\u00edneas de certificado con mapping verificable."
    : !fullJoin
      ? `El certificado tiene ${certificateItems.length} l\u00edneas y s\u00f3lo ${matched.length} coinciden de forma exacta con el presupuesto; no se aplica.`
      : !certificateMetadata.periodStart || !certificateMetadata.periodEnd || certificateMetadata.number === null
        ? "Las l\u00edneas coinciden, pero faltan n\u00famero o per\u00edodo verificable para crear el certificado can\u00f3nico."
        : "Las l\u00edneas coinciden por c\u00f3digo, descripci\u00f3n y unidad; los acumulados e importes se recalcular\u00e1n en el modelo can\u00f3nico.";
  const certificateStatus = !certificateItems.length ? "NOT_DETECTED" : fullJoin && certificateMetadata.periodStart && certificateMetadata.periodEnd && certificateMetadata.number !== null ? "SAFE_TO_APPLY" : "DETECTED_NOT_APPLIED";
  const certificate: CanonicalCertificateAudit = {
    status: certificateStatus,
    itemCount: certificateItems.length,
    matchedBudgetItems: matched.length,
    number: certificateMetadata.number,
    periodStart: certificateMetadata.periodStart,
    periodEnd: certificateMetadata.periodEnd,
    reason: certificateReason,
    items: certificateItems,
  };
  const measurement = measurementEvidence(workbook, planCheck.plan, budgetSheets, certificateSheets, certificateItems);
  const budgetTotal = canonicalBudgetItems.reduce((sum, item) => sum + (item.quantity ?? 0) * (item.unitPrice ?? 0), 0);
  return {
    budgetItems: canonicalBudgetItems,
    budgetBlockingRows: extracted.blockingRows,
    budgetQuantitySource: fullJoin ? "CERTIFICATE_CONTRACT_QUANTITY" : "BUDGET",
    budgetTotal,
    certificate,
    measurement,
    warnings: [
      ...extracted.warnings,
      ...(budgetLines.length !== extracted.items.length ? ["Se excluyeron filas de total/subtotal del presupuesto; no son partidas can\u00f3nicas."] : []),
      ...planCheck.warnings,
      ...(measurement.status === "DETECTED_NOT_APPLIED" ? [measurement.reason] : []),
      ...(certificate.status === "DETECTED_NOT_APPLIED" ? [certificate.reason] : []),
    ],
  };
}

export function safeProjectField(result: WorkbookInterpretationResult, key: keyof WorkbookInterpretationResult["project"]): string | null {
  return fieldText(result.project[key]);
}
