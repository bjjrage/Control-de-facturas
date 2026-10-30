import type { IWorkbookData, ICellData } from "@univerjs/presets";
import type { PlanillaColumn, PlanillaRow } from "./types";
import { newRowId, resolveFormulaTemplate } from "./grid-utils";

export const WORKSPACE_SHEET = "computo";

export function toWorkspaceBook(rows: PlanillaRow[], columns: PlanillaColumn[], id: string): IWorkbookData {
  const active = rows.filter(r => !r._deleted);
  const cellData: Record<number, Record<number, ICellData>> = {};
  const rowCount = Math.min(5000, Math.max(1000, active.length + 100));
  for (let index = 0; index < rowCount; index++) {
    const row = active[index]; const cells: Record<number, ICellData> = {};
    const legacy = row?._style;
    const colors: Record<string, string> = { red: "#f2685c", amber: "#f5a524", green: "#2dd4bf", blue: "#60a5fa", yellow: "#f5d66d" };
    const legacyStyle = legacy ? { ...(legacy.bold ? { bl: 1 as const } : {}), ...(legacy.align ? { ht: { left: 1 as const, center: 2 as const, right: 3 as const }[legacy.align] } : {}), ...(legacy.color ? { cl: { rgb: colors[legacy.color] ?? legacy.color } } : {}), ...(legacy.bg ? { bg: { rgb: colors[legacy.bg] ?? legacy.bg } } : {}) } : undefined;
    columns.forEach((column, col) => {
      const value = row?.[column.key];
      const formula = column.formulaTemplate ? resolveFormulaTemplate(column.formulaTemplate, index + 1) : row?._formulas?.[column.key];
      const styles = row?._cellStyles as Record<string, ICellData["s"]> | undefined;
      const style = styles?.[column.key] ?? legacyStyle;
      cells[col] = { ...(value != null ? { v: value as ICellData["v"] } : {}), ...(formula ? { f: formula } : {}), ...(style ? { s: style } : {}) };
    });
    if (row) cells[columns.length] = { v: row._rowId, t: 1 };
    cellData[index] = cells;
  }
  return { id, name: "Cómputo y presupuesto", appVersion: "1.0.2", locale: "esES", styles: {}, sheetOrder: [WORKSPACE_SHEET], sheets: {
    [WORKSPACE_SHEET]: { id: WORKSPACE_SHEET, name: "Cómputo", rowCount, columnCount: columns.length + 1, cellData,
      columnData: { ...Object.fromEntries(columns.map((c, i) => [i, { w: c.width ?? 120 }])), [columns.length]: { hd: 1 } },
    },
  } } as IWorkbookData;
}

/** IDs travel with complete rows, independently of their displayed position.
 * New identities are written back into the hidden metadata column by the host. */
export function fromWorkspaceBook(data: IWorkbookData, columns: PlanillaColumn[], base: PlanillaRow[], createId = newRowId): PlanillaRow[] {
  const sheet = data.sheets[WORKSPACE_SHEET];
  if (!sheet) throw new Error("Falta la hoja de cómputo.");
  const original = new Map(base.map(r => [r._rowId, r]));
  const seen = new Set<string>(); const rows: PlanillaRow[] = [];
  for (const [key, cells] of Object.entries(sheet.cellData ?? {})) {
    const storedId = typeof cells[columns.length]?.v === "string" ? String(cells[columns.length].v) : null;
    if (!columns.some((c, i) => !c.readOnly && c.type !== "readonly-numeric" && (cells[i]?.v != null || !!cells[i]?.f)) && !(storedId && original.has(storedId))) continue;
    const id = storedId ?? createId();
    if (!id.startsWith("new:") && !original.has(id)) throw new Error("La identidad no pertenece al borrador.");
    if (seen.has(id)) throw new Error("Hay identidades duplicadas. Deshacé la copia de filas completas y pegá sólo las columnas de trabajo.");
    seen.add(id); cells[columns.length] = { v: id, t: 1 };
    const row: PlanillaRow = { _rowId: id, _version: original.get(id)?._version ?? null, ...(original.get(id)?._style ? { _style: original.get(id)!._style } : {}), _formulas: {}, _cellStyles: {} };
    for (let i = 0; i < columns.length; i++) {
      const cell = cells[i]; const column = columns[i];
      row[column.key] = cell?.v ?? null;
      if (cell?.f) row._formulas![column.key] = cell.f;
      if (cell?.s) (row._cellStyles as Record<string, unknown>)[column.key] = typeof cell.s === "string" ? data.styles[cell.s] : cell.s;
    }
    rows.push(row);
    if (!Number.isInteger(Number(key))) throw new Error("Fila inválida.");
  }
  for (const row of base) if (!row._rowId.startsWith("new:") && !seen.has(row._rowId)) rows.push({ _rowId: row._rowId, _version: row._version, _deleted: true });
  return rows;
}
