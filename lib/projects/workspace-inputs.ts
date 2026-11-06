import { CellValueType, getNumfmtParseValueFilter, type ICellData } from "@univerjs/core";

const numericColumns: Record<string, readonly number[]> = {
  computo: [4, 5, 6, 7, 8], presupuesto: [6], apu: [5, 6, 7], cronograma: [5, 6, 9],
};

/** Use Univer's Spanish number parser at typed numeric inputs only. Its
 * clipboard path skips parsing when pasted cells carry a number format;
 * therefore a copied decimal such as "1,2" can otherwise become text.
 * Codes, text, explicit text cells, formulas and rich text stay untouched. */
export function normalizeWorkspaceNumbers(sheet: string, matrix: unknown): void {
  const columns = numericColumns[sheet];
  if (!columns || !matrix || typeof matrix !== "object") return;
  for (const [rowIndex, row] of Object.entries(matrix)) {
    if (Number(rowIndex) < 3 || !row || typeof row !== "object") continue;
    for (const [columnIndex, value] of Object.entries(row)) {
      if (!columns.includes(Number(columnIndex)) || !value || typeof value !== "object") continue;
      const cell = value as ICellData;
      if (cell.f || cell.p || cell.t === CellValueType.FORCE_STRING || typeof cell.v !== "string") continue;
      const text = cell.v.trim();
      if (!/^[+-]?(?:\d+(?:,\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?)$/.test(text)) continue;
      // The grouping shape was checked above. Univer's parser accepts decimal
      // commas but not every grouped Spanish number in clipboard mutations.
      const parsed = getNumfmtParseValueFilter(text.replace(/\./g, ""), { locale: "es" });
      if (typeof parsed?.v === "number" && Number.isFinite(parsed.v)) { cell.v = parsed.v; cell.t = CellValueType.NUMBER; }
    }
  }
}
