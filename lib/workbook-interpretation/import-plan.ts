import * as XLSX from "xlsx";
import { isRangeWithinSheet } from "./parser";
import {
  ImportPlanSchema,
  type ImportBlock,
  type ImportBlockCoverage,
  type ImportPlan,
  type WorkbookBudgetItem,
  type WorkbookRepresentation,
} from "./types";

export type ImportPlanCheck = { plan: ImportPlan; warnings: string[]; coverage: ImportBlockCoverage[] };

function rowHasData(workbook: WorkbookRepresentation, sheetName: string, row: number, startColumn: number, endColumn: number) {
  const sheet = workbook.sheets.find((item) => item.sheetName === sheetName);
  return Boolean(sheet?.cells.some((cell) => cell.row === row && cell.column >= startColumn && cell.column <= endColumn && (cell.raw !== null || cell.formatted || cell.formula)));
}

function rowsWithData(workbook: WorkbookRepresentation, block: ImportBlock) {
  const range = XLSX.utils.decode_range(block.sourceRange);
  const rows: number[] = [];
  for (let row = block.dataRowStart; row <= block.dataRowEnd; row++) {
    if (rowHasData(workbook, block.sheet, row, range.s.c + 1, range.e.c + 1)) rows.push(row);
  }
  return rows;
}

function normalizedLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

function sheetCellValue(sheet: WorkbookRepresentation["sheets"][number], row: number, column: number): unknown {
  return sheet.cells.find((cell) => cell.row === row && cell.column === column)?.raw ?? null;
}

function isItemCode(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /^\d+(?:[./-]\d+)*$/.test(text) || /^[A-Z]?[0-9][A-Z0-9._/-]*$/i.test(text);
}

type CertificateEvidence = {
  sheet: WorkbookRepresentation["sheets"][number];
  headerRowStart: number;
  headerRowEnd: number;
  dataRowStart: number;
  dataRowEnd: number;
  columnMappings: ImportBlock["columnMappings"];
  sourceRange: string;
  score: number;
};

type BudgetEvidence = {
  sheet: WorkbookRepresentation["sheets"][number];
  headerRowStart: number;
  headerRowEnd: number;
  dataRowStart: number;
  dataRowEnd: number;
  columnMappings: ImportBlock["columnMappings"];
  sourceRange: string;
  score: number;
};

const BUDGET_HEADER_PATTERNS: Record<string, RegExp[]> = {
  code: [/\bitem\b/, /\bcodigo\b/, /\bcod\b/, /\bpartida\b/],
  description: [/\brubro\b/, /\bdescripcion\b/, /\bconcepto\b/, /\bdetalle\b/, /\btrabajo\b/],
  unit: [/\bunidad\b/, /\bund\b/, /unidad de medida/],
  quantity: [/\bcantidad\b/, /\bprevista\b/, /\bcontratada\b/],
  unitPrice: [/precio unitario/, /\bp u\b/, /unit price/],
};

const REQUIRED_BUDGET_ROLES = ["code", "description", "unit", "quantity", "unitPrice"] as const;

function budgetHeaderRole(value: unknown, role: string): boolean {
  const text = normalizedLabel(value);
  return text.length > 0 && (BUDGET_HEADER_PATTERNS[role] ?? []).some((pattern) => pattern.test(text));
}

