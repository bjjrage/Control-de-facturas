import * as XLSX from "xlsx";
import { WORKBOOK_MAX_TOOL_RESPONSE_CHARS, type WorkbookCell, type WorkbookRepresentation } from "./types";

export const WORKBOOK_READ_LIMITS = {
  maxResponseChars: WORKBOOK_MAX_TOOL_RESPONSE_CHARS,
  maxRangeCells: 2_000,
  maxRowsPerRead: 250,
  maxIterations: 12,
} as const;

export type WorkbookReadTool =
  | "list_sheets"
  | "get_sheet_info"
  | "read_range"
  | "read_rows"
  | "get_non_empty_regions"
  | "get_merged_cells"
  | "get_formulas"
  | "find_text"
  | "inspect_region";

export function invokeReadTool(workbook: WorkbookRepresentation, tool: WorkbookReadTool, args: Record<string, unknown> = {}) {
  switch (tool) {
    case "list_sheets": return listSheets(workbook);
    case "get_sheet_info": return getSheetInfo(workbook, String(args.sheet ?? ""));
    case "read_range": return readRange(workbook, String(args.sheet ?? ""), String(args.range ?? ""));
    case "read_rows": return readRows(workbook, String(args.sheet ?? ""), Number(args.startRow ?? 1), Number(args.endRow ?? 1), Array.isArray(args.columns) ? args.columns.map(String) : undefined);
    case "get_non_empty_regions": return getNonEmptyRegions(workbook, String(args.sheet ?? ""));
    case "get_merged_cells": return getMergedCells(workbook, String(args.sheet ?? ""));
    case "get_formulas": return getFormulas(workbook, String(args.sheet ?? ""), args.range ? String(args.range) : undefined);
    case "find_text": return findText(workbook, String(args.query ?? ""), args.sheet ? String(args.sheet) : undefined);
    case "inspect_region": return inspectRegion(workbook, String(args.sheet ?? ""), String(args.range ?? ""));
  }
}

function sheetOrThrow(workbook: WorkbookRepresentation, sheetName: string) {
  const sheet = workbook.sheets.find((candidate) => candidate.sheetName === sheetName);
  if (!sheet) throw new Error(`La hoja “${sheetName}” no existe.`);
  return sheet;
}

function bounded<T>(value: T, maxChars = WORKBOOK_READ_LIMITS.maxResponseChars): { value: T; truncated: boolean } {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return { value, truncated: false };
  return { value: serialized.slice(0, maxChars) as T, truncated: true };
}

function inRange(cell: WorkbookCell, range: XLSX.Range) {
  return cell.row - 1 >= range.s.r && cell.row - 1 <= range.e.r && cell.column - 1 >= range.s.c && cell.column - 1 <= range.e.c;
}

function cellForRead(cell: WorkbookCell) {
  return { address: cell.address, row: cell.row, column: cell.column, raw: cell.raw, formatted: cell.formatted, formula: cell.formula, type: cell.type };
}

export function listSheets(workbook: WorkbookRepresentation) {
  return workbook.sheets.map((sheet) => ({ name: sheet.sheetName, index: sheet.sheetIndex, usedRange: sheet.usedRange, rowCount: sheet.rowCount, columnCount: sheet.columnCount, allCellCount: sheet.allCellCount }));
}

export function getSheetInfo(workbook: WorkbookRepresentation, sheetName: string) {
  const sheet = sheetOrThrow(workbook, sheetName);
  return {
    name: sheet.sheetName,
    index: sheet.sheetIndex,
    usedRange: sheet.usedRange,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    mergedRanges: sheet.mergedCells,
    formulas: sheet.cells.filter((cell) => cell.formula).length,
    regions: sheet.blocks.map((block) => ({ id: block.id, range: block.range, title: block.title, headers: block.candidateHeaders, rowCount: block.rowCount })),
  };
}

export function readRange(workbook: WorkbookRepresentation, sheetName: string, rangeText: string) {
  const sheet = sheetOrThrow(workbook, sheetName);
  const range = XLSX.utils.decode_range(rangeText);
  const cells = sheet.cells.filter((cell) => inRange(cell, range)).slice(0, WORKBOOK_READ_LIMITS.maxRangeCells).map(cellForRead);
  const result = { sheet: sheetName, range: rangeText, cells, sourceCellCount: sheet.cells.filter((cell) => inRange(cell, range)).length };
  return { ...bounded(result), tool: "read_range" as const };
}

export function readRows(workbook: WorkbookRepresentation, sheetName: string, startRow: number, endRow: number, columns?: string[]) {
  const sheet = sheetOrThrow(workbook, sheetName);
  const safeEnd = Math.min(endRow, startRow + WORKBOOK_READ_LIMITS.maxRowsPerRead - 1);
  const columnSet = columns?.length ? new Set(columns.map((column) => XLSX.utils.decode_col(column.replace(/[0-9]/g, "")) + 1)) : null;
  const rows = sheet.cells.filter((cell) => cell.row >= startRow && cell.row <= safeEnd && (!columnSet || columnSet.has(cell.column))).map(cellForRead);
  return { ...bounded({ sheet: sheetName, startRow, endRow: safeEnd, rows }), tool: "read_rows" as const };
}

export function getNonEmptyRegions(workbook: WorkbookRepresentation, sheetName: string) {
  const sheet = sheetOrThrow(workbook, sheetName);
  return { sheet: sheetName, regions: sheet.blocks.map((block) => ({ id: block.id, range: block.range, rows: block.rowCount, headers: block.candidateHeaders })) };
}

export function getMergedCells(workbook: WorkbookRepresentation, sheetName: string) {
  return { sheet: sheetName, ranges: sheetOrThrow(workbook, sheetName).mergedCells };
}

export function getFormulas(workbook: WorkbookRepresentation, sheetName: string, rangeText?: string) {
  const sheet = sheetOrThrow(workbook, sheetName);
  const range = rangeText ? XLSX.utils.decode_range(rangeText) : null;
  return { sheet: sheetName, formulas: sheet.cells.filter((cell) => cell.formula && (!range || inRange(cell, range))).map((cell) => ({ address: cell.address, formula: cell.formula, cachedValue: cell.raw })) };
}

export function findText(workbook: WorkbookRepresentation, query: string, sheetName?: string) {
  const sheets = sheetName ? [sheetOrThrow(workbook, sheetName)] : workbook.sheets;
  const normalized = query.toLocaleLowerCase();
  return sheets.flatMap((sheet) => sheet.cells.filter((cell) => `${cell.raw ?? ""} ${cell.formatted ?? ""}`.toLocaleLowerCase().includes(normalized)).slice(0, 100).map((cell) => ({ sheet: sheet.sheetName, ...cellForRead(cell) })));
}

export function inspectRegion(workbook: WorkbookRepresentation, sheetName: string, rangeText: string) {
  const sheet = sheetOrThrow(workbook, sheetName);
  const range = XLSX.utils.decode_range(rangeText);
  const cells = sheet.cells.filter((cell) => inRange(cell, range));
  return { sheet: sheetName, range: rangeText, mergedRanges: sheet.mergedCells.filter((merged) => { try { return inRange({ row: XLSX.utils.decode_range(merged).s.r + 1, column: XLSX.utils.decode_range(merged).s.c + 1 } as WorkbookCell, range); } catch { return false; } }), cells: bounded(cells.map(cellForRead)).value };
}
