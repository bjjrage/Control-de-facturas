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
    for (const candidate of new Set(sheet.cells.map((cell) => cell.row))) {
      if (candidate >= range.s.r + 1 && candidate <= range.e.r + 1) continue;
      const distanceToData = Math.min(...sourceRows.map((row) => Math.abs(row - candidate)));
      const hasTwoCells = sheet.cells.filter((cell) => cell.row === candidate && cell.column - 1 >= range.s.c && cell.column - 1 <= range.e.c && (cell.raw !== null || cell.formatted || cell.formula)).length >= 2;
      if (hasTwoCells && distanceToData <= 1) adjacentRows.add(candidate);
    }
    const candidates = new Set(sheet.cells.filter((cell) => cell.column - 1 >= range.s.c && cell.column - 1 <= range.e.c && (cell.raw !== null || cell.formatted || cell.formula)).map((cell) => cell.row));
    for (const boundary of [range.s.r, range.e.r + 2]) {
      let row = boundary;
      while (candidates.has(row)) { adjacentRows.add(row); row += boundary === range.s.r ? -1 : 1; }
    }
  }
  const specialRows = new Set(excludedRows.keys());
  const eligibleRows = sourceRows.filter((row) => !specialRows.has(row));
  const pendingRows = block.target === "OTHER" || block.needsReview
    ? eligibleRows.map((row) => ({ row, reason: block.target === "OTHER" ? "destino OTHER/unmapped" : "bloque requiere revisión" }))
    : [];
  const warnings: string[] = [];
  if (adjacentRows.size) warnings.push(`Se detectaron filas con datos junto al rango declarado: ${[...adjacentRows].sort((a, b) => a - b).join(", ")}.`);
  if (block.target === "BUDGET" && !block.columnMappings.some((mapping) => mapping.role === "description")) warnings.push("El bloque BUDGET no tiene mapeo de descripción; requiere revisión.");
  return {
    blockId: block.id,
    sheet: block.sheet,
    sourceRange: block.sourceRange,
    sourceRows: sourceRows.length,
    processedRows: block.target === "OTHER" || block.needsReview ? 0 : eligibleRows.length,
    excludedRows: [...excludedRows].filter(([row]) => row >= block.dataRowStart && row <= block.dataRowEnd).map(([row, reason]) => ({ row, reason })),
    pendingRows,
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
    warnings.push(`El bloque ${block.id} declarÃ³ datos fuera de sourceRange; se conservÃ³ como NEEDS_REVIEW y se limitÃ³ a la regiÃ³n verificable.`);
    return { ...block, dataRowStart, dataRowEnd, needsReview: true, notes: `${block.notes} Rango de datos corregido localmente; requiere revisión.` };
  });
  const normalizedPlan = { ...parsed.data, blocks: normalizedBlocks };
  const coverage = normalizedPlan.blocks.map((block) => coverageForBlock(workbook, block));
  for (const block of normalizedPlan.blocks) {
    const sheet = workbook.sheets.find((item) => item.sheetName === block.sheet);
    if (!sheet) throw new Error(`El bloque ${block.id} referencia una hoja inexistente.`);
    if (!isRangeWithinSheet(block.sourceRange, sheet)) throw new Error(`El bloque ${block.id} referencia un rango inválido.`);
    const source = XLSX.utils.decode_range(block.sourceRange);
    if (block.headerRowStart > block.headerRowEnd || block.headerRowStart < source.s.r + 1 || block.headerRowEnd > source.e.r + 1) {
      throw new Error(`El bloque ${block.id} tiene filas fuera de su rango fuente.`);
    }
    for (const mapping of block.columnMappings) {
      try {
        const column = XLSX.utils.decode_col(mapping.column.replace(/[0-9]/g, ""));
        if (column < source.s.c || column > source.e.c) warnings.push(`El mapeo ${mapping.column} del bloque ${block.id} queda fuera del rango fuente.`);
      } catch {
        throw new Error(`El bloque ${block.id} tiene una columna inválida (${mapping.column}).`);
      }
    }
    const specialRows = [...block.repeatedHeaderRows, ...block.subtotalRows, ...block.footerRows, ...block.excludedRows.map((item) => item.row)];
    if (specialRows.some((row) => row < block.dataRowStart || row > block.dataRowEnd)) warnings.push(`El bloque ${block.id} declara filas especiales fuera de su rango de datos.`);
    if (coverage.find((item) => item.blockId === block.id)?.unmappedRows.length) warnings.push(`UNMAPPED_REGION detectada junto al bloque ${block.id}; no se extendió automáticamente.`);
  }
  for (let index = 0; index < normalizedPlan.blocks.length; index++) {
    for (let otherIndex = index + 1; otherIndex < normalizedPlan.blocks.length; otherIndex++) {
      const left = normalizedPlan.blocks[index];
      const right = normalizedPlan.blocks[otherIndex];
      if (left.sheet === right.sheet && overlapping(left.sourceRange, right.sourceRange)) warnings.push(`Los bloques ${left.id} y ${right.id} se solapan; requieren revisión.`);
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

export function extractBudgetItems(workbook: WorkbookRepresentation, plan: ImportPlan, initialCoverage: ImportBlockCoverage[] = []): { items: WorkbookBudgetItem[]; processedRows: number; excludedRows: number; pendingRows: number; warnings: string[]; coverage: ImportBlockCoverage[] } {
  const items: WorkbookBudgetItem[] = [];
  const warnings: string[] = [];
  const coverage = initialCoverage.length ? structuredClone(initialCoverage) : plan.blocks.map((block) => coverageForBlock(workbook, block));
  const coverageById = new Map(coverage.map((item) => [item.blockId, item]));
  let processedRows = 0;
  let excludedRows = 0;
  let pendingRows = 0;
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
      const codeValue = mapping.get("code") ? String(valueAt(row, mapping.get("code")!.column) ?? "").trim().toLowerCase() : "";
      const summaryLabel = description.toLowerCase();
      if (["item", "total", "subtotal", "total general"].includes(codeValue) || ["item", "total", "subtotal", "total general"].includes(summaryLabel)) {
        excludedRows++;
        if (blockCoverage && !blockCoverage.excludedRows.some((item) => item.row === row)) blockCoverage.excludedRows.push({ row, reason: "fila de total/subtotal" });
        continue;
      }
      if (!description) { pendingRows++; blockPending.push({ row, reason: "no se pudo identificar descripción" }); continue; }
      const numeric = (role: string) => {
        const roleMapping = mapping.get(role as "quantity" | "unitPrice");
        return roleMapping ? rawNumber(valueAt(row, roleMapping.column)) : null;
      };
      const confidence = Math.min(block.confidence, ...block.columnMappings.filter((item) => item.role !== "ignore").map((item) => item.confidence), 1);
      items.push({ code: mapping.get("code") ? String(valueAt(row, mapping.get("code")!.column) ?? "").trim() || null : null, description, unit: mapping.get("unit") ? String(valueAt(row, mapping.get("unit")!.column) ?? "").trim() || null : null, quantity: numeric("quantity"), unitPrice: numeric("unitPrice"), parentCode: null, confidence, source: { sheet: block.sheet, row, range: block.sourceRange } });
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
  return { items, processedRows, excludedRows, pendingRows, warnings, coverage };
}
