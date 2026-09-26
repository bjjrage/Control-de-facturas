import * as XLSX from "xlsx";
import {
  WORKBOOK_FILE_MAX_BYTES,
  WORKBOOK_MAX_SHEETS,
  type WorkbookBlock,
  type WorkbookCell,
  type WorkbookDefinedName,
  type WorkbookRepresentation,
  type WorkbookSheetRepresentation,
} from "./types";

export class WorkbookInputError extends Error {}

const NON_EMPTY = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";
const CELL_PRESENT = (cell: WorkbookCell) => NON_EMPTY(cell.raw) || Boolean(cell.formula);

function cellValue(cell: XLSX.CellObject): string | number | boolean | null {
  if (cell.v === null || cell.v === undefined) return null;
  if (typeof cell.v === "string" || typeof cell.v === "number" || typeof cell.v === "boolean") return cell.v;
  if (cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.v);
}

function asSampleValue(cell: WorkbookCell | undefined): string | number | null {
  if (!cell || cell.raw === null || typeof cell.raw === "boolean") return cell?.formatted ?? null;
  return cell.raw;
}

function contiguousBlocks(cells: WorkbookCell[]): WorkbookBlock[] {
  const present = cells.filter(CELL_PRESENT);
  const byCoordinate = new Map(present.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const unvisited = new Set(byCoordinate.keys());
  const components: WorkbookCell[][] = [];
  while (unvisited.size) {
    const seed = unvisited.values().next().value as string;
    const queue = [seed];
    const component: WorkbookCell[] = [];
    unvisited.delete(seed);
    while (queue.length) {
      const key = queue.pop()!;
      const cell = byCoordinate.get(key)!;
      component.push(cell);
      for (let row = cell.row - 1; row <= cell.row + 1; row++) {
        for (let column = cell.column - 1; column <= cell.column + 1; column++) {
          const neighborKey = `${row}:${column}`;
          if (unvisited.has(neighborKey)) {
            unvisited.delete(neighborKey);
            queue.push(neighborKey);
          }
        }
      }
    }
    components.push(component);
  }

  return components.map((groupCells) => {
    const rows = [...new Set(groupCells.map((cell) => cell.row))].sort((a, b) => a - b);
    const byRow = new Map<number, WorkbookCell[]>();
    for (const cell of groupCells) byRow.set(cell.row, [...(byRow.get(cell.row) ?? []), cell]);
    const minColumn = Math.min(...groupCells.map((cell) => cell.column));
    const maxColumn = Math.max(...groupCells.map((cell) => cell.column));
    const rowCells = rows.map((row) => (byRow.get(row) ?? []).sort((a, b) => a.column - b.column));
    const titleRow = rowCells.find((row) => row.length === 1 && typeof row[0].raw === "string");
    const headerRow = rowCells.find((row) => row.length >= 2 && row.filter((cell) => typeof cell.raw === "string").length >= 2) ?? rowCells[0];
    const candidateHeaders = headerRow
      .sort((a, b) => a.column - b.column)
      .map((cell) => cell.formatted ?? String(cell.raw ?? ""))
      .filter(Boolean)
      .slice(0, 20);
    const sampleRows = rowCells
      .filter((row) => row[0]?.row !== headerRow[0]?.row)
      .slice(0, 3)
      .map((row) => Array.from({ length: maxColumn - minColumn + 1 }, (_, index) => asSampleValue(row.find((cell) => cell.column === minColumn + index))));

    return {
      id: `${rows[0]}-${rows.at(-1)}-${minColumn}-${maxColumn}`,
      range: `${XLSX.utils.encode_col(minColumn - 1)}${rows[0]}:${XLSX.utils.encode_col(maxColumn - 1)}${rows.at(-1)}`,
      rowStart: rows[0], rowEnd: rows.at(-1)!, columnStart: minColumn, columnEnd: maxColumn,
      rowCount: rows.length,
      title: titleRow?.[0]?.formatted ?? null,
      headerRows: headerRow?.length ? [headerRow[0].row] : [],
      candidateHeaders,
      sampleRows,
      totalRowsWithData: rows.length,
    };
  });
}

export function parseParaguayanNumber(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact.replace(/\.(?=\d{3}(?:\.|$))/g, "");
  const parsed = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRangeWithinSheet(range: string, sheet: WorkbookSheetRepresentation): boolean {
  try {
    const decoded = XLSX.utils.decode_range(range);
    const bounds = XLSX.utils.decode_range(sheet.usedRange);
    return decoded.s.r >= bounds.s.r && decoded.e.r <= bounds.e.r && decoded.s.c >= bounds.s.c && decoded.e.c <= bounds.e.c;
  } catch {
    return false;
  }
}

// Named ranges often carry the workbook's own semantics (e.g. `viviendas`
// pointing at the housing count used by every scaled formula).
function definedNames(workbook: XLSX.WorkBook): WorkbookDefinedName[] {
  const seen = new Set<string>();
  return (workbook.Workbook?.Names ?? []).flatMap((entry) => {
    const ref = String(entry.Ref ?? "");
    // Broken names (#REF!, #NAME?) are leftovers of deleted ranges and `_…`
    // names are Excel internals (print areas, sort state); none carry meaning.
    if (!entry.Name || entry.Name.startsWith("_") || !ref || ref.includes("#") || seen.has(`${entry.Name}=${ref}`) || seen.size >= 200) return [];
    seen.add(`${entry.Name}=${ref}`);
    // Only names bound to a cell or range; formula-only names are usually
    // leftovers of copied templates.
    if (!/^'?.+?'?!\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/.test(ref)) return [];
    const match = ref.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)$/);
    const sheet = match ? match[1].replace(/''/g, "'") : null;
    const cell = match && sheet ? workbook.Sheets[sheet]?.[`${match[2]}${match[3]}`] : undefined;
    return [{ name: entry.Name, ref, sheet, value: cell ? cellValue(cell) : null }];
  });
}