function detectBudgetEvidence(sheet: WorkbookRepresentation["sheets"][number]): BudgetEvidence | null {
  let best: BudgetEvidence | null = null;
  const rolesByRow = new Map<number, Set<string>>();
  for (const cell of sheet.cells) {
    for (const role of REQUIRED_BUDGET_ROLES) {
      if (!budgetHeaderRole(cell.raw, role)) continue;
      const roles = rolesByRow.get(cell.row) ?? new Set<string>();
      roles.add(role);
      rolesByRow.set(cell.row, roles);
    }
  }
  const candidateStarts = new Set<number>();
  for (const [row, roles] of rolesByRow) {
    if (roles.size < 3) continue;
    for (let offset = 0; offset <= 2; offset++) {
      const start = row - offset;
      if (start >= 1 && start <= sheet.rowCount - 1) candidateStarts.add(start);
    }
  }
  for (const headerRowStart of [...candidateStarts].sort((left, right) => left - right)) {
    for (let headerRowEnd = headerRowStart; headerRowEnd <= Math.min(sheet.rowCount, headerRowStart + 2); headerRowEnd++) {
      const mappings = new Map<string, ImportBlock["columnMappings"][number]>();
      for (let column = 1; column <= sheet.columnCount; column++) {
        const values = [];
        for (let row = headerRowStart; row <= headerRowEnd; row++) values.push(sheetCellValue(sheet, row, column));
        for (const role of REQUIRED_BUDGET_ROLES) {
          if (!mappings.has(role) && values.some((value) => budgetHeaderRole(value, role))) {
            mappings.set(role, { column: XLSX.utils.encode_col(column - 1), role, confidence: 0.96, notes: "mapeo recuperado por evidencia estructural local" });
          }
        }
      }
      if (REQUIRED_BUDGET_ROLES.some((role) => !mappings.has(role))) continue;
      const dataRowStart = headerRowEnd + 1;
      const dataRows: number[] = [];
      const codeColumn = mappings.get("code")!.column;
      const descriptionColumn = mappings.get("description")!.column;
      const quantityColumn = mappings.get("quantity")!.column;
      const unitPriceColumn = mappings.get("unitPrice")!.column;
      for (let row = dataRowStart; row <= sheet.rowCount; row++) {
        const code = sheetCellValue(sheet, row, XLSX.utils.decode_col(codeColumn.replace(/[0-9]/g, "")) + 1);
        const description = String(sheetCellValue(sheet, row, XLSX.utils.decode_col(descriptionColumn.replace(/[0-9]/g, "")) + 1) ?? "").trim();
        const hasFinancialSignal = rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(quantityColumn.replace(/[0-9]/g, "")) + 1)) !== null
          && rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(unitPriceColumn.replace(/[0-9]/g, "")) + 1)) !== null;
        if (isItemCode(code) && description && hasFinancialSignal) {
          dataRows.push(row);
          continue;
        }
        if (dataRows.length) break;
      }
      if (!dataRows.length) continue;
      const columns = [...mappings.values()].map((mapping) => XLSX.utils.decode_col(mapping.column.replace(/[0-9]/g, "")) + 1);
      const sourceRange = XLSX.utils.encode_range({
        s: { r: headerRowStart - 1, c: Math.min(...columns) - 1 },
        e: { r: Math.max(...dataRows) - 1, c: Math.max(...columns) - 1 },
      });
      const candidate: BudgetEvidence = {
        sheet,
        headerRowStart,
        headerRowEnd,
        dataRowStart,
        dataRowEnd: Math.max(...dataRows),
        columnMappings: [...mappings.values()],
        sourceRange,
        score: REQUIRED_BUDGET_ROLES.length * 10 + dataRows.length,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  return best;
}

function budgetBlockIsUsable(block: ImportBlock, evidence: BudgetEvidence): boolean {
  return block.target === "BUDGET"
    && !block.needsReview
    && block.sheet === evidence.sheet.sheetName
    && overlapping(block.sourceRange, evidence.sourceRange)
    && REQUIRED_BUDGET_ROLES.every((role) => block.columnMappings.some((mapping) => mapping.role === role));
}

const CERTIFICATE_HEADER_PATTERNS: Record<string, RegExp[]> = {
  code: [/\bitem\b/, /\bcodigo\b/, /\bcod\b/, /\bpartida\b/],
  description: [/\brubro\b/, /\bdescripcion\b/, /\bconcepto\b/, /\bdetalle\b/, /\btrabajo\b/],
  unit: [/\bunidad\b/, /\bund\b/, /unidad de medida/],
  quantity: [/\bcantidad\b/, /\bcontractual\b/, /\bcontratada\b/],
  previousQuantity: [/\banterior\b/, /\bprevia?\b/],
  currentQuantity: [/\bpresente\b/, /\bactual\b/],
  cumulativeQuantity: [/\bacumulad[oa]\b/],
  unitPrice: [/precio unitario/, /\bp u\b/, /unit price/],
  percentage: [/porcentaje/, /incidencia/, /avance/, /auxiliar/, /%/],
};

