import { z } from "zod";

// Keep numbers typed across the server boundary. No locale conversion in writes.
export const budgetWorkspaceValues = z.object({
  description: z.string().trim().min(1, "La descripción es obligatoria.").max(2000),
  unit: z.string().trim().max(40).nullable(),
  quantity: z.number().finite().nonnegative().max(999999999999.9999).refine(value => Number(value.toFixed(4)) === value, "La cantidad admite hasta 4 decimales.").nullable(),
  unitPrice: z.number().finite().nonnegative().max(99999999999999.99).refine(value => Number(value.toFixed(2)) === value, "El precio admite hasta 2 decimales.").nullable(),
}).strict();

export type BudgetWorkspaceValues = z.infer<typeof budgetWorkspaceValues>;
export type BudgetWorkspaceRow = BudgetWorkspaceValues & {
  id: string;
  code: string;
  subtotal: number;
};
export type BudgetWorkspaceChange = {
  id: string;
  expected: BudgetWorkspaceValues;
  next: BudgetWorkspaceValues;
};
export const workspaceChangeSchema = z.object({
  id: z.string().uuid(), expected: budgetWorkspaceValues.extend({
    description: z.string().min(1).max(2000), unit: z.string().max(40).nullable(),
  }), next: budgetWorkspaceValues,
}).strict();

export const workspaceEditableKeys = ["description", "unit", "quantity", "unitPrice"] as const;
export type WorkspaceEditableKey = typeof workspaceEditableKeys[number];

export function workspaceValues(row: BudgetWorkspaceValues): BudgetWorkspaceValues {
  return { description: row.description, unit: row.unit, quantity: row.quantity, unitPrice: row.unitPrice };
}

export function sameWorkspaceValues(a: BudgetWorkspaceValues, b: BudgetWorkspaceValues): boolean {
  return workspaceEditableKeys.every(key => a[key] === b[key]);
}

export function rebaseWorkspaceValues(expected: BudgetWorkspaceValues, next: BudgetWorkspaceValues, current: BudgetWorkspaceValues): BudgetWorkspaceValues {
  const merged = workspaceValues(current);
  for (const key of workspaceEditableKeys) {
    if (next[key] !== expected[key]) Object.assign(merged, { [key]: next[key] });
  }
  return merged;
}

// This editor explicitly accepts ungrouped decimals (dot or comma). A pasted
// formatted thousands separator is ambiguous, so refuse it rather than guess.
export function parseWorkspaceNumber(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) throw new Error("Usá números sin separadores de miles; decimal con coma o punto.");
  const parts = value.split(/[.,]/);
  if (parts[1]?.length === 3 && Number(parts[0]) !== 0) {
    throw new Error(`«${value}» es ambiguo. Quitá el separador de miles o agregá un decimal (ej.: 1,2340).`);
  }
  const number = Number(value.replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new Error("El número debe ser finito y mayor o igual a cero.");
  return number;
}

export function parseWorkspaceCell(key: WorkspaceEditableKey, text: string): string | number | null {
  if (key === "quantity" || key === "unitPrice") return parseWorkspaceNumber(text);
  const value = text.trim();
  if (key === "description" && !value) throw new Error("La descripción es obligatoria.");
  if (value.length > (key === "unit" ? 40 : 2000)) throw new Error("El texto es demasiado largo.");
  return value || null;
}

// Validate the whole rectangle before staging anything. Visible row order is
// intentional: pasting while filtered never touches hidden rows.
export function pasteWorkspaceRange(rows: BudgetWorkspaceRow[], startRow: number, startColumn: string, text: string): BudgetWorkspaceRow[] {
  const start = workspaceEditableKeys.indexOf(startColumn as WorkspaceEditableKey);
  if (start < 0) throw new Error("Pegá desde Descripción, Unidad, Cantidad o P. unitario. Los códigos y totales están protegidos.");
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(line => line.split("\t"));
  if (startRow < 0 || startRow + lines.length > rows.length) throw new Error("El rango supera las partidas visibles. No se aplicó ningún cambio.");
  const width = lines[0].length;
  if (lines.some(line => line.length !== width) || start + width > workspaceEditableKeys.length) throw new Error("El rango debe ser rectangular y contener solo columnas editables.");
  const result = [...rows];
  lines.forEach((line, index) => {
    const row = { ...result[startRow + index] };
    line.forEach((text, offset) => {
      const key = workspaceEditableKeys[start + offset];
      try { Object.assign(row, { [key]: parseWorkspaceCell(key, text) }); }
      catch (error) { throw new Error(`Fila ${startRow + index + 1}, ${key === "quantity" ? "Cantidad" : key === "unitPrice" ? "P. unitario" : key}: ${(error as Error).message}`); }
    });
    budgetWorkspaceValues.parse(workspaceValues(row));
    result[startRow + index] = row;
  });
  return result;
}
