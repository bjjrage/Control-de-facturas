import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveProductionTarget,
  blockPercentToProductionQuantity,
  estimateProductionProgress,
  recipeToPreviewInputs,
} from "../lib/procurement/production-recipe";
import { calculateWeeklyPlanRequirements } from "../lib/procurement/weekly-plan-engine";
import { toEngineTargets } from "../lib/procurement/weekly-plan-shared";
import type { BudgetItem } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function mkItem(over: Partial<BudgetItem> & { id: string }): BudgetItem {
  return {
    project_id: "proj-mrp",
    parent_id: null,
    code: "X",
    description: "Item",
    unit: "t",
    quantity: 10000,
    unit_price: 1000,
    subtotal: 0,
    sort_order: 0,
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    depends_on: null,
    quantity_per_unit: null,
    material_requirement: "NO_MATERIAL",
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  } as BudgetItem;
}

// Receta RUTA TIPO A por KM (fixture conceptual del Jenny §23).
const RUTA = [
  { budget_item_id: "it-subbase", quantity_per_production_unit: 1500, unit: "t" },
  { budget_item_id: "it-base", quantity_per_production_unit: 1100, unit: "t" },
  { budget_item_id: "it-asfalto", quantity_per_production_unit: 600, unit: "t" },
  { budget_item_id: "it-emulsion", quantity_per_production_unit: 4000, unit: "l" },
];

// ---------------------------------------------------------------------------
// TEST A: 1 km recipe × 0,4 km → 600 / 440 / 240 (+ emulsión 1600)
// ---------------------------------------------------------------------------
describe("TEST A. resolveProductionTarget: receta × objetivo físico", () => {
  it("0,4 km × {1500, 1100, 600, 4000} → 600, 440, 240, 1600", () => {
    const out = resolveProductionTarget(RUTA, 0.4);
    expect(out.length).toBe(4);
    const byId = Object.fromEntries(out.map((o) => [o.budget_item_id, o.physical_quantity]));
    expect(byId["it-subbase"]).toBe(600);
    expect(byId["it-base"]).toBe(440);
    expect(byId["it-asfalto"]).toBe(240);
    expect(byId["it-emulsion"]).toBe(1600);
  });

  it("target <= 0 o componentes inválidos → vacío (sin inventar)", () => {
    expect(resolveProductionTarget(RUTA, 0)).toEqual([]);
    expect(resolveProductionTarget(RUTA, -2)).toEqual([]);
    expect(
      resolveProductionTarget(
        [{ budget_item_id: "", quantity_per_production_unit: 5, unit: "t" }],
        1
      )
    ).toEqual([]);
  });

  it("los targets fluyen al engine como QUANTITY físico (mismo motor)", () => {
    const items = [
      mkItem({ id: "it-subbase", code: "2.1", description: "Subbase", unit: "t" }),
      mkItem({ id: "it-base", code: "2.2", description: "Base", unit: "t" }),
      mkItem({ id: "it-asfalto", code: "2.3", description: "Asfalto", unit: "t" }),
    ];
    const inputs = recipeToPreviewInputs(resolveProductionTarget(RUTA.slice(0, 3), 0.4), "Tramo 1");
    expect(inputs.every((i) => i.inputMode === "QUANTITY")).toBe(true);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-mrp",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: items,
      executed_quantities_by_item: {},
      targets: toEngineTargets(inputs),
      materials_by_item: {},
      stock_and_inbound: {},
    });
    const byId = Object.fromEntries(calc.items.map((i) => [i.budget_item_id, i.target_quantity]));
    expect(byId).toMatchObject({ "it-subbase": 600, "it-base": 440, "it-asfalto": 240 });
  });
});

// ---------------------------------------------------------------------------
// TEST B: 10% de tramo de 8 km → 0,8 km → recipe × 0,8
// ---------------------------------------------------------------------------
describe("TEST B. % de tramo contractual → físico → receta", () => {
  it("10% de 8 km = 0,8 km y produce 1200/880/480", () => {
    const qty = blockPercentToProductionQuantity(8, 10);
    expect(qty).toBe(0.8);
    const out = resolveProductionTarget(RUTA.slice(0, 3), qty!);
    const byId = Object.fromEntries(out.map((o) => [o.budget_item_id, o.physical_quantity]));
    expect(byId).toMatchObject({ "it-subbase": 1200, "it-base": 880, "it-asfalto": 480 });
  });
});

