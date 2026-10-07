import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateWeeklyPlanRequirements } from "../lib/procurement/weekly-plan-engine";
import { allocateMaterialCoverage } from "../lib/procurement/mrp-coverage";
import { UNIDADES_COMPRA, UNIDADES_BASE } from "../lib/stock-units";
import type { BudgetItem } from "../lib/types";

const fixture = JSON.parse(readFileSync("test/fixtures/qa-admin/bom-mamposteria.json", "utf8")) as {
  itemCode: string; targetQuantity: number; expectedGross: number[]; expectedToBuy: number[];
  materials: { sku: string; name: string; unit: string; quantityPerUnit: number; wastePct: number; centralStock: number; unitCost: number }[];
};

describe("QA ADMIN canonical units and executable BOM", () => {
  it.each(["bolsa", "un", "m³", "barra", "m", "balde"])("manual catalog offers exact fixture purchase unit %s", unit => {
    expect(UNIDADES_COMPRA).toContain(unit);
  });
  it.each(["kg", "m", "L"])("manual catalog offers exact fixture base unit %s", unit => {
    expect(UNIDADES_BASE).toContain(unit);
  });
  it("keeps existing units and no duplicate options", () => {
    expect(UNIDADES_COMPRA).toContain("unidad");
    expect(UNIDADES_BASE).toContain("lt");
    expect(new Set(UNIDADES_COMPRA).size).toBe(UNIDADES_COMPRA.length);
    expect(new Set(UNIDADES_BASE).size).toBe(UNIDADES_BASE.length);
  });
  it("runs the real weekly engine and coverage without forcing the manual RFQ quantities", () => {
    const item: BudgetItem = {
      id: "qa-item", project_id: "qa-project", parent_id: null, code: fixture.itemCode,
      description: "Mampostería de ladrillo común", unit: "m²", quantity: 1000,
      unit_price: 180000, subtotal: 180000000, sort_order: 3,
      start_date: "2026-10-01", end_date: "2026-11-30", depends_on: null,
      quantity_per_unit: null, material_requirement: "REQUIRES_BOM", created_at: "2026-10-01T00:00:00Z",
    };
    const materials = fixture.materials.map(m => ({
      budget_item_id: item.id, producto_id: m.sku, producto_nombre: m.name, producto_codigo: m.sku,
      unidad_medida: m.unit, cantidad_por_unidad_ejecutada: m.quantityPerUnit,
      desperdicio_pct: m.wastePct, costo_unitario: m.unitCost,
    }));
    const calculation = calculateWeeklyPlanRequirements({
      project_id: item.project_id, start_date: "2026-10-05", end_date: "2026-10-11",
      budget_items: [item], executed_quantities_by_item: {},
      targets: [{ budget_item_id: item.id, input_mode: "QUANTITY", input_value: fixture.targetQuantity }],
      materials_by_item: { [item.id]: materials }, stock_and_inbound: {}, weather_overlay_enabled: false,
    });
    expect(calculation.unconfigured_materials_count).toBe(0);
    const gross = calculation.items.flatMap(i => i.materials);
    expect(gross.map(m => m.demanda_bruta)).toEqual(fixture.expectedGross);
    const coverage = allocateMaterialCoverage({
      gross: gross.map(m => ({ producto_id: m.producto_id, producto_nombre: m.producto_nombre,
        unidad_medida: m.unidad_medida, costo_unitario: m.costo_unitario, requerido: m.demanda_bruta, cubierto_obra: m.cubierto_por_stock })),
      centralAvailableByProduct: Object.fromEntries(fixture.materials.map(m => [m.sku, m.centralStock])), validInboundByProduct: {},
    });
    expect(fixture.materials.map(m => coverage.lines.find(line => line.producto_id === m.sku)?.comprar)).toEqual(fixture.expectedToBuy);
    expect(coverage.total_caja_adicional).toBe(2800000);
  });
});
