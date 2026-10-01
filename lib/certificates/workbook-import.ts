import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { rawNumber, validateImportPlan } from "@/lib/workbook-interpretation/import-plan";
import type { ImportBlock, WorkbookRepresentation } from "@/lib/workbook-interpretation/types";

export type CertificateWorkbookRow = {
  sourceRow: number;
  code: string | null;
  description: string;
  unit: string | null;
  quantityContractual: number;
  quantityPrevious: number;
  quantityCurrent: number;
  quantityCumulative: number;
  unitPrice: number;
  amountPrevious: number | null;
  amountCurrent: number | null;
};

export type CertificateWorkbookData = {
  number: number;
  periodStart: string;
  periodEnd: string;
  sheet: string;
  planNeedsReview: boolean;
  warnings: string[];
  rows: CertificateWorkbookRow[];
};

export type CertificateBudgetItem = {
  id: string;
  project_id: string;
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  sort_order: number;
};

export type CertificateImportLine = CertificateWorkbookRow & {
  budgetItemId: string | null;
  sortOrder: number;
};

const normalize = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function headerText(workbook: WorkbookRepresentation, block: ImportBlock, column: string): string {
  const sheet = workbook.sheets.find((candidate) => candidate.sheetName === block.sheet);
  if (!sheet) return "";
  const columnNumber = XLSX.utils.decode_col(column.replace(/[0-9]/g, "")) + 1;
  const labels = new Set<string>();
  for (const cell of sheet.cells) {
    if (cell.row < block.headerRowStart || cell.row > block.headerRowEnd) continue;
    if (cell.column === columnNumber) labels.add(String(cell.raw ?? cell.formatted ?? ""));
  }
  for (const mergedRange of sheet.mergedCells) {
    try {
      const merged = XLSX.utils.decode_range(mergedRange);
      if (columnNumber - 1 < merged.s.c || columnNumber - 1 > merged.e.c) continue;
      if (merged.s.r + 1 < block.headerRowStart || merged.s.r + 1 > block.headerRowEnd) continue;
      const address = XLSX.utils.encode_cell(merged.s);
      const cell = sheet.cells.find((candidate) => candidate.address === address);
      if (cell) labels.add(String(cell.raw ?? cell.formatted ?? ""));
    } catch {
      // Invalid merged ranges are ignored; validateImportPlan checks the source range separately.
    }
  }
  return [...labels].join(" ");
}

function labelMatchesRole(label: string, role: string): boolean {
  const text = normalize(label);
  const patterns: Record<string, RegExp> = {
    code: /\b(codigo|cod|item)\b/,
    description: /\b(descripcion|rubro|partida|concepto)\b/,
    unit: /\b(unidad|und|unit)\b/,
    quantity: /\b(contractual|contrato|cantidad|cant|qty|metrado)\b/,
    previousQuantity: /\b(anterior|previous)\b/,
    currentQuantity: /\b(presente|actual|current)\b/,
    cumulativeQuantity: /\b(acumulad[oa]|cumulative)\b/,
    unitPrice: /\b(precio|unit price)\b|\bp\s*u\b/,
  };
  return patterns[role]?.test(text) ?? false;
}

function cellValue(workbook: WorkbookRepresentation, block: ImportBlock, row: number, column: string | undefined): unknown {
  if (!column) return null;
  const address = `${column.replace(/[0-9]/g, "")}${row}`;
  return workbook.sheets.find((sheet) => sheet.sheetName === block.sheet)?.cells.find((cell) => cell.address === address)?.raw ?? null;
}

function uniqueMapping(block: ImportBlock, role: string, required = false): string | undefined {
  const matches = block.columnMappings.filter((mapping) => mapping.role === role);
  if (matches.length > 1) throw new Error(`El plan asigna más de una columna al campo ${role}.`);
  if (required && !matches[0]) throw new Error(`No se detectó la columna obligatoria ${role} del certificado.`);
  return matches[0]?.column;
}

function workbookHeaderText(workbook: WorkbookRepresentation, sheetName: string): string {
  return workbook.sheets.find((sheet) => sheet.sheetName === sheetName)?.cells
    .filter((cell) => cell.row <= 40)
    .map((cell) => String(cell.raw ?? cell.formatted ?? ""))
    .join(" ") ?? "";
}