const REQUIRED_CERTIFICATE_ROLES = [
  "code",
  "description",
  "unit",
  "quantity",
  "previousQuantity",
  "currentQuantity",
  "cumulativeQuantity",
  "unitPrice",
] as const;

function matchesHeaderRole(value: unknown, role: string): boolean {
  const text = normalizedLabel(value);
  return text.length > 0 && (CERTIFICATE_HEADER_PATTERNS[role] ?? []).some((pattern) => pattern.test(text));
}

function certificateDataRow(sheet: WorkbookRepresentation["sheets"][number], row: number, mappings: Map<string, ImportBlock["columnMappings"][number]>): boolean {
  const code = mappings.get("code");
  const description = mappings.get("description");
  const quantity = mappings.get("quantity");
  const previous = mappings.get("previousQuantity");
  const current = mappings.get("currentQuantity");
  const cumulative = mappings.get("cumulativeQuantity");
  const unitPrice = mappings.get("unitPrice");
  if (!code || !description || !quantity || !previous || !current || !cumulative || !unitPrice) return false;
  return isItemCode(sheetCellValue(sheet, row, XLSX.utils.decode_col(code.column.replace(/[0-9]/g, "")) + 1))
    && String(sheetCellValue(sheet, row, XLSX.utils.decode_col(description.column.replace(/[0-9]/g, "")) + 1) ?? "").trim().length > 0
    && rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(quantity.column.replace(/[0-9]/g, "")) + 1)) !== null
    && rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(previous.column.replace(/[0-9]/g, "")) + 1)) !== null
    && rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(current.column.replace(/[0-9]/g, "")) + 1)) !== null
    && rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(cumulative.column.replace(/[0-9]/g, "")) + 1)) !== null
    && rawNumber(sheetCellValue(sheet, row, XLSX.utils.decode_col(unitPrice.column.replace(/[0-9]/g, "")) + 1)) !== null;
}

