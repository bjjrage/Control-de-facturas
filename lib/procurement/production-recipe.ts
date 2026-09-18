import type { WeeklyPlanInputMode } from "@/lib/types";
import type { PreviewWeeklyPlanItemInput } from "./weekly-plan-shared";

// ---------------------------------------------------------------------------
// Receta constructiva (V3): unidad de producción → partidas físicas.
//
// Dos niveles que NO se mezclan:
//   resolveProductionTarget: receta → targets por partida (ESTE archivo)
//   calculateWeeklyPlanRequirements: targets → BOM/materiales (engine)
// ---------------------------------------------------------------------------

export interface RecipeComponentInput {
  budget_item_id: string;
  quantity_per_production_unit: number;
  unit: string;
}

export interface ResolvedProductionTarget {
  budget_item_id: string;
  physical_quantity: number;
  unit: string;
}

/**
 * Multiplicación determinista receta × objetivo. NO capa por remanente
 * (lo hace el engine con was_capped), NO calcula materiales.
 * target = 0,4 km × {subbase 1500, base 1100, asfalto 600} →
 * {600, 440, 240}. Componentes con qty<=0 se ignoran (fail-safe).
 */
export function resolveProductionTarget(
  components: RecipeComponentInput[],
  targetQuantity: number
): ResolvedProductionTarget[] {
  const t = Number(targetQuantity) || 0;
  if (t <= 0) return [];
  const out: ResolvedProductionTarget[] = [];
  for (const c of components ?? []) {
    const perUnit = Number(c.quantity_per_production_unit) || 0;
    if (!c.budget_item_id || perUnit <= 0) continue;
    out.push({
      budget_item_id: c.budget_item_id,
      physical_quantity: Number((t * perUnit).toFixed(4)),
      unit: c.unit,
    });
  }
  return out;
}

/**
 * Convierte % de tramo contractual a cantidad física. Fail-closed: sin
 * contract_total_quantity positiva NO hay conversión (null → pedir físico).
 */
export function blockPercentToProductionQuantity(
  contractTotalQuantity: number | null | undefined,
  percentPoints: number
): number | null {
  const total = Number(contractTotalQuantity);
  const pp = Number(percentPoints);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(pp) || pp <= 0) return null;
  return Number(((total * pp) / 100).toFixed(4));
}

/**
 * Estima el avance de producción ejecutado como cuello de botella:
 * min sobre componentes de (ejecutado / qty_por_unidad). Sin ejecución
 * registrada en un componente → 0 (no se inventa avance).
 * Solo informativa (para "quiero llegar a X"); el engine sigue mandando.
 */
export function estimateProductionProgress(
  components: RecipeComponentInput[],
  executedByItem: Record<string, number>
): number {
  let min: number | null = null;
  for (const c of components ?? []) {
    const perUnit = Number(c.quantity_per_production_unit) || 0;
    if (!c.budget_item_id || perUnit <= 0) continue;
    const exec = Number(executedByItem[c.budget_item_id]) || 0;
    const ratio = exec / perUnit;
    min = min === null ? ratio : Math.min(min, ratio);
  }
  if (min === null) return 0;
  return Number(Math.max(0, min).toFixed(4));
}

export type RecipeQtyMode = "QTY" | "PCT" | "TO";

export interface EffectiveRecipeQty {
  qty: number | null;
  progress: number;
  hint: string;
}

/**
 * Cantidad física objetivo efectiva según modo (pura, testeable):
 * - QTY: cantidad directa (>0).
 * - PCT: % del tramo contractual (null sin tramo → pedir físico, fail-closed).
 * - TO: llegar a X acumulado → X - avance estimado (null si inválido o ya superado).
 */
