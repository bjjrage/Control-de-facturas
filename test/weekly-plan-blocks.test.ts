import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  codeSegments,
  isDescendantCode,
  buildBlockGroups,
  blockSelectionTargets,
  blockWeightedProgress,
  aggregateMaterialsByProduct,
} from "../lib/procurement/weekly-plan-blocks";
import { toEngineTargets } from "../lib/procurement/weekly-plan-shared";
import { calculateWeeklyPlanRequirements } from "../lib/procurement/weekly-plan-engine";
import type { BudgetItem } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function mkItem(over: Partial<BudgetItem> & { id: string }): BudgetItem {
  return {
    project_id: "proj-block",
    parent_id: null,
    code: "X",
    description: "Item",
    unit: "m3",
    quantity: 0,
    unit_price: 0,
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

// Bloque canónico del Jenny: padre por parent_id + hijas ejecutables.
const fundParent = mkItem({ id: "b-parent", code: "2", description: "FUNDACIONES", unit: null as any, quantity: null as any, unit_price: null as any, sort_order: 1 });
const fund21 = mkItem({ id: "b-21", parent_id: "b-parent", code: "2.1", description: "Hormigón ciclópeo", unit: "m3", quantity: 100, unit_price: 1000000, sort_order: 2, material_requirement: "NO_MATERIAL" });
const fund22 = mkItem({ id: "b-22", parent_id: "b-parent", code: "2.2", description: "Acero de refuerzo", unit: "kg", quantity: 1000, unit_price: 20000, sort_order: 3, material_requirement: "NO_MATERIAL" });
const fund23 = mkItem({ id: "b-23", parent_id: "b-parent", code: "2.3", description: "Encofrado", unit: "m2", quantity: 200, unit_price: 150000, sort_order: 4, material_requirement: "NO_MATERIAL" });

// ---------------------------------------------------------------------------
// Jerarquía: parent_id canónico + fallback por código sin confusiones
// ---------------------------------------------------------------------------
describe("Jerarquía de bloques: parent_id primero, código como fallback seguro", () => {
  it("agrupa hijas con parent_id bajo el padre (no ejecutable)", () => {
    const groups = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    expect(groups.length).toBe(1);
    expect(groups[0].key).toBe("id:b-parent");
    expect(groups[0].description).toBe("FUNDACIONES");
    expect(groups[0].isVirtual).toBe(false);
    expect(groups[0].children.map((c) => c.code)).toEqual(["2.1", "2.2", "2.3"]);
  });

  it("NO confunde 2 con 20 ni 2.1 con 2.10 (segmentos, no prefijo ingenuo)", () => {
    expect(isDescendantCode("20", "2")).toBe(false);
    expect(isDescendantCode("2.10", "2.1")).toBe(false);
    expect(isDescendantCode("2.1", "2")).toBe(true);
    expect(isDescendantCode("01.01", "01")).toBe(true);
    expect(isDescendantCode("2", "2")).toBe(false); // estricto: no es su propio hijo
    expect(isDescendantCode("2.3.1", "2")).toBe(true);
    expect(codeSegments(" 02.10 ")).toEqual(["02", "10"]);
  });

  it("huérfanas con código jerárquico se agrupan por raíz sin parent físico", () => {
    const a = mkItem({ id: "o-101", code: "10.1", description: "Carpintería", unit: "m2", quantity: 95, unit_price: 1000, sort_order: 1 });
    const b = mkItem({ id: "o-102", code: "10.2", description: "Vidrios", unit: "m2", quantity: 40, unit_price: 2000, sort_order: 2 });
    const groups = buildBlockGroups([a, b]);
    expect(groups.length).toBe(1);
    expect(groups[0].key).toBe("root:10");
    expect(groups[0].isVirtual).toBe(true);
    expect(groups[0].description).toBe("Rubro 10");
    expect(groups[0].children.length).toBe(2);
  });

  it("cada ejecutable pertenece a exactamente un bloque (partición)", () => {
    const flat = mkItem({ id: "f-1", code: "GLOBAL", description: "Limpieza", unit: "gl", quantity: 1, unit_price: 5000, sort_order: 5 });
    const groups = buildBlockGroups([fundParent, fund21, fund22, fund23, flat]);
    const seen = groups.flatMap((g) => g.children.map((c) => c.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(["b-21", "b-22", "b-23", "f-1"].sort());
    expect(groups.some((g) => g.key === "flat" && g.description === "Partidas sin rubro")).toBe(true);
  });

  it("avance ponderado del bloque por valor contractual", () => {
    const groups = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    // Ejecutado: 50% de 2.1 (50m3 x 1M = 50M de 150M totales ≈ 33.33% + resto 0)
    const p = blockWeightedProgress(groups[0], { "b-21": 50 });
    expect(p.contractualValue).toBe(100 * 1000000 + 1000 * 20000 + 200 * 150000);
    expect(p.currentPct).toBeCloseTo((50 * 1000000) / p.contractualValue * 100, 2);
  });
});

// ---------------------------------------------------------------------------
// A. +10 pp del bloque → 10 m³ / 100 kg / 20 m²
// ---------------------------------------------------------------------------
describe("A. Semántica +pp del bloque: +N pp en cada hija seleccionada", () => {
  it("FUNDACIONES +10pp → 10 m³, 100 kg, 20 m² (vía el mismo engine)", () => {
    const [block] = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    const local = blockSelectionTargets(block, { pp: 10, front: "Sector A", excludedIds: [], overrides: {} });
    expect(local.length).toBe(3);
    expect(local.every((t) => t.inputMode === "CONTRACT_PERCENTAGE_POINTS" && t.inputValue === 10)).toBe(true);

    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-block",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [fund21, fund22, fund23],
      executed_quantities_by_item: {},
      targets: toEngineTargets(local),
      materials_by_item: {},
      stock_and_inbound: {},
    });
    const byId = Object.fromEntries(calc.items.map((i) => [i.budget_item_id, i]));
    expect(byId["b-21"].target_quantity).toBe(10);
    expect(byId["b-22"].target_quantity).toBe(100);
    expect(byId["b-23"].target_quantity).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// B. Remanente 5% → cap + "limitado", nunca excede contrato
// ---------------------------------------------------------------------------
describe("B. Capping por remanente en modo bloque", () => {
  it("hija con 5% remanente: bloque +10pp → cap a 5% con was_capped", () => {
    const [block] = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    const local = blockSelectionTargets(block, { pp: 10, front: "Sector A", excludedIds: [], overrides: {} });
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-block",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [fund21, fund22, fund23],
      // 2.1 ejecutada al 95%: remanente 5 m³ de 100
      executed_quantities_by_item: { "b-21": 95 },
      targets: toEngineTargets(local),
      materials_by_item: {},
      stock_and_inbound: {},
    });
    const item21 = calc.items.find((i) => i.budget_item_id === "b-21")!;
    expect(item21.target_quantity).toBe(5);
    expect(item21.was_capped).toBe(true);
    expect(item21.target_quantity).toBeLessThanOrEqual(5);
    // Las demás intactas
    expect(calc.items.find((i) => i.budget_item_id === "b-22")!.target_quantity).toBe(100);
  });

  it("la UI muestra 'limitado' cuando hay capping", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("limitado al remanente");
  });
});

// ---------------------------------------------------------------------------
// C. Excluir 2.3 → el engine recibe solo 2.1 + 2.2
// ---------------------------------------------------------------------------
describe("C. Exclusión de partidas del bloque", () => {
  it("desmarcar 2.3 excluye sus targets del array al engine", () => {
    const [block] = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    const local = blockSelectionTargets(block, { pp: 10, front: "Sector A", excludedIds: ["b-23"], overrides: {} });
    expect(local.map((t) => t.budgetItemId).sort()).toEqual(["b-21", "b-22"]);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-block",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [fund21, fund22, fund23],
      executed_quantities_by_item: {},
      targets: toEngineTargets(local),
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// D. BOM agregado: stock/inbound se descuentan una sola vez
// ---------------------------------------------------------------------------
describe("D. Agregado de materiales del bloque sin doble conteo", () => {
  const cement = { producto_id: "prod-cem", producto_nombre: "Cemento", unidad_medida: "bolsas", cantidad_por_unidad_ejecutada: 7, desperdicio_pct: 0, costo_unitario: 70000 };
  const bom = {
    "b-21": [{ ...cement, budget_item_id: "b-21" }],
    "b-22": [{ ...cement, budget_item_id: "b-22", cantidad_por_unidad_ejecutada: 0.5 }],
    "b-23": [{ ...cement, budget_item_id: "b-23", cantidad_por_unidad_ejecutada: 2 }],
  };

  it("demanda agregada 70+50+40=160, stock 100, inbound 40, faltante 20", () => {
    const [block] = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    const local = blockSelectionTargets(block, { pp: 10, front: "Sector A", excludedIds: [], overrides: {} });
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-block",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [fund21, fund22, fund23],
      executed_quantities_by_item: {},
      targets: toEngineTargets(local),
      materials_by_item: bom as any,
      stock_and_inbound: { "prod-cem": { producto_id: "prod-cem", stock_disponible: 100, oc_inbound: 40 } },
    });
    // 10m³×7=70, 100kg×0.5=50, 20m²×2=40 → 160 total
    expect(calc.total_material_consumption_value).toBe(160 * 70000);
    expect(calc.total_covered_by_stock_value).toBe(100 * 70000);
    expect(calc.total_covered_by_inbound_value).toBe(40 * 70000);
    expect(calc.total_additional_cash_required).toBe(20 * 70000);

    const agg = aggregateMaterialsByProduct(calc);
    expect(agg.length).toBe(1);
    expect(agg[0].requerido).toBe(160);
    expect(agg[0].cubierto_stock).toBe(100);
    expect(agg[0].cubierto_inbound).toBe(40);
    expect(agg[0].faltante).toBe(20);
    expect(agg[0].caja).toBe(20 * 70000);
  });
});

// ---------------------------------------------------------------------------
// E. Partida sin BOM en el bloque: warning agregado, sin falsa caja 0
// ---------------------------------------------------------------------------
describe("E. BOM faltante en bloque: fail-closed agregado", () => {
  it("el agregado expone el warning y el resto calcula igual", () => {
    const noBom = mkItem({ id: "b-nb", parent_id: "b-parent", code: "2.4", description: "Ayudante", unit: "h", quantity: 50, unit_price: 10000, sort_order: 5, material_requirement: "REQUIRES_BOM" });
    const groups = buildBlockGroups([fundParent, fund21, fund22, fund23, noBom]);
    const block = groups[0];
    expect(block.children.length).toBe(4);
    const local = blockSelectionTargets(block, { pp: 10, front: "Sector A", excludedIds: [], overrides: {} });
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-block",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [fund21, fund22, fund23, noBom],
      executed_quantities_by_item: {},
      targets: toEngineTargets(local),
      materials_by_item: {},
      stock_and_inbound: {},
    });
    const nb = calc.items.find((i) => i.budget_item_id === "b-nb")!;
    expect(nb.materials_warning).toBe("MATERIALES NO CONFIGURADOS");
    expect(calc.unconfigured_materials_count).toBe(1);
    // Resto intacto
    expect(calc.items.find((i) => i.budget_item_id === "b-21")!.target_quantity).toBe(10);
  });

  it("la UI agregada muestra el warning sin fingir caja 0", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("MATERIALES NO CONFIGURADOS");
    expect(ui).toContain("no se muestra 0 como si estuviera todo bien");
  });
});

// ---------------------------------------------------------------------------
// F. Modo manual por partida preservado
// ---------------------------------------------------------------------------
describe("F. Modo manual por partida sigue disponible", () => {
  it("la UI conserva el modo Por partida con cantidad/+pp/multi-frente", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("POR BLOQUE");
    expect(ui).toContain("POR PARTIDA");
    expect(ui).toContain("+ Definir meta");
    expect(ui).toContain("CALCULAR PLAN");
    expect(ui).toContain("previewWeeklyPlanAction");
  });

  it("blockSelectionTargets acepta overrides manuales por partida", () => {
    const [block] = buildBlockGroups([fundParent, fund21, fund22, fund23]);
    const local = blockSelectionTargets(block, {
      pp: 10,
      front: "Sector A",
      excludedIds: [],
      overrides: { "b-22": { inputMode: "QUANTITY", inputValue: 25 } },
    });
    const ov = local.find((t) => t.budgetItemId === "b-22")!;
    expect(ov.inputMode).toBe("QUANTITY");
    expect(ov.inputValue).toBe(25);
    // Traducción inmediata del resto sin persistir
    expect(local.find((t) => t.budgetItemId === "b-21")!.inputValue).toBe(10);
  });

  it("la UI cablea overrides: la edición fina sobrevive al re-aplicar el bloque", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("handleBlockRowUpdate");
    expect(ui).toContain("blockOverrides");
    expect(ui).toContain("manual");
    // applyBlock pasa los overrides al helper (no regenera en blanco)
    expect(ui).toContain("overrides,");
  });

  it("isDescendantCode blinda el agrupado por raíz en producción", () => {
    // A nivel grupo: 2.1 y 2.10 van al bloque "2"; 20.1 va al bloque "20".
    const a = mkItem({ id: "g-21", code: "2.1", description: "A", unit: "m2", quantity: 10, unit_price: 100, sort_order: 1 });
    const b = mkItem({ id: "g-210", code: "2.10", description: "B", unit: "m2", quantity: 10, unit_price: 100, sort_order: 2 });
    const c = mkItem({ id: "g-201", code: "20.1", description: "C", unit: "m2", quantity: 10, unit_price: 100, sort_order: 3 });
    const groups = buildBlockGroups([a, b, c]);
    expect(groups.length).toBe(2);
    const g2 = groups.find((g) => g.key === "root:2")!;
    const g20 = groups.find((g) => g.key === "root:20")!;
    expect(g2.children.map((x) => x.code).sort()).toEqual(["2.1", "2.10"]);
    expect(g20.children.map((x) => x.code)).toEqual(["20.1"]);
  });

  it("re-aplicar el bloque avisa que reemplaza metas existentes (no silencioso)", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("reemplaza las metas existentes de estas partidas");
    expect(ui).toContain("quita sus metas del plan local");
  });
});