function detectCertificateEvidence(sheet: WorkbookRepresentation["sheets"][number]): CertificateEvidence | null {
  let best: CertificateEvidence | null = null;
  const rolesByRow = new Map<number, Set<string>>();
  for (const cell of sheet.cells) {
    for (const role of Object.keys(CERTIFICATE_HEADER_PATTERNS)) {
      if (!matchesHeaderRole(cell.raw, role)) continue;
      const roles = rolesByRow.get(cell.row) ?? new Set<string>();
      roles.add(role);
      rolesByRow.set(cell.row, roles);
    }
  }
  const candidateStarts = new Set<number>();
  for (const [row, roles] of rolesByRow) {
    if (roles.size < 2) continue;
    for (let offset = 0; offset <= 2; offset++) {
      const start = row - offset;
      if (start >= 1 && start <= sheet.rowCount - 2) candidateStarts.add(start);
    }
  }
  for (const headerStart of [...candidateStarts].sort((left, right) => left - right)) {
    for (let headerEnd = headerStart; headerEnd <= Math.min(sheet.rowCount, headerStart + 2); headerEnd++) {
      const mappings = new Map<string, ImportBlock["columnMappings"][number]>();
      for (let column = 1; column <= sheet.columnCount; column++) {
        const texts = [];
        for (let row = headerStart; row <= headerEnd; row++) texts.push(sheetCellValue(sheet, row, column));
        for (const role of REQUIRED_CERTIFICATE_ROLES) {
          if (!mappings.has(role) && texts.some((value) => matchesHeaderRole(value, role))) {
            mappings.set(role, { column: XLSX.utils.encode_col(column - 1), role, confidence: 0.96, notes: "mapeo recuperado por evidencia estructural local" });
          }
        }
        if (!mappings.has("percentage") && texts.some((value) => matchesHeaderRole(value, "percentage"))) {
          mappings.set("percentage", { column: XLSX.utils.encode_col(column - 1), role: "percentage", confidence: 0.9, notes: "mapeo auxiliar recuperado por evidencia estructural local" });
        }
      }
      if (REQUIRED_CERTIFICATE_ROLES.some((role) => !mappings.has(role))) continue;
      const dataRowStart = headerEnd + 1;
      const dataRows: number[] = [];
      for (let row = dataRowStart; row <= sheet.rowCount; row++) {
        if (certificateDataRow(sheet, row, mappings)) {
          dataRows.push(row);
          continue;
        }
        if (dataRows.length) break;
      }
      if (dataRows.length < 1) continue;
      const columns = [...mappings.values()].map((mapping) => XLSX.utils.decode_col(mapping.column.replace(/[0-9]/g, "")) + 1);
      const sourceRange = XLSX.utils.encode_range({
        s: { r: headerStart - 1, c: Math.min(...columns) - 1 },
        e: { r: Math.max(...dataRows) - 1, c: Math.max(...columns) - 1 },
      });
      const candidate: CertificateEvidence = {
        sheet,
        headerRowStart: headerStart,
        headerRowEnd: headerEnd,
        dataRowStart,
        dataRowEnd: Math.max(...dataRows),
        columnMappings: [...mappings.values()],
        sourceRange,
        score: REQUIRED_CERTIFICATE_ROLES.length * 10 + dataRows.length,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  return best;
}

function certificateBlockIsUsable(block: ImportBlock, evidence: CertificateEvidence): boolean {
  return block.target === "CERTIFICATE"
    && !block.needsReview
    && block.sheet === evidence.sheet.sheetName
    && overlapping(block.sourceRange, evidence.sourceRange)
    && REQUIRED_CERTIFICATE_ROLES.every((role) => block.columnMappings.some((mapping) => mapping.role === role));
}

function reconcileCertificateEvidence(workbook: WorkbookRepresentation, plan: ImportPlan): { plan: ImportPlan; warnings: string[] } {
  const blocks = [...plan.blocks];
  const warnings: string[] = [];
  for (const sheet of workbook.sheets) {
    const evidence = detectCertificateEvidence(sheet);
    if (!evidence) continue;
    if (blocks.some((block) => certificateBlockIsUsable(block, evidence))) continue;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.target === "CERTIFICATE" && block.sheet === sheet.sheetName && overlapping(block.sourceRange, evidence.sourceRange)) {
        blocks[index] = { ...block, needsReview: true, notes: `${block.notes} El mapeo original fue reemplazado por una recuperaci\u00f3n estructural verificable.` };
      }
    }
    const slug = sheet.sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sheet";
    blocks.push({
      id: `repaired-certificate-${slug}-${evidence.headerRowStart}`,
      sheet: sheet.sheetName,
      sourceRange: evidence.sourceRange,
      target: "CERTIFICATE",
      confidence: 0.96,
      needsReview: false,
      headerRowStart: evidence.headerRowStart,
      headerRowEnd: evidence.headerRowEnd,
      dataRowStart: evidence.dataRowStart,
      dataRowEnd: evidence.dataRowEnd,
      columnMappings: evidence.columnMappings,
      repeatedHeaderRows: [],
      subtotalRows: [],
      footerRows: [],
      excludedRows: [],
      notes: "Bloque recuperado localmente por evidencia estructural fuerte de certificado.",
    });
    warnings.push(`Se recuper\u00f3 un bloque CERTIFICATE en ${sheet.sheetName} (${evidence.sourceRange}) porque la estructura contiene contractual/anterior/presente/acumulado y precio unitario.`);
  }
  return { plan: { ...plan, blocks }, warnings };
}

function reconcileBudgetEvidence(workbook: WorkbookRepresentation, plan: ImportPlan): { plan: ImportPlan; warnings: string[] } {
  const blocks = [...plan.blocks];
  const warnings: string[] = [];
  for (const sheet of workbook.sheets) {
    if (detectCertificateEvidence(sheet)) continue;
    const evidence = detectBudgetEvidence(sheet);
    if (!evidence) continue;
    if (blocks.some((block) => budgetBlockIsUsable(block, evidence))) continue;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.target === "BUDGET" && block.sheet === sheet.sheetName && overlapping(block.sourceRange, evidence.sourceRange)) {
        blocks[index] = { ...block, needsReview: true, notes: `${block.notes} El mapeo original fue reemplazado por una recuperacion estructural verificable.` };
      }
    }
    const slug = sheet.sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sheet";
    blocks.push({
      id: `repaired-budget-${slug}-${evidence.headerRowStart}`,
      sheet: sheet.sheetName,
      sourceRange: evidence.sourceRange,
      target: "BUDGET",
      confidence: 0.96,
      needsReview: false,
      headerRowStart: evidence.headerRowStart,
      headerRowEnd: evidence.headerRowEnd,
      dataRowStart: evidence.dataRowStart,
      dataRowEnd: evidence.dataRowEnd,
      columnMappings: evidence.columnMappings,
      repeatedHeaderRows: [],
      subtotalRows: [],
      footerRows: [],
      excludedRows: [],
      notes: "Bloque recuperado localmente por evidencia estructural fuerte de presupuesto.",
    });
    warnings.push(`Se recupero un bloque BUDGET en ${sheet.sheetName} (${evidence.sourceRange}) porque la estructura contiene codigo, descripcion, unidad, cantidad y precio unitario.`);
  }
  return { plan: { ...plan, blocks }, warnings };
}

