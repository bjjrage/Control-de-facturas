import type { IWorkbookData, ICellData, IObjectMatrixPrimitiveType } from "@univerjs/presets";
import * as XLSX from "xlsx";
import type { StoredCell, StoredSheet, WorkingSnapshot } from "./workbook-store";

/**
 * Fase 3 de "Certificados Excel-first" — convierte entre la copia de trabajo
 * que guarda el ERP (WorkingSnapshot, ver workbook-store.ts) y el snapshot
 * que espera Univer (IWorkbookData) para montar la planilla embebida.
 *
 * Vive separado de workbook-store.ts a propósito: ese módulo lo importa el
 * servidor (acciones, sube a Storage) y no necesita saber nada de Univer;
 * este solo lo importa el componente cliente que monta la grilla.
 */

function colWidthToPx(width: number | null): number | undefined {
  if (width === null) return undefined;
  return width;
}

export function workingSnapshotToUniver(snapshot: WorkingSnapshot, workbookId: string): IWorkbookData {
  const sheets: IWorkbookData["sheets"] = {};
  const sheetOrder: string[] = [];

  for (const sheet of snapshot.sheets) {
    const id = sheet.name;
    sheetOrder.push(id);
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    for (const cell of sheet.cells) {
      const [row, column, raw, formatted, formula] = cell;
      const r = row - 1;
      const c = column - 1;
      const entry: ICellData = {};
      if (raw !== null) entry.v = raw;
      if (formula) entry.f = formula.startsWith("=") ? formula : `=${formula}`;
      if (!("v" in entry) && !("f" in entry)) continue;
      cellData[r] = cellData[r] ?? {};
      cellData[r][c] = entry;
      // El texto formateado ("10.878.185" en vez de 10878185) no tiene
      // representación directa en ICellData sin cargar formatos numéricos
      // completos — se pierde a propósito acá (equivalencia OPERACIONAL, no
      // visual; ver el comentario del módulo en workbook-store.ts). El valor
      // crudo (raw/formula) es lo único que importa para el extractor y
      // para la fidelidad de fórmulas ya probada en la Fase 2.
      void formatted;
    }
    const columnData: Record<number, { w: number }> = {};
    sheet.columnWidths.forEach((width, index) => {
      const px = colWidthToPx(width);
      if (px !== undefined) columnData[index] = { w: px };
    });
    sheets[id] = {
      id,
      name: sheet.name,
      hidden: sheet.hidden ? 1 : 0,
      rowCount: Math.max(sheet.rowCount, 20),
      columnCount: Math.max(sheet.columnCount, 10),
      cellData,
      mergeData: sheet.merges.flatMap((ref) => {
        try {
          const range = XLSX.utils.decode_range(ref);
          return [{ startRow: range.s.r, endRow: range.e.r, startColumn: range.s.c, endColumn: range.e.c }];
        } catch {
          return [];
        }
      }),
      columnData,
    };
  }

  return {
    id: workbookId,
    name: snapshot.fileName,
    appVersion: "1.0.0",
    locale: "esES" as IWorkbookData["locale"],
    styles: {},
    sheetOrder,
    sheets,
  } as IWorkbookData;
}

/** Camino inverso: lo que el usuario editó en la grilla vuelve al formato
 * que guarda el ERP. Se llama al autoguardar (Fase 3) — nunca desde el
 * servidor. */
export function univerToWorkingSnapshot(data: IWorkbookData, fileName: string): WorkingSnapshot {
  const sheets: StoredSheet[] = data.sheetOrder.map((id, index) => {
    const sheet = data.sheets[id];
    const cells: StoredCell[] = [];
    let maxRow = 0;
    let maxCol = 0;
    for (const [rowStr, row] of Object.entries(sheet.cellData ?? {})) {
      for (const [colStr, cell] of Object.entries(row ?? {}) as [string, ICellData][]) {
        if (cell.v === undefined && !cell.f) continue;
        const r = Number(rowStr) + 1;
        const c = Number(colStr) + 1;
        maxRow = Math.max(maxRow, r);
        maxCol = Math.max(maxCol, c);
        const raw = cell.v === undefined ? null : (cell.v as string | number | boolean);
        cells.push([r, c, raw, null, cell.f ? cell.f.replace(/^=/, "") : null, null]);
      }
    }
    const merges = (sheet.mergeData ?? []).map(
      (m) => `${XLSX.utils.encode_col(m.startColumn)}${m.startRow + 1}:${XLSX.utils.encode_col(m.endColumn)}${m.endRow + 1}`
    );
    const columnCount = Math.max(sheet.columnCount ?? 0, maxCol);
    const columnWidths = Array.from({ length: columnCount }, (_, i) => sheet.columnData?.[i]?.w ?? null);
    return {
      name: sheet.name ?? id,
      index,
      hidden: Boolean(sheet.hidden),
      usedRange: `A1:${XLSX.utils.encode_col(Math.max(columnCount, 1) - 1)}${Math.max(sheet.rowCount ?? 0, maxRow, 1)}`,
      rowCount: Math.max(sheet.rowCount ?? 0, maxRow),
      columnCount,
      merges,
      columnWidths,
      cells,
    };
  });
  return { fileName, sheets, definedNames: [] };
}
