import type { PlanillaColumn } from "./types";

/**
 * Lógica pura de identidad/referencias de PlanillaGrid, separada del
 * componente React para poder testearla sin montar Handsontable (que
 * requiere DOM real, no solo jsdom en algunos casos) — ver REGLA #8.
 */

/** Prefijo que distingue una fila nueva (nunca persistida) de una fila real
 * del dominio. NUNCA se confía en la posición para esta distinción. */
export const NEW_ROW_PREFIX = "new:";
export const MIN_PLANILLA_BLANK_ROWS = 20;

export function isNewRowId(rowId: string): boolean {
  return rowId.startsWith(NEW_ROW_PREFIX);
}

export function newRowId(): string {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${NEW_ROW_PREFIX}${uuid}`;
}

/** Índice de columna 0-based -> letra A1 (0->A, 25->Z, 26->AA, ...). */
export function colIndexToLetter(index0: number): string {
  let n = index0;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Resuelve una plantilla de fórmula (ej. "=D{row}*E{row}") contra un número
 * de fila 1-based. String, no función — ver PlanillaColumn.formulaTemplate
 * en lib/planillas/types.ts sobre por qué no es una función. */
export function resolveFormulaTemplate(template: string, row1Based: number): string {
  return template.replace(/\{row\}/g, String(row1Based));
}

/**
 * Siembra filas editables antes de montar Handsontable. Siempre deja al menos
 * `minimum` filas para una planilla vacía y una fila adicional si ya hay
 * suficientes, que queda como reserva al final de la grilla.
 */
export function seedRowsWithBlankFloor<Row>(
  initialRows: readonly Row[],
  createBlankRow: (rowIndex0: number) => Row,
  minimum = MIN_PLANILLA_BLANK_ROWS
): Row[] {
  const rows = [...initialRows];
  const blanksNeeded = Math.max(1, minimum - rows.length);
  for (let i = 0; i < blanksNeeded; i++) rows.push(createBlankRow(rows.length));
  return rows;
}

/** Fila nueva sin valores editables: no representa una partida persistible. */
export function isBlankNewPlanillaRow(
  row: Record<string, unknown>,
  columns: readonly Pick<PlanillaColumn, "key" | "formulaTemplate">[]
): boolean {
  return columns.every((column) => {
    if (column.formulaTemplate) return true;
    const value = row[column.key];
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  });
}

/** Omite solo filas nuevas completamente vacías; las parcialmente editadas
 * continúan al servidor para que la validación de dominio pueda rechazarlas. */
export function omitBlankNewPlanillaRows<Row extends { _rowId: string } & Record<string, unknown>>(
  rows: readonly Row[],
  columns: readonly Pick<PlanillaColumn, "key" | "formulaTemplate">[]
): Row[] {
  return rows.filter((row) => !isNewRowId(row._rowId) || !isBlankNewPlanillaRow(row, columns));
}

export function formatPlanillaFilterValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(vacío)";
  return String(value);
}

export function matchesPlanillaColumnFilters(
  row: Record<string, unknown>,
  allowedValuesByColumn: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  return Array.from(allowedValuesByColumn.entries()).every(([columnKey, allowedValues]) =>
    allowedValues.has(formatPlanillaFilterValue(row[columnKey]))
  );
}

export function mapFilterBarHeaderWidths(
  headerWidths: readonly number[],
  columnKeys: readonly string[]
): { rowHeaderWidth: number; columns: Array<{ key: string; width: number }> } | null {
  if (headerWidths.length === 0) return null;
  return {
    rowHeaderWidth: headerWidths[0],
    columns: columnKeys.flatMap((key, index) => {
      const width = headerWidths[index + 1];
      return width === undefined ? [] : [{ key, width }];
    }),
  };
}