function overlapping(a: string, b: string) {
  try {
    const left = XLSX.utils.decode_range(a);
    const right = XLSX.utils.decode_range(b);
    return left.s.r <= right.e.r && right.s.r <= left.e.r && left.s.c <= right.e.c && right.s.c <= left.e.c;
  } catch {
    return false;
  }
}

function coverageForBlock(workbook: WorkbookRepresentation, block: ImportBlock): ImportBlockCoverage {
  const range = XLSX.utils.decode_range(block.sourceRange);
  const excludedRows = new Map<number, string>(block.excludedRows.map((item) => [item.row, item.reason]));
  for (const row of block.repeatedHeaderRows) excludedRows.set(row, "header repetido");
  for (const row of block.subtotalRows) excludedRows.set(row, "subtotal/total");
  for (const row of block.footerRows) excludedRows.set(row, "pie de tabla");
  const sourceRows = rowsWithData(workbook, block);
  const adjacentRows = new Set<number>();
  const sheet = workbook.sheets.find((item) => item.sheetName === block.sheet);
  if (sheet && sourceRows.length) {
    const cellsByRow = new Map<number, typeof sheet.cells>();
    for (const cell of sheet.cells) cellsByRow.set(cell.row, [...(cellsByRow.get(cell.row) ?? []), cell]);
    const firstSourceRow = sourceRows[0];
    const lastSourceRow = sourceRows[sourceRows.length - 1];
    const candidates = new Set(cellsByRow.keys());
    for (const candidate of candidates) {
      if (candidate >= range.s.r + 1 && candidate <= range.e.r + 1) continue;
      const distanceToData = candidate < firstSourceRow ? firstSourceRow - candidate : candidate - lastSourceRow;
      const hasTwoCells = (cellsByRow.get(candidate) ?? []).filter((cell) => cell.column - 1 >= range.s.c && cell.column - 1 <= range.e.c && (cell.raw !== null || cell.formatted || cell.formula)).length >= 2;
      if (hasTwoCells && distanceToData <= 1) adjacentRows.add(candidate);
    }
    const inRangeCandidates = new Set(sheet.cells.filter((cell) => cell.column - 1 >= range.s.c && cell.column - 1 <= range.e.c && (cell.raw !== null || cell.formatted || cell.formula)).map((cell) => cell.row));
    for (const boundary of [range.s.r, range.e.r + 2]) {
      let row = boundary;
      while (inRangeCandidates.has(row)) { adjacentRows.add(row); row += boundary === range.s.r ? -1 : 1; }
    }
  }
  const specialRows = new Set(excludedRows.keys());
  const eligibleRows = sourceRows.filter((row) => !specialRows.has(row));
  const pendingRows = block.target === "OTHER" || block.needsReview
    ? eligibleRows.map((row) => ({ row, reason: block.target === "OTHER" ? "destino OTHER/unmapped" : "bloque requiere revisi\u00f3n" }))
    : [];
  const warnings: string[] = [];
  if (adjacentRows.size) warnings.push(`Se detectaron filas con datos junto al rango declarado: ${[...adjacentRows].sort((a, b) => a - b).join(", ")}.`);
  if (block.target === "BUDGET" && !block.columnMappings.some((mapping) => mapping.role === "description")) warnings.push("El bloque BUDGET no tiene mapeo de descripci\u00f3n; requiere revisi\u00f3n.");
  return {
    blockId: block.id,
    sheet: block.sheet,
    sourceRange: block.sourceRange,
    sourceRows: sourceRows.length,
    processedRows: block.target === "OTHER" || block.needsReview ? 0 : eligibleRows.length,
    excludedRows: [...excludedRows].filter(([row]) => row >= block.dataRowStart && row <= block.dataRowEnd).map(([row, reason]) => ({ row, reason })),
    pendingRows,
    blockingRows: [],
    unmappedRows: [...adjacentRows].sort((a, b) => a - b),
    warnings,
  };
}

