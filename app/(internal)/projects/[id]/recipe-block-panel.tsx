"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BudgetItem } from "@/lib/types";
import type { RecipeWithComponents } from "../production-recipe-actions";
import {
  resolveProductionTarget,
  recipeEffectiveQty,
  type RecipeQtyMode,
} from "@/lib/procurement/production-recipe";
import { remainingForItem } from "@/lib/procurement/weekly-plan-shared";
import type { BlockGroup } from "@/lib/procurement/weekly-plan-blocks";

interface Props {
  block: BlockGroup;
  recipes: RecipeWithComponents[];
  selectedRecipeId: string;
  onSelectRecipe: (id: string) => void;
  qtyMode: RecipeQtyMode;
  onQtyMode: (m: RecipeQtyMode) => void;
  qty: string;
  pct: string;
  reach: string;
  onQty: (v: string) => void;
  onPct: (v: string) => void;
  onReach: (v: string) => void;
  excludedIds: string[];
  executedQuantities: Record<string, number>;
  onApply: (block: BlockGroup, recipe: RecipeWithComponents) => void;
  onImport: () => void;
}

/**
 * Panel de receta dentro del editor del bloque (V3): objetivo físico de
 * producción en vez de +pp por partida. Muestra la traducción ANTES de
 * calcular; aplicar genera filas QUANTITY que siguen el pipeline estándar
 * (resumen → preview MRP → save). Sin motor propio.
 */