export function recipeEffectiveQty(args: {
  contractTotalQuantity: number | null | undefined;
  includedComponents: RecipeComponentInput[];
  executedByItem: Record<string, number>;
  mode: RecipeQtyMode;
  qtyRaw: string;
  pctRaw: string;
  reachRaw: string;
}): EffectiveRecipeQty {
  const { contractTotalQuantity, includedComponents, executedByItem, mode, qtyRaw, pctRaw, reachRaw } = args;
  const includedIds = new Set(includedComponents.map((c) => c.budget_item_id));
  const progress = estimateProductionProgress(
    includedComponents,
    Object.fromEntries(Object.entries(executedByItem).filter(([id]) => includedIds.has(id)))
  );
  if (mode === "QTY") {
    const q = parseFloat(qtyRaw);
    return { qty: q > 0 ? q : null, progress, hint: q > 0 ? "" : "Indicá cuántas unidades querés ejecutar." };
  }
  if (mode === "PCT") {
    const q = blockPercentToProductionQuantity(contractTotalQuantity, parseFloat(pctRaw));
    return {
      qty: q,
      progress,
      hint: q === null ? "Esta receta no tiene tramo contractual: indicá cantidad física." : "",
    };
  }
  const reach = parseFloat(reachRaw);
  if (!(reach > 0)) return { qty: null, progress, hint: "Indicá a cuánto querés llegar." };
  const target = Math.max(0, Number((reach - progress).toFixed(4)));
  return {
    qty: target > 0 ? target : null,
    progress,
    hint: target > 0 ? `Avance estimado ${progress} → objetivo +${target}.` : "Ya estás en o sobre ese avance.",
  };
}

/**
 * Targets listos para previewWeeklyPlanAction (modo QUANTITY físico).
 */
export function recipeToPreviewInputs(
  targets: ResolvedProductionTarget[],
  front: string
): PreviewWeeklyPlanItemInput[] {
  const label = front?.trim() ? front.trim() : null;
  return targets
    .filter((t) => t.physical_quantity > 0)
    .map((t) => ({
      budgetItemId: t.budget_item_id,
      frontLabel: label,
      inputMode: "QUANTITY" as WeeklyPlanInputMode,
      inputValue: t.physical_quantity,
    }));
}

export interface ImportCatalogItem {
  id: string;
  code: string;
  unit?: string | null;
}

export interface ImportRowInput {
  itemCode: string;
  quantityPerUnit: number;
  unit: string;
  /** Mapeo manual explícito (prevalece sobre el código Excel). */
  budgetItemId?: string | null;
}

export interface MappedImportRow {
  budgetItemId: string;
  quantityPerUnit: number;
  unit: string;
}

export interface ImportRowError {
  row: number;
  reason: string;
}

/**
 * Mapeo puro Excel → partidas (P0: el fix manual llega al server).
 * - budgetItemId explícito (mapeo manual UI) prevalece; se valida pertenencia.
 * - Sin manual: código EXACTO (trim); duplicado o inexistente → error.
 * - Sin fuzzy, sin inserts silenciosos. Duplicados en el Excel → error.
 */
export function resolveImportMapping(
  rows: ImportRowInput[],
  catalog: ImportCatalogItem[]
): { mapped: MappedImportRow[]; errors: ImportRowError[] } {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const byCode = new Map<string, ImportCatalogItem[]>();
  for (const c of catalog) {
    const key = String(c.code ?? "").trim();
    if (!key) continue;
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key)!.push(c);
  }
  const mapped: MappedImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();
  (rows ?? []).forEach((r, idx) => {
    const rowNo = idx + 1;
    const qty = Number(r.quantityPerUnit);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({ row: rowNo, reason: "Cantidad inválida." });
      return;
    }
    let itemId: string | null = null;
    if (r.budgetItemId) {
      // Manual explícito: debe existir en el catálogo del proyecto.
      if (!byId.has(r.budgetItemId)) {
        errors.push({ row: rowNo, reason: "La partida elegida manualmente no pertenece al proyecto." });
        return;
      }
      itemId = r.budgetItemId;
    } else {
      const code = String(r.itemCode ?? "").trim();
      if (!code) {
        errors.push({ row: rowNo, reason: "Código de partida vacío." });
        return;
      }
      const found = byCode.get(code) ?? [];
      if (found.length === 0) {
        errors.push({
          row: rowNo,
          reason: `Código ${code} no existe en el presupuesto (mapeá manual o corregí el Excel).`,
        });
        return;
      }
      if (found.length > 1) {
        errors.push({ row: rowNo, reason: `Código ${code} ambiguo (duplicado): elegí manual.` });
        return;
      }
      itemId = found[0].id;
    }
    if (seen.has(itemId)) {
      errors.push({ row: rowNo, reason: "Partida duplicada en el Excel." });
      return;
    }
    seen.add(itemId);
    const catalogUnit = byId.get(itemId)?.unit || null;
    mapped.push({
      budgetItemId: itemId,
      quantityPerUnit: qty,
      unit: String(r.unit ?? "").trim() || catalogUnit || "unid",
    });
  });
  return { mapped, errors };
}