function parseDate(day: string, month: string, year: string): string | null {
  const fullYear = year.length === 2 ? `20${year}` : year;
  const iso = `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

function readMetadata(text: string) {
  const numberMatches = [...text.matchAll(/certificado(?:\s+(?:de\s+)?(?:ejecuci[oó]n(?:\s+de\s+obras)?|avance))?\s*(?:n(?:ro\.?|[º°]|o\.?)\s*)?(\d+)\b/gi)]
    .map((match) => Number(match[1]));
  const periodMatches = [...text.matchAll(/per[ií]odo\s*:?\s*(?:desde\s*)?(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:hasta|al|a)\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/gi)];
  const periodValues = periodMatches.map((match) => ({
    start: parseDate(match[1], match[2], match[3]),
    end: parseDate(match[4], match[5], match[6]),
  }));
  const uniqueNumbers = [...new Set(numberMatches.filter((number) => Number.isInteger(number) && number > 0))];
  const uniquePeriods = [...new Map(periodValues.filter((period) => period.start && period.end).map((period) => [`${period.start}/${period.end}`, period])).values()];
  if (uniqueNumbers.length !== 1) throw new Error("No se pudo identificar un único número de certificado en la hoja detectada.");
  if (uniquePeriods.length !== 1) throw new Error("No se pudo identificar un único período válido en la hoja detectada.");
  return { number: uniqueNumbers[0], periodStart: uniquePeriods[0].start!, periodEnd: uniquePeriods[0].end! };
}

/** Extracts a certificate-only block from the same validated workbook interpretation used by ERP imports. */
export function extractCertificateWorkbookData(workbook: WorkbookRepresentation, rawPlan: unknown): CertificateWorkbookData {
  const checked = validateImportPlan(rawPlan, workbook);
  const blocks = checked.plan.blocks.filter((block) => block.target === "CERTIFICATE");
  if (blocks.length !== 1) throw new Error(blocks.length ? "Se detectaron varios bloques de certificado; separá la planilla para evitar importar el bloque equivocado." : "No se detectó una tabla de certificado de avance en el XLSX.");
  const block = blocks[0];
  const sheet = workbook.sheets.find((candidate) => candidate.sheetName === block.sheet);
  if (!sheet) throw new Error("La hoja del certificado no existe en el archivo.");

  const columns = {
    code: uniqueMapping(block, "code"),
    description: uniqueMapping(block, "description", true),
    unit: uniqueMapping(block, "unit"),
    contractual: uniqueMapping(block, "quantity", true),
    previous: uniqueMapping(block, "previousQuantity", true),
    current: uniqueMapping(block, "currentQuantity", true),
    cumulative: uniqueMapping(block, "cumulativeQuantity"),
    unitPrice: uniqueMapping(block, "unitPrice", true),
  };
  const requiredRoles = [
    ["description", columns.description], ["quantity", columns.contractual],
    ["previousQuantity", columns.previous], ["currentQuantity", columns.current], ["unitPrice", columns.unitPrice],
  ] as const;
  for (const [role, column] of requiredRoles) {
    if (!labelMatchesRole(headerText(workbook, block, column!), role)) {
      throw new Error(`La columna ${column} no tiene un encabezado verificable para ${role}; no se importó el archivo.`);
    }
  }
  for (const [role, column] of [["code", columns.code], ["unit", columns.unit], ["cumulativeQuantity", columns.cumulative]] as const) {
    if (column && !labelMatchesRole(headerText(workbook, block, column), role)) {
      throw new Error(`La columna ${column} no tiene un encabezado verificable para ${role}; no se importó el archivo.`);
    }
  }

  const excludedRows = new Set([
    ...block.repeatedHeaderRows,
    ...block.subtotalRows,
    ...block.footerRows,
    ...block.excludedRows.map((item) => item.row),
  ]);
  const sourceRange = XLSX.utils.decode_range(block.sourceRange);
  const amountColumns = Array.from({ length: sourceRange.e.c - sourceRange.s.c + 1 }, (_, offset) => XLSX.utils.encode_col(sourceRange.s.c + offset))
    .map((column) => ({ column, label: normalize(headerText(workbook, block, column)) }));
  const previousAmountColumn = amountColumns.find(({ label }) => /\b(anterior|previous)\b/.test(label) && /\b(monto|importe|valor|amount)\b/.test(label))?.column;
  const currentAmountColumn = amountColumns.find(({ label }) => /\b(presente|actual|current)\b/.test(label) && /\b(monto|importe|valor|amount)\b/.test(label))?.column;
  const rows: CertificateWorkbookRow[] = [];
  for (let row = block.dataRowStart; row <= block.dataRowEnd; row++) {
    if (excludedRows.has(row)) continue;
    const code = String(cellValue(workbook, block, row, columns.code) ?? "").trim() || null;
    const description = String(cellValue(workbook, block, row, columns.description) ?? "").trim();
    const unit = String(cellValue(workbook, block, row, columns.unit) ?? "").trim() || null;
    const rawValues = [columns.contractual, columns.previous, columns.current, columns.unitPrice].map((column) => cellValue(workbook, block, row, column));
    if (!description && rawValues.every((value) => value === null || value === "")) continue;
    const values = rawValues.map(rawNumber);
    if (!description || values.some((value) => value === null)) {
      if (/(^|\s)(total|subtotal|monto total|iva|elaborado por|aprobado por|firma|supervisor|fiscalizacion)(\s|$)/i.test(normalize(description))) {
        continue;
      }
      throw new Error(`La fila ${row} tiene datos de partida incompletos o ambiguos. Corregí el XLSX antes de importar.`);
    }
    const [quantityContractual, quantityPrevious, quantityCurrent, unitPrice] = values as number[];
    if ([quantityContractual, quantityPrevious, quantityCurrent, unitPrice].some((value) => value < 0)) {
      throw new Error(`La fila ${row} tiene una cantidad o precio negativo; la importación se detuvo.`);
    }
    const quantityCumulative = columns.cumulative ? rawNumber(cellValue(workbook, block, row, columns.cumulative)) : quantityPrevious + quantityCurrent;
    if (quantityCumulative === null || quantityCumulative < 0) throw new Error(`No se pudo leer la cantidad acumulada de la fila ${row}.`);
    rows.push({
      sourceRow: row,
      code,
      description,
      unit,
      quantityContractual,
      quantityPrevious,
      quantityCurrent,
      quantityCumulative,
      unitPrice,
      amountPrevious: previousAmountColumn ? rawNumber(cellValue(workbook, block, row, previousAmountColumn)) : null,
      amountCurrent: currentAmountColumn ? rawNumber(cellValue(workbook, block, row, currentAmountColumn)) : null,
    });
  }
  if (!rows.length) throw new Error("El bloque de certificado no contiene partidas importables.");

  const metadata = readMetadata(workbookHeaderText(workbook, block.sheet));
  if (metadata.periodEnd < metadata.periodStart) throw new Error("El período del certificado es inválido.");
  const warnings = [...checked.warnings];
  const ignoredRows = [...excludedRows].sort((left, right) => left - right);
  if (ignoredRows.length) warnings.push(`Se excluyeron las filas ${ignoredRows.join(", ")} como encabezado, subtotal o pie de tabla; revisalas en el archivo.`);
  return {
    ...metadata,
    sheet: block.sheet,
    planNeedsReview: block.needsReview || block.confidence < 0.8 || warnings.length > 0,
    warnings: [...new Set(warnings)],
    rows,
  };
}

export function matchCertificateRows(rows: CertificateWorkbookRow[], budgetItems: CertificateBudgetItem[], projectId: string) {
  const used = new Set<string>();
  return rows.map((row) => {
    const candidates = budgetItems.filter((item) => item.project_id === projectId && !used.has(item.id)
      && Boolean(row.code)
      && normalize(item.code) === normalize(row.code)
      && normalize(item.description) === normalize(row.description)
      && normalize(item.unit) === normalize(row.unit));
    const budgetItemId = candidates.length === 1 ? candidates[0].id : null;
    if (budgetItemId) used.add(budgetItemId);
    return { ...row, budgetItemId, match: budgetItemId ? "MATCHED" as const : "NEEDS_REVIEW" as const };
  });
}

export function buildCertificateImportLines(
  rows: CertificateWorkbookRow[],
  mappings: Array<{ sourceRow: number; budgetItemId: string | null }>,
  budgetItems: CertificateBudgetItem[],
  projectId: string,
): CertificateImportLine[] {
  const rowNumbers = new Set(rows.map((row) => row.sourceRow));
  const seenRows = new Set<number>();
  const seenBudgetIds = new Set<string>();
  const budgetById = new Map(budgetItems.filter((item) => item.project_id === projectId).map((item) => [item.id, item]));

  const mappingByRow = new Map<number, string | null>();
  for (const mapping of mappings) {
    if (!rowNumbers.has(mapping.sourceRow) || seenRows.has(mapping.sourceRow)) {
      throw new Error("El mapeo del archivo contiene filas repetidas o desconocidas.");
    }
    seenRows.add(mapping.sourceRow);
    mappingByRow.set(mapping.sourceRow, mapping.budgetItemId ? mapping.budgetItemId.trim() : null);
  }

  return rows.map((row, index) => {
    const rawBudgetId = mappingByRow.get(row.sourceRow) ?? null;
    let budgetItemId: string | null = null;
    let sortOrder = index;

    if (rawBudgetId) {
      const budgetItem = budgetById.get(rawBudgetId);
      if (!budgetItem || seenBudgetIds.has(rawBudgetId)) {
        throw new Error("Cada partida debe corresponder a una partida distinta de esta obra.");
      }
      seenBudgetIds.add(rawBudgetId);
      budgetItemId = budgetItem.id;
      sortOrder = budgetItem.sort_order;
    }

    return { ...row, budgetItemId, sortOrder };
  }).sort((left, right) => left.sourceRow - right.sourceRow);
}

export function certificateWorkbookFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