export function validateImportPlan(raw: unknown, workbook: WorkbookRepresentation): ImportPlanCheck {
  const parsed = ImportPlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error("El ImportPlan no cumple el contrato esperado.");
  const warnings = [...parsed.data.warnings];
  const normalizedBlocks = parsed.data.blocks.map((block) => {
    const sheet = workbook.sheets.find((item) => item.sheetName === block.sheet);
    if (!sheet || !isRangeWithinSheet(block.sourceRange, sheet)) return block;
    const source = XLSX.utils.decode_range(block.sourceRange);
    const dataIsOutside = block.dataRowStart < source.s.r + 1 || block.dataRowEnd > source.e.r + 1 || block.dataRowStart > block.dataRowEnd;
    if (!dataIsOutside) return block;
    const dataRowStart = Math.max(source.s.r + 1, Math.min(block.dataRowStart, source.e.r + 1));
    const dataRowEnd = Math.max(dataRowStart, Math.min(block.dataRowEnd, source.e.r + 1));
    warnings.push(`El bloque ${block.id} declar\u00f3 datos fuera de sourceRange; se conserv\u00f3 como NEEDS_REVIEW y se limit\u00f3 a la regi\u00f3n verificable.`);
    return { ...block, dataRowStart, dataRowEnd, needsReview: true, notes: `${block.notes} Rango de datos corregido localmente; requiere revisi\u00f3n.` };
  });
  const certificateReconciled = reconcileCertificateEvidence(workbook, { ...parsed.data, blocks: normalizedBlocks });
  const budgetReconciled = reconcileBudgetEvidence(workbook, certificateReconciled.plan);
  const normalizedPlan = budgetReconciled.plan;
  warnings.push(...certificateReconciled.warnings, ...budgetReconciled.warnings);
  const coverage = normalizedPlan.blocks.map((block) => coverageForBlock(workbook, block));
  for (const block of normalizedPlan.blocks) {
    const sheet = workbook.sheets.find((item) => item.sheetName === block.sheet);
    if (!sheet) throw new Error(`El bloque ${block.id} referencia una hoja inexistente.`);
    if (!isRangeWithinSheet(block.sourceRange, sheet)) throw new Error(`El bloque ${block.id} referencia un rango inv\u00e1lido.`);
    const source = XLSX.utils.decode_range(block.sourceRange);
    if (block.headerRowStart > block.headerRowEnd || block.headerRowStart < source.s.r + 1 || block.headerRowEnd > source.e.r + 1) {
      throw new Error(`El bloque ${block.id} tiene filas fuera de su rango fuente.`);
    }
    for (const mapping of block.columnMappings) {
      try {
        const column = XLSX.utils.decode_col(mapping.column.replace(/[0-9]/g, ""));
        if (column < source.s.c || column > source.e.c) warnings.push(`El mapeo ${mapping.column} del bloque ${block.id} queda fuera del rango fuente.`);
      } catch {
        throw new Error(`El bloque ${block.id} tiene una columna inv\u00e1lida (${mapping.column}).`);
      }
    }
    const specialRows = [...block.repeatedHeaderRows, ...block.subtotalRows, ...block.footerRows, ...block.excludedRows.map((item) => item.row)];
    if (specialRows.some((row) => row < block.dataRowStart || row > block.dataRowEnd)) warnings.push(`El bloque ${block.id} declara filas especiales fuera de su rango de datos.`);
    if (coverage.find((item) => item.blockId === block.id)?.unmappedRows.length) warnings.push(`UNMAPPED_REGION detectada junto al bloque ${block.id}; no se extendi\u00f3 autom\u00e1ticamente.`);
  }
  for (let index = 0; index < normalizedPlan.blocks.length; index++) {
    for (let otherIndex = index + 1; otherIndex < normalizedPlan.blocks.length; otherIndex++) {
      const left = normalizedPlan.blocks[index];
      const right = normalizedPlan.blocks[otherIndex];
      if (left.sheet === right.sheet && overlapping(left.sourceRange, right.sourceRange)) warnings.push(`Los bloques ${left.id} y ${right.id} se solapan; requieren revisi\u00f3n.`);
    }
  }
  return { plan: normalizedPlan, warnings: [...new Set(warnings)], coverage };
}