export function RecipeBlockPanel(props: Props) {
  const {
    block, recipes, selectedRecipeId, onSelectRecipe,
    qtyMode, onQtyMode, qty, pct, reach, onQty, onPct, onReach,
    excludedIds, executedQuantities, onApply, onImport,
  } = props;

  const childIds = new Set(block.children.map((c) => c.id));
  const options = recipes.filter((r) =>
    r.components.some((c) => childIds.has(c.budget_item_id))
  );
  const selected = options.find((r) => r.recipe.id === selectedRecipeId);
  const byItem = new Map<string, BudgetItem>(block.children.map((c) => [c.id, c]));

  const includedIds = new Set(
    (selected
      ? selected.components.map((c) => c.budget_item_id)
      : []
    ).filter(
      (id) =>
        block.children.some((c) => c.id === id) && !excludedIds.includes(id)
    )
  );
  const includedComps = (selected ? selected.components : [])
    .filter((c) => includedIds.has(c.budget_item_id))
    .map((c) => ({
      budget_item_id: c.budget_item_id,
      quantity_per_production_unit: Number(c.quantity_per_production_unit),
      unit: c.unit,
    }));
  const eff = selected
    ? recipeEffectiveQty({
        contractTotalQuantity: selected.recipe.contract_total_quantity,
        includedComponents: includedComps,
        executedByItem: Object.fromEntries(
          Object.entries(executedQuantities).filter(([id]) => includedIds.has(id))
        ),
        mode: qtyMode,
        qtyRaw: qty,
        pctRaw: pct,
        reachRaw: reach,
      })
    : { qty: null as number | null, progress: 0, hint: "" };
  const translation = selected
    ? {
        targetQty: eff.qty,
        progress: eff.progress,
        hint: eff.hint,
        targets:
          eff.qty !== null
            ? resolveProductionTarget(includedComps, eff.qty)
            : [],
      }
    : null;
  return (
    <div
      className="rounded-md border border-[var(--border)] bg-[var(--panel-2)]/50 p-2.5 space-y-2"
      data-testid={`receta-bloque-${block.code || "suelto"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Objetivo de producción (receta)
        </span>
        <button
          type="button"
          onClick={onImport}
          data-testid="importar-receta"
          className="h-7 px-2 rounded-md border border-dashed border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--panel-2)]"
        >
          + Importar receta
        </button>
      </div>
      {options.length === 0 ? (
        <p className="text-[11px] text-[var(--muted)]">
          Sin recetas para estas partidas. Importá la receta de la empresa para
          planificar por objetivo físico en vez de +pp por partida.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="min-w-0">
              <label className="block text-[11px] text-[var(--muted)]">Receta</label>
              <select
                value={selectedRecipeId}
                onChange={(e) => onSelectRecipe(e.target.value)}
                data-testid="receta-select"
                className="h-8 max-w-52 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-xs"
              >
                <option value="">Elegir receta…</option>
                {options.map((r) => (
                  <option key={r.recipe.id} value={r.recipe.id}>
                    {r.recipe.code} · {r.recipe.name}
                  </option>
                ))}
              </select>
            </div>
            {selected && (
              <div>
                <span className="block text-[11px] text-[var(--muted)]">Objetivo</span>
                <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[11px]">
                  {(["QTY", "PCT", "TO"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onQtyMode(m)}
                      data-testid={`receta-modo-${m}`}
                      className={`px-2 py-1 rounded-md ${
                        qtyMode === m
                          ? "bg-emerald-600 text-white font-semibold"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      {m === "QTY" ? "Cantidad" : m === "PCT" ? "% tramo" : "Llegar a"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selected && qtyMode === "QTY" && (
              <div>
                <label className="block text-[11px] text-[var(--muted)]">
                  Cuánto ({selected.recipe.production_unit})
                </label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={qty}
                  onChange={(e) => onQty(e.target.value)}
                  placeholder="0,4"
                  data-testid="receta-cantidad"
                  className="h-8 w-28 text-xs text-right"
                />
              </div>
            )}
            {selected && qtyMode === "PCT" && (
              <div>
                <label className="block text-[11px] text-[var(--muted)]">% del tramo</label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={pct}
                    onChange={(e) => onPct(e.target.value)}
                    placeholder="10"
                    data-testid="receta-porcentaje"
                    disabled={!selected.recipe.contract_total_quantity}
                    className="h-8 w-20 text-xs text-right"
                  />
                  <span className="text-[11px] text-[var(--muted)]">%</span>
                </div>
              </div>
            )}
            {selected && qtyMode === "TO" && (
              <div>
                <label className="block text-[11px] text-[var(--muted)]">
                  Llegar a ({selected.recipe.production_unit} acumulados)
                </label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={reach}
                  onChange={(e) => onReach(e.target.value)}
                  placeholder="5,0"
                  data-testid="receta-llegar"
                  className="h-8 w-28 text-xs text-right"
                />
              </div>
            )}
          </div>
          {selected && translation && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-[var(--muted)]">
                Avance estimado: <strong className="text-[var(--foreground)]">{translation.progress}</strong>{" "}
                {selected.recipe.production_unit}
                {selected.recipe.contract_total_quantity
                  ? ` · Tramo: ${Number(selected.recipe.contract_total_quantity).toLocaleString("es-PY")} ${selected.recipe.production_unit}`
                  : " · Sin tramo contractual: el % no convierte"}
              </div>
              {translation.hint && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300">{translation.hint}</div>
              )}
              {translation.targets.length > 0 && (
                <div className="rounded border border-dashed border-[var(--border)] p-2 space-y-1" data-testid="receta-traduccion">
                  {translation.targets.map((t) => {
                    const item = byItem.get(t.budget_item_id);
                    const remaining = remainingForItem(
                      Number(item?.quantity) || 0,
                      Number(executedQuantities[t.budget_item_id]) || 0
                    );
                    return (
                      <div key={t.budget_item_id} className="flex flex-wrap justify-between gap-2 text-[11px]">
                        <span className="text-[var(--foreground)]">
                          {item?.description ?? t.budget_item_id}
                        </span>
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                          {t.physical_quantity.toLocaleString("es-PY")} {t.unit}
                          {t.physical_quantity > remaining + 1e-9 && (
                            <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                              (limitado al remanente)
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button
                type="button"
                onClick={() => onApply(block, selected)}
                disabled={translation.targetQty === null}
                data-testid="aplicar-receta"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                Aplicar receta al bloque
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
