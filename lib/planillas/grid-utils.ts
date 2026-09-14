/**
 * Lógica pura de identidad/referencias de PlanillaGrid, separada del
 * componente React para poder testearla sin montar Handsontable (que
 * requiere DOM real, no solo jsdom en algunos casos) — ver REGLA #8.
 */

/** Prefijo que distingue una fila nueva (nunca persistida) de una fila real
 * del dominio. NUNCA se confía en la posición para esta distinción. */
export const NEW_ROW_PREFIX = "new:";

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