export function rawNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let normalized = value.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = normalized.length - lastComma - 1 === 3 ? normalized.replace(/,/g, "") : normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/\.(?=\d{3}(?:\.|$))/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type BudgetRowDecision =
  | { kind: "ITEM" }
  | { kind: "STRUCTURAL"; reason: string }
  | { kind: "BLOCKING"; reason: string };

const STRUCTURAL_LABELS = new Set([
  "item",
  "rubro",
  "unidad",
  "cantidad",
  "cantidad prevista",
  "precio unitario",
  "precio parcial",
  "incidencia",
  "subtotal",
  "total",
  "total general",
  "monto total",
]);

function structuralBudgetLabel(value: unknown): boolean {
  const label = normalizedLabel(value);
  return STRUCTURAL_LABELS.has(label)
    || /^(total|subtotal|total general|monto total)\b/.test(label)
    || /^(elaborado|preparado|revisado|observaciones|fuente|tabla base)\b/.test(label);
}

function decideBudgetRow(description: string, code: string, unit: string | null, quantity: number | null, unitPrice: number | null): BudgetRowDecision {
  const descriptionIsStructural = structuralBudgetLabel(description);
  const codeIsStructural = structuralBudgetLabel(code);
  const hasFinancialSignal = quantity !== null || unitPrice !== null;
  if (descriptionIsStructural || codeIsStructural) return { kind: "STRUCTURAL", reason: "header/secci\u00f3n/subtotal/total" };
  if (!description && !code && !hasFinancialSignal && !unit) return { kind: "STRUCTURAL", reason: "fila vac\u00eda" };
  if (!description) return { kind: "BLOCKING", reason: "fila con datos de partida pero sin descripci\u00f3n" };
  if (!code && hasFinancialSignal) return { kind: "BLOCKING", reason: "parece una partida real pero falta el c\u00f3digo" };
  if (!code && !hasFinancialSignal) return { kind: "STRUCTURAL", reason: "secci\u00f3n o fila contextual sin se\u00f1ales de partida" };
  return { kind: "ITEM" };
}

