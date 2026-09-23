import * as XLSX from "xlsx";
import {
  WORKBOOK_FILE_MAX_BYTES,
  WORKBOOK_MAX_GRID_CELLS,
  WORKBOOK_MAX_SHEETS,
  type WorkbookBlock,
  type WorkbookCell,
  type WorkbookRepresentation,
  type WorkbookSheetRepresentation,
} from "./types";

export class WorkbookInputError extends Error {}

const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ARCHIVE_ENTRIES = 2048;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

export function assertWorkbookArchiveWithinLimits(input: Uint8Array, fileName: string): void {
  if (!/\.xlsx$/i.test(fileName) || input[0] !== 0x50 || input[1] !== 0x4b) return;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const minEocdOffset = Math.max(0, input.byteLength - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = input.byteLength - 22; offset >= minEocdOffset; offset--) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === input.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new WorkbookInputError("El archivo XLSX no contiene un directorio ZIP válido.");

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const diskEntries = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new WorkbookInputError("El XLSX multidisco o ZIP64 no está soportado para análisis seguro.");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > eocdOffset) {
    throw new WorkbookInputError("El archivo XLSX excede los límites estructurales permitidos.");
  }

  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > centralOffset + centralSize || view.getUint32(offset, true) !== ZIP_CENTRAL_HEADER) {
      throw new WorkbookInputError("El archivo XLSX contiene un directorio ZIP inválido.");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > centralOffset + centralSize || diskStart !== 0 || (flags & 1) !== 0 || ![0, 8].includes(compression)) {
      throw new WorkbookInputError("El XLSX usa una estructura o compresión no permitida.");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new WorkbookInputError("Los archivos XLSX ZIP64 no están soportados.");
    }
    totalUncompressed += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES || (uncompressedSize > 0 && compressedSize === 0)) {
      throw new WorkbookInputError("La planilla comprimida excede el límite de expansión segura.");
    }
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) throw new WorkbookInputError("El directorio del XLSX contiene datos inconsistentes.");
  if (input.byteLength < 4 || view.getUint32(0, true) !== ZIP_LOCAL_HEADER) throw new WorkbookInputError("El archivo XLSX no comienza con una entrada ZIP válida.");
}

export function reserveWorkbookGridArea(range: XLSX.Range, alreadyReserved: number): number {
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  const area = rowCount * columnCount;
  if (
    !Number.isSafeInteger(area) ||
    rowCount < 1 ||
    columnCount < 1 ||
    alreadyReserved < 0 ||
    alreadyReserved + area > WORKBOOK_MAX_GRID_CELLS
  ) {
    throw new WorkbookInputError("La planilla abarca demasiadas celdas para analizarse de forma segura.");
  }
  return alreadyReserved + area;
}

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

export function parseWorkbook(input: ArrayBuffer | Uint8Array, fileName: string): WorkbookRepresentation {
  if (input.byteLength === 0) throw new WorkbookInputError("La planilla está vacía.");
  if (input.byteLength > WORKBOOK_FILE_MAX_BYTES) throw new WorkbookInputError("El archivo supera el límite de 10 MB.");
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) throw new WorkbookInputError("Formato no válido. Subí un archivo .xlsx, .xls o .csv.");

  let workbook: XLSX.WorkBook;
  try {
    assertWorkbookArchiveWithinLimits(input instanceof Uint8Array ? input : new Uint8Array(input), fileName);
    workbook = XLSX.read(input, { type: "array", cellFormula: true, cellNF: true, cellText: true, cellDates: false });
  } catch (cause) {
    if (cause instanceof WorkbookInputError) throw cause;
    throw new WorkbookInputError("No se pudo leer la planilla. Verificá que el archivo no esté dañado o protegido.");
  }
  if (workbook.SheetNames.length === 0) throw new WorkbookInputError("La planilla no contiene hojas.");
  if (workbook.SheetNames.length > WORKBOOK_MAX_SHEETS) throw new WorkbookInputError(`La planilla tiene más de ${WORKBOOK_MAX_SHEETS} hojas.`);

  let totalCells = 0;
  let reservedGridCells = 0;
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
    reservedGridCells = reserveWorkbookGridArea(range, reservedGridCells);
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
    totalCells,
    serializedCellCount: sheets.reduce((sum, sheet) => sum + sheet.serializedCellCount, 0),
    warnings,
  };
}