// ---------------------------------------------------------------------------
// TEST C: sin total contractual, % bloquea y pide físico (fail-closed)
// ---------------------------------------------------------------------------
describe("TEST C. Sin tramo contractual el % no convierte (fail-closed)", () => {
  it("null/0/negativo → null (pedir cantidad física)", () => {
    expect(blockPercentToProductionQuantity(null, 10)).toBeNull();
    expect(blockPercentToProductionQuantity(undefined, 10)).toBeNull();
    expect(blockPercentToProductionQuantity(0, 10)).toBeNull();
    expect(blockPercentToProductionQuantity(-5, 10)).toBeNull();
    expect(blockPercentToProductionQuantity(8, 0)).toBeNull();
  });

  it("la UI del bloque-receta exige físico cuando no hay tramo (source)", () => {
    const ui = readSource("app/(internal)/projects/[id]/recipe-block-panel.tsx");
    // El modo receta ofrece cantidad física siempre; % solo con tramo.
    expect(ui).toContain("contract_total_quantity");
    expect(ui).toContain("Sin tramo contractual");
    const section = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(section).toContain("RecipeBlockPanel");
  });
});

// ---------------------------------------------------------------------------
// Progreso estimado (cuello de botella) para "quiero llegar a X"
// ---------------------------------------------------------------------------
describe("Avance de producción estimado (informativo, cuello de botella)", () => {
  it("min(ejecutado/qty_por_unidad): 3000/1500=2 vs 1100/1100=1 → 1 km", () => {
    expect(
      estimateProductionProgress(RUTA.slice(0, 2), { "it-subbase": 3000, "it-base": 1100 })
    ).toBe(1);
  });

  it("sin ejecución en un componente → 0 (no inventa avance)", () => {
    expect(estimateProductionProgress(RUTA.slice(0, 2), { "it-subbase": 99999 })).toBe(0);
    expect(estimateProductionProgress([], {})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tablas nuevas existen con RLS (presencia real en migración)
// ---------------------------------------------------------------------------
describe("Modelo receta: migración forward-only con RLS", () => {
  const mig = () =>
    readSource("supabase/migrations/20260917000004_production_recipes.sql");

  it("crea production_recipes + components con checks y RLS tenant", () => {
    expect(mig()).toContain("CREATE TABLE IF NOT EXISTS public.production_recipes");
    expect(mig()).toContain("CREATE TABLE IF NOT EXISTS public.production_recipe_components");
    expect(mig()).toContain("quantity_per_production_unit NUMERIC(18,4) NOT NULL CHECK (quantity_per_production_unit > 0)");
    expect(mig()).toContain("current_empresa_id()");
    expect(mig()).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("la receta NO copia precios ni materiales (solo unidad→partidas)", () => {
    const src = mig();
    expect(src).not.toContain("unit_price");
    expect(src).not.toContain("producto_id");
    expect(src).not.toContain("costo");
  });
});

// ---------------------------------------------------------------------------
// P0. El mapeo manual de la UI llega al server (nunca fantasma)
// ---------------------------------------------------------------------------
describe("P0. Manual mapping wired end-to-end", () => {
  it("resolveImportMapping: budgetItemId manual prevalece sobre código erróneo", async () => {
    const { resolveImportMapping } = await import("../lib/procurement/production-recipe");
    const catalog = [
      { id: "id-ok", code: "02.1" },
      { id: "id-other", code: "02.9" },
    ];
    const { mapped, errors } = resolveImportMapping(
      [{ itemCode: "02.9", quantityPerUnit: 5, unit: "t", budgetItemId: "id-ok" }],
      catalog
    );
    expect(errors).toEqual([]);
    expect(mapped.length).toBe(1);
    expect(mapped[0].budgetItemId).toBe("id-ok");
  });

  it("resolveImportMapping: manual a item inexistente bloquea", async () => {
    const { resolveImportMapping } = await import("../lib/procurement/production-recipe");
    const { mapped, errors } = resolveImportMapping(
      [{ itemCode: "02.1", quantityPerUnit: 5, unit: "t", budgetItemId: "id-ghost" }],
      [{ id: "id-ok", code: "02.1" }]
    );
    expect(mapped).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it("server usa resolveImportMapping y dialog envía budgetItemId (fuente)", () => {
    const src = readSource("app/(internal)/projects/production-recipe-actions.ts");
    expect(src).toContain("resolveImportMapping");
    const dlg = readSource("app/(internal)/projects/[id]/import-recipe-dialog.tsx");
    expect(dlg).toContain("budgetItemId: explicitId");
  });
});