export function extractBudgetItems(workbook: WorkbookRepresentation, plan: ImportPlan, initialCoverage: ImportBlockCoverage[] = []): { items: WorkbookBudgetItem[]; processedRows: number; excludedRows: number; pendingRows: number; blockingRows: Array<{ sheet: string; row: number; reason: string }>; warnings: string[]; coverage: ImportBlockCoverage[] } {
  const items: WorkbookBudgetItem[] = [];
  const warnings: string[] = [];
  const coverage = initialCoverage.length ? structuredClone(initialCoverage) : plan.blocks.map((block) => coverageForBlock(workbook, block));
  const coverageById = new Map(coverage.map((item) => [item.blockId, item]));
  let processedRows = 0;
  let excludedRows = 0;
  let pendingRows = 0;
  const blockingRows: Array<{ sheet: string; row: number; reason: string }> = [];
  for (const block of plan.blocks) {
    if (block.target !== "BUDGET" || block.needsReview) continue;
    const sheet = workbook.sheets.find((item) => item.sheetName === block.sheet);
    if (!sheet) continue;
    const byAddress = new Map(sheet.cells.map((cell) => [cell.address, cell]));
    const excluded = new Map(block.excludedRows.map((item) => [item.row, item.reason]));
    for (const row of block.repeatedHeaderRows) excluded.set(row, "header repetido");
    for (const row of block.subtotalRows) excluded.set(row, "subtotal/total");
    for (const row of block.footerRows) excluded.set(row, "pie de tabla");
    const mapping = new Map(block.columnMappings.map((item) => [item.role, item]));
    const valueAt = (row: number, column: string) => byAddress.get(`${column.replace(/[0-9]/g, "")}${row}`)?.raw ?? null;
    const blockCoverage = coverageById.get(block.id);
    let blockProcessed = 0;
    const blockPending: Array<{ row: number; reason: string }> = [];
    for (let row = block.dataRowStart; row <= block.dataRowEnd; row++) {
      if (excluded.has(row)) { excludedRows++; continue; }
      const descriptionMapping = mapping.get("description");
      const description = descriptionMapping ? String(valueAt(row, descriptionMapping.column) ?? "").trim() : "";
      const code = mapping.get("code") ? String(valueAt(row, mapping.get("code")!.column) ?? "").trim() : "";
      const unit = mapping.get("unit") ? String(valueAt(row, mapping.get("unit")!.column) ?? "").trim() || null : null;
      const numeric = (role: string) => {
        const roleMapping = mapping.get(role as "quantity" | "unitPrice");
        return roleMapping ? rawNumber(valueAt(row, roleMapping.column)) : null;
      };
      const quantity = numeric("quantity");
      const unitPrice = numeric("unitPrice");
      const decision = decideBudgetRow(description, code, unit, quantity, unitPrice);
      if (decision.kind === "STRUCTURAL") {
        excludedRows++;
        if (blockCoverage && !blockCoverage.excludedRows.some((item) => item.row === row)) blockCoverage.excludedRows.push({ row, reason: decision.reason });
        continue;
      }
      if (decision.kind === "BLOCKING") {
        pendingRows++;
        blockPending.push({ row, reason: decision.reason });
        blockingRows.push({ sheet: block.sheet, row, reason: decision.reason });
        if (blockCoverage && !blockCoverage.blockingRows.some((item) => item.row === row)) blockCoverage.blockingRows.push({ row, reason: decision.reason });
        continue;
      }
      const confidence = Math.min(block.confidence, ...block.columnMappings.filter((item) => item.role !== "ignore").map((item) => item.confidence), 1);
      items.push({ code: code || null, description, unit, quantity, unitPrice, parentCode: null, confidence, source: { sheet: block.sheet, row, range: block.sourceRange } });
      processedRows++;
      blockProcessed++;
    }
    if (blockCoverage) {
      blockCoverage.processedRows = blockProcessed;
      blockCoverage.pendingRows = [...blockCoverage.pendingRows, ...blockPending];
      blockCoverage.excludedRows = [...blockCoverage.excludedRows, ...[...excluded].filter(([row]) => row >= block.dataRowStart && row <= block.dataRowEnd && !blockCoverage.excludedRows.some((item) => item.row === row)).map(([row, reason]) => ({ row, reason }))];
    }
  }
  if (!items.length && plan.blocks.some((block) => block.target === "BUDGET")) warnings.push("No se extrajeron partidas de presupuesto desde los bloques mapeados.");
  if (blockingRows.length) warnings.push(`Se bloquearon ${blockingRows.length} filas de presupuesto que parecen partidas pero no tienen estructura completa.`);
  return { items, processedRows, excludedRows, pendingRows, blockingRows, warnings, coverage };
}
