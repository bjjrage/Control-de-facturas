import type { IWorkbookData, ICellData, IObjectMatrixPrimitiveType, IStyleData } from "@univerjs/presets";
import * as XLSX from "xlsx";
import type { StoredCell, StoredSheet, StoredStyle, WorkingSnapshot } from "./workbook-store";

/**
 * Fase 3 de "Certificados Excel-first" — convierte entre la copia de trabajo
 * que guarda el ERP (WorkingSnapshot, ver workbook-store.ts) y el snapshot
 * que espera Univer (IWorkbookData) para montar la planilla embebida.
 *
 * Vive separado de workbook-store.ts a propósito: ese módulo lo importa el
 * servidor (acciones, sube a Storage) y no necesita saber nada de Univer;
 * este solo lo importa el componente cliente que monta la grilla.
 */

export function workingSnapshotToUniver(snapshot: WorkingSnapshot, workbookId: string): IWorkbookData {
  const sheets: IWorkbookData["sheets"] = {};
  const sheetOrder: string[] = [];

  for (const sheet of snapshot.sheets) {
    const id = sheet.name;
    sheetOrder.push(id);
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    const at = (r: number, c: number) => {
      cellData[r] = cellData[r] ?? {};
      cellData[r][c] = cellData[r][c] ?? {};
      return cellData[r][c];
    };
    for (const [row, column, raw, , formula] of sheet.cells) {
      if (raw === null && !formula) continue;
      const entry = at(row - 1, column - 1);
      if (raw !== null) entry.v = raw;
      if (formula) entry.f = formula.startsWith("=") ? formula : `=${formula}`;
    }
    // El formato va aparte de los valores (ver workbook-formatting.ts):
    // incluye celdas vacías con bordes o relleno.
    for (const [row, column, styleId] of sheet.styleCells ?? []) at(row - 1, column - 1).s = styleId;

    const columnData: Record<number, { w: number }> = {};
    sheet.columnWidths.forEach((width, index) => {
      if (width !== null) columnData[index] = { w: width };
    });
    const rowData: Record<number, { h?: number; hd?: 0 | 1 }> = {};
    for (const [row, height] of Object.entries(sheet.rowHeights ?? {})) rowData[Number(row) - 1] = { h: height };
    for (const row of sheet.hiddenRows ?? []) rowData[row - 1] = { ...(rowData[row - 1] ?? {}), hd: 1 };

    sheets[id] = {
      id,
      name: sheet.name,
      hidden: sheet.hidden ? 1 : 0,
      rowCount: Math.max(sheet.rowCount + 50, 100),
      columnCount: Math.max(sheet.columnCount + 5, 26),
      cellData,
      rowData,
      mergeData: sheet.merges.flatMap((ref) => {
        try {
          const range = XLSX.utils.decode_range(ref);
          return [{ startRow: range.s.r, endRow: range.e.r, startColumn: range.s.c, endColumn: range.e.c }];
        } catch {
          return [];
        }
      }),
      columnData,
      ...(sheet.freeze
        ? { freeze: { xSplit: sheet.freeze.columns, ySplit: sheet.freeze.rows, startRow: sheet.freeze.rows, startColumn: sheet.freeze.columns } }
        : {}),
    };
  }

  return {
    id: workbookId,
    name: snapshot.fileName,
    appVersion: "1.0.0",
    locale: "esES" as IWorkbookData["locale"],
    styles: (snapshot.styles ?? {}) as IWorkbookData["styles"],
    sheetOrder,
    sheets,
  } as IWorkbookData;
}

/** Camino inverso: lo que el usuario editó en la grilla (valores Y formato)
 * vuelve al formato que guarda el ERP. Nunca se llama desde el servidor. */
export function univerToWorkingSnapshot(data: IWorkbookData, fileName: string): WorkingSnapshot {
  const styles: Record<string, StoredStyle> = {};
  for (const [id, style] of Object.entries(data.styles ?? {})) if (style) styles[id] = style as StoredStyle;
  // Univer a veces deja el estilo de una celda editada "en línea" (objeto) en
  // vez de por id: se registra en el mapa con un id propio.
  const inlineIds = new Map<string, string>();
  const styleIdOf = (s: ICellData["s"]): string | null => {
    if (!s) return null;
    if (typeof s === "string") return s;
    const key = JSON.stringify(s);
    let id = inlineIds.get(key);
    if (!id) {
      id = `u${inlineIds.size + 1}_${Date.now().toString(36)}`;
      inlineIds.set(key, id);
      styles[id] = s as IStyleData as StoredStyle;
    }
    return id;
  };

  const sheets: StoredSheet[] = data.sheetOrder.map((id, index) => {
    const sheet = data.sheets[id];
    const cells: StoredCell[] = [];
    const styleCells: [number, number, string][] = [];
    let maxRow = 0;
    let maxCol = 0;
    for (const [rowStr, row] of Object.entries(sheet.cellData ?? {})) {
      for (const [colStr, cell] of Object.entries(row ?? {}) as [string, ICellData][]) {
        if (!cell) continue;
        const r = Number(rowStr) + 1;
        const c = Number(colStr) + 1;
        const styleId = styleIdOf(cell.s);
        const hasValue = !((cell.v === undefined || cell.v === null) && !cell.f);
        if (!styleId && !hasValue) continue;
        if (styleId) styleCells.push([r, c, styleId]);
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
        if (!hasValue) continue;
        const raw = cell.v === undefined || cell.v === null ? null : (cell.v as string | number | boolean);
        cells.push([r, c, raw, null, cell.f ? cell.f.replace(/^=/, "") : null, null]);
      }
    }
    const merges = (sheet.mergeData ?? []).map(
      (m) => `${XLSX.utils.encode_col(m.startColumn)}${m.startRow + 1}:${XLSX.utils.encode_col(m.endColumn)}${m.endRow + 1}`
    );
    // Solo hasta la última columna/fila con datos o formato: las filas y
    // columnas de margen que agrega la grilla no son parte del documento.
    const columnCount = maxCol;
    const rowCount = maxRow;
    const columnWidths = Array.from({ length: columnCount }, (_, i) => sheet.columnData?.[i]?.w ?? null);
    const rowHeights: Record<number, number> = {};
    const hiddenRows: number[] = [];
    const defaultHeight = sheet.defaultRowHeight;
    for (const [rowStr, rowInfo] of Object.entries(sheet.rowData ?? {})) {
      const r = Number(rowStr) + 1;
      if (rowInfo?.h && rowInfo.h !== defaultHeight && !rowInfo.ia) rowHeights[r] = rowInfo.h;
      if (rowInfo?.hd) hiddenRows.push(r);
    }
    const freeze = sheet.freeze && (sheet.freeze.xSplit > 0 || sheet.freeze.ySplit > 0) ? { rows: sheet.freeze.ySplit, columns: sheet.freeze.xSplit } : null;
    return {
      name: sheet.name ?? id,
      index,
      hidden: Boolean(sheet.hidden),
      usedRange: `A1:${XLSX.utils.encode_col(Math.max(columnCount, 1) - 1)}${Math.max(rowCount, 1)}`,
      rowCount,
      columnCount,
      merges,
      columnWidths,
      cells,
      styleCells,
      rowHeights,
      hiddenRows,
      freeze,
    };
  });
  return { fileName, sheets, definedNames: [], styles };
}