export function parseWorkbook(input: ArrayBuffer | Uint8Array, fileName: string): WorkbookRepresentation {
  if (input.byteLength === 0) throw new WorkbookInputError("La planilla está vacía.");
  if (input.byteLength > WORKBOOK_FILE_MAX_BYTES) throw new WorkbookInputError("El archivo supera el límite de 10 MB.");
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) throw new WorkbookInputError("Formato no válido. Subí un archivo .xlsx, .xls o .csv.");

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(input, { type: "array", cellFormula: true, cellNF: true, cellText: true, cellDates: false });
  } catch {
    throw new WorkbookInputError("No se pudo leer la planilla. Verificá que el archivo no esté dañado o protegido.");
  }
  if (workbook.SheetNames.length === 0) throw new WorkbookInputError("La planilla no contiene hojas.");
  if (workbook.SheetNames.length > WORKBOOK_MAX_SHEETS) throw new WorkbookInputError(`La planilla tiene más de ${WORKBOOK_MAX_SHEETS} hojas.`);

  let totalCells = 0;
  const warnings: string[] = [];
  const sheets = workbook.SheetNames.map((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    const usedRange = worksheet?.["!ref"];
    if (!worksheet || !usedRange) {
      return {
        sheetName,
        sheetIndex,
        usedRange: "A1:A1",
        rowCount: 0,
        columnCount: 0,
        mergedCells: [],
        allCellCount: 0,
        serializedCellCount: 0,
        cells: [],
        blocks: [],
      } satisfies WorkbookSheetRepresentation;
    }
    const range = XLSX.utils.decode_range(usedRange);
    const allCells: WorkbookCell[] = [];
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let column = range.s.c; column <= range.e.c; column++) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = worksheet[address];
        if (!cell || !NON_EMPTY(cell.v) && !cell.f) continue;
        allCells.push({
          address,
          row: row + 1,
          column: column + 1,
          raw: cellValue(cell),
          formatted: typeof cell.w === "string" ? cell.w : cell.v === undefined || cell.v === null ? null : String(cell.v),
          formula: typeof cell.f === "string" ? cell.f : null,
          type: typeof cell.t === "string" ? cell.t : null,
        });
      }
    }
    totalCells += allCells.length;
    const serialized = allCells;
    return {
      sheetName,
      sheetIndex,
      usedRange,
      rowCount: range.e.r - range.s.r + 1,
      columnCount: range.e.c - range.s.c + 1,
      mergedCells: (worksheet["!merges"] ?? []).map((merge) => XLSX.utils.encode_range(merge)),
      allCellCount: allCells.length,
      serializedCellCount: serialized.length,
      cells: serialized,
      blocks: contiguousBlocks(serialized),
    } satisfies WorkbookSheetRepresentation;
  });
  if (totalCells === 0) throw new WorkbookInputError("La planilla no contiene celdas con datos.");

  return {
    fileName,
    workbookType: /\.csv$/i.test(fileName) ? "CSV" : "EXCEL",
    sheets,
    definedNames: definedNames(workbook),
    totalCells,
    serializedCellCount: sheets.reduce((sum, sheet) => sum + sheet.serializedCellCount, 0),
    warnings,
  };
}
