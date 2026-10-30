import { z } from "zod";
import type { CanonicalImportCandidate } from "./canonical-import";
import type { PlanillaRow } from "@/lib/planillas/types";

export const importDraftSchema = z.object({
  rows: z.array(z.object({
    _rowId: z.string(), code: z.string(), description: z.string(), unit: z.string().nullable(),
    quantity: z.number().finite().nonnegative().nullable(), unit_price: z.number().finite().nonnegative().nullable(),
    _formulas: z.record(z.string(), z.string()).optional(),
  })).max(5000),
  name: z.string().max(500), code: z.string().max(120),
  regime: z.enum(["PUBLIC_WORK", "PRIVATE_WORK", "OTHER", ""]),
  referenceQuantities: z.boolean(), applySchedule: z.boolean(), applyCertificate: z.boolean(),
  applyStaff: z.boolean(), applyWeather: z.boolean(), applyExecution: z.boolean(),
});
export type ImportWorkspaceDraft = z.infer<typeof importDraftSchema>;

export function importRowId(item: CanonicalImportCandidate["budgetItems"][number]) {
  return JSON.stringify([item.source.sheet, item.source.row, item.code]);
}

export function importRows(candidate: CanonicalImportCandidate): PlanillaRow[] {
  const recipeUnits = new Map(candidate.linkedRecipes?.recipes.map(recipe => [recipe.budgetCode, recipe.unit]) ?? []);
  return candidate.budgetItems.map(item => ({ _rowId: importRowId(item), code: item.code ?? "", description: item.description,
    unit: recipeUnits.get(item.code ?? "") ?? item.unit, quantity: item.quantity, unit_price: item.unitPrice, subtotal: item.subtotal ?? null }));
}

/** The reviewed draft can change measurements and adopted prices, never the
 * source identity, unit or recipe correspondence. It never edits the XLSX. */
export function validateImportDraft(raw: unknown, candidate: CanonicalImportCandidate): ImportWorkspaceDraft {
  const draft = importDraftSchema.parse(raw);
  const originals = new Map(importRows(candidate).map(row => [row._rowId, row]));
  if (draft.rows.length !== originals.size) throw new Error("Conservá todas las partidas importadas; las altas y bajas se hacen en la obra creada.");
  const seen = new Set<string>();
  for (const row of draft.rows) {
    const original = originals.get(row._rowId);
    if (!original || seen.has(row._rowId) || row.code !== original.code || row.description !== original.description || row.unit !== original.unit) {
      throw new Error("No se puede cambiar la identidad, descripción o unidad de una partida durante la vinculación. Editá cantidades y precios.");
    }
    seen.add(row._rowId);
    if (Object.entries(row._formulas ?? {}).some(([key, formula]) => !["quantity", "unit_price", "subtotal"].includes(key) || !formula.startsWith("="))) {
      throw new Error("El borrador contiene una fórmula fuera de las columnas de cálculo.");
    }
  }
  return draft;
}

export function applyImportDraft(candidate: CanonicalImportCandidate, raw: unknown): CanonicalImportCandidate {
  if (!raw || typeof raw !== "object" || !("rows" in raw)) return candidate;
  const draft = validateImportDraft(raw, candidate);
  const rows = new Map(draft.rows.map(row => [row._rowId, row]));
  const budgetItems = candidate.budgetItems.map(item => {
    const row = rows.get(importRowId(item))!;
    return { ...item, quantity: row.quantity, unitPrice: row.unit_price,
      subtotal: row.quantity === null || row.unit_price === null ? null : row.quantity * row.unit_price };
  });
  return { ...candidate, budgetItems, budgetTotal: budgetItems.reduce((n, item) => n + (item.subtotal ?? 0), 0) };
}

export type WorkspaceMaterial = {
  key: string; description: string; unit: string; links: { rowId: string; code: string; consumption: number }[];
};
export function sourceMaterials(candidate: CanonicalImportCandidate): WorkspaceMaterial[] {
  const rows = new Map(candidate.budgetItems.map(item => [item.code, importRowId(item)]));
  const materials = new Map<string, WorkspaceMaterial>();
  for (const recipe of candidate.linkedRecipes?.recipes ?? []) for (const line of recipe.lines) {
    if (line.kind !== "MATERIAL") continue;
    const rowId = rows.get(recipe.budgetCode);
    if (!rowId) continue;
    // Same explicit source code, description and unit only: no fuzzy merges.
    const key = JSON.stringify([line.code, line.description, line.unit]);
    const material = materials.get(key) ?? { key, description: line.description, unit: line.unit, links: [] };
    material.links.push({ rowId, code: recipe.budgetCode, consumption: line.quantity });
    materials.set(key, material);
  }
  return [...materials.values()];
}

export function materialNeed(material: WorkspaceMaterial, rows: PlanillaRow[]): number | null {
  const quantities = new Map(rows.filter(row => !row._deleted).map(row => [row._rowId, row.quantity]));
  let total = 0;
  for (const link of material.links) {
    const quantity = quantities.get(link.rowId);
    if (typeof quantity !== "number" || !Number.isFinite(quantity)) return null;
    total += quantity * link.consumption;
  }
  return total;
}
