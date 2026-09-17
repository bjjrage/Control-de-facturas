import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  calculateWeeklyPlanRequirements,
  checkItemBomRequirement,
} from "../lib/procurement/weekly-plan-engine";
import type { BudgetItem } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// 1. AvanceFisicoPanel NO renderiza ProgressForecastSection
// ---------------------------------------------------------------------------
describe("UI consolidation: single weekly planning experience", () => {
  it("AvanceFisicoPanel no importa ni renderiza ProgressForecastSection", () => {
    const src = readSource("app/(internal)/projects/[id]/avance-fisico-panel.tsx");
    expect(src).toContain("WeeklyPlanSection");
    expect(src).not.toContain("ProgressForecastSection");
    expect(src).not.toContain("Proyección Semanal Inteligente de Obra + Materiales + Impacto en Caja");
  });

  it("progress-forecast-engine se conserva como dependencia del motor (no borrado a ciegas)", () => {
    const engineSrc = readSource("lib/procurement/weekly-plan-engine.ts");
    expect(engineSrc).toContain("progress-forecast-engine");
    expect(engineSrc).toContain("calculateRecentVelocity");
    expect(fs.existsSync(path.join(ROOT, "lib/procurement/progress-forecast-engine.ts"))).toBe(true);
  });

  it("WeeklyPlanSection jerarquía: caja prominente + valor contractual renombrado", () => {
    const src = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(src).toContain("Caja necesaria para cumplir el plan");
    expect(src).toContain("Valor contractual de la meta");
    expect(src).not.toContain("Producción Contractual Meta");
    expect(src).toContain("Qué necesito para cumplir el plan");
    expect(src).toContain("requerido − stock − OC = faltante");
    expect(src).toContain("Capacidad observada");
    expect(src).toContain("Factibilidad climática");
  });
});

// ---------------------------------------------------------------------------
// 2. Weekly Plan conserva materiales / stock / inbound / cash
// ---------------------------------------------------------------------------
describe("Weekly Plan conserva materiales/stock/inbound/cash", () => {
  const mamposteria: BudgetItem = {
    id: "item-mamp",
    project_id: "proj-mock",
    parent_id: null,
    code: "03.01",
    description: "Mampostería",
    unit: "m2",
    quantity: 1000,
    unit_price: 150000,
    subtotal: 150000000,
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    depends_on: null,
    sort_order: 1,
    quantity_per_unit: null,
    material_requirement: "REQUIRES_BOM",
    created_at: "2026-09-01T00:00:00Z",
  };

  it("descuenta stock primero y luego inbound sin double-count", () => {
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-mock",
      start_date: "2026-09-15",
      end_date: "2026-09-21",
      budget_items: [mamposteria],
      executed_quantities_by_item: {},
      targets: [{ budget_item_id: "item-mamp", front_label: "Sector A", input_mode: "QUANTITY", input_value: 120 }],
      materials_by_item: {
        "item-mamp": [
          {
            budget_item_id: "item-mamp",
            producto_id: "prod-ladrillo",
            producto_nombre: "LADRILLO",
            producto_codigo: "LAD-001",
            unidad_medida: "unid",
            cantidad_por_unidad_ejecutada: 52.5,
            desperdicio_pct: 0,
            costo_unitario: 2400,
          },
        ],
      },
      stock_and_inbound: {
        "prod-ladrillo": { producto_id: "prod-ladrillo", stock_disponible: 1800, oc_inbound: 2500 },
      },
    });
    const item = calc.items[0];
    const mat = item.materials[0];
    expect(mat.demanda_bruta).toBe(6300);
    expect(mat.cubierto_por_stock).toBe(1800);
    expect(mat.cubierto_por_inbound).toBe(2500);
    expect(mat.deficit_compra_neta).toBe(2000);
    expect(mat.caja_adicional_requerida).toBe(4800000);
    expect(calc.total_additional_cash_required).toBe(4800000);
  });

  it("NO_MATERIAL no genera falso error ni caja fantasma", () => {
    const labor: BudgetItem = {
      ...mamposteria,
      id: "item-labor",
      code: "04.01",
      description: "Mano de obra",
      material_requirement: "NO_MATERIAL",
    };
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-mock",
      start_date: "2026-09-15",
      end_date: "2026-09-21",
      budget_items: [labor],
      executed_quantities_by_item: {},
      targets: [{ budget_item_id: "item-labor", input_mode: "QUANTITY", input_value: 10 }],
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items[0].is_labor_or_service).toBe(true);
    expect(calc.items[0].materials_warning).toBeNull();
    expect(calc.total_additional_cash_required).toBe(0);
  });

  it("REQUIRES_BOM sin BOM y UNKNOWN sin BOM advierten, no silencian a cero", () => {
    const req = checkItemBomRequirement({ ...mamposteria, material_requirement: "REQUIRES_BOM" } as BudgetItem, false, 5);
    expect(req.bomWarning).toBe("MATERIALES NO CONFIGURADOS");
    const unk = checkItemBomRequirement({ ...mamposteria, material_requirement: "UNKNOWN" } as BudgetItem, false, 5);
    expect(unk.bomWarning).toMatch(/REVISI/);
    // target 0 no advierte
    const zero = checkItemBomRequirement({ ...mamposteria, material_requirement: "REQUIRES_BOM" } as BudgetItem, false, 0);
    expect(zero.bomWarning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3/4. setWeatherDay propaga error de DELETE y UPSERT
// ---------------------------------------------------------------------------
describe("setWeatherDay propaga errores reales", () => {
  it("captura error de DELETE y de UPSERT en el source", () => {
    const src = readSource("app/(internal)/projects/certificado-anexos-actions.ts");
    expect(src).toContain("deleteError");
    expect(src).toContain("upsertError");
    expect(src).toContain("No se pudo borrar el registro");
    expect(src).toContain("No se pudo guardar el día");
    // No debe existir el patrón viejo de await sin capturar error
    expect(src).not.toMatch(/await supabase\.from\("project_weather_log"\)\.delete\(\)\.eq[^;]*;\s*\} else/);
  });

  it("DiasNoTrabajados muestra loading / éxito / error real y editor Registrar día", () => {
    const src = readSource("app/(internal)/projects/[id]/avance-fisico-panel.tsx");
    expect(src).toContain("Registrar día");
    expect(src).toContain("Guardar día");
    expect(src).toContain("Limpiar registro");
    expect(src).toContain("Guardando");
    expect(src).toContain("feedback.error");
    expect(src).toContain("feedback.success");
    expect(src).toContain("registro histórico");
  });
});

// ---------------------------------------------------------------------------
// 6. Caja adicional 6300/1800/2500/2000 x 2400 = 4.800.000
// ---------------------------------------------------------------------------
describe("Caso económico de control (vía motor real)", () => {
  it("demanda 6300 stock 1800 inbound 2500 net 2000 costo 2400 = 4.800.000", () => {
    const item = {
      id: "item-control",
      project_id: "proj-control",
      parent_id: null,
      code: "01.01",
      description: "Mampostería control",
      unit: "m2",
      quantity: 1000,
      unit_price: 120000,
      subtotal: 120000000,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      depends_on: null,
      sort_order: 1,
      quantity_per_unit: null,
      material_requirement: "REQUIRES_BOM",
      created_at: "2026-09-01T00:00:00Z",
    } as BudgetItem;
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-control",
      start_date: "2026-09-16",
      end_date: "2026-09-22",
      budget_items: [item],
      executed_quantities_by_item: {},
      // 120 m2 x 52.5 = 6300 demanda bruta
      targets: [{ budget_item_id: "item-control", input_mode: "QUANTITY", input_value: 120 }],
      materials_by_item: {
        "item-control": [
          {
            budget_item_id: "item-control",
            producto_id: "prod-ladrillo",
            producto_nombre: "LADRILLO",
            producto_codigo: "LAD",
            unidad_medida: "unid",
            cantidad_por_unidad_ejecutada: 52.5,
            desperdicio_pct: 0,
            costo_unitario: 2400,
          },
        ],
      },
      stock_and_inbound: {
        "prod-ladrillo": { producto_id: "prod-ladrillo", stock_disponible: 1800, oc_inbound: 2500 },
      },
    });
    const mat = calc.items[0].materials[0];
    expect(mat.demanda_bruta).toBe(6300);
    expect(mat.cubierto_por_stock).toBe(1800);
    expect(mat.cubierto_por_inbound).toBe(2500);
    expect(mat.deficit_compra_neta).toBe(2000);
    expect(mat.caja_adicional_requerida).toBe(4800000);
    expect(calc.total_additional_cash_required).toBe(4800000);
  });
});

// ---------------------------------------------------------------------------
// 7/8. Weather OFF no llama provider / Weather ON conserva meta original
// ---------------------------------------------------------------------------
describe("Weather overlay no inventa ni recorta la meta", () => {
  const item: BudgetItem = {
    id: "item-w",
    project_id: "proj-w",
    parent_id: null,
    code: "05.01",
    description: "Mampostería W",
    unit: "m2",
    quantity: 500,
    unit_price: 100000,
    subtotal: 50000000,
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    depends_on: null,
    sort_order: 1,
    quantity_per_unit: null,
    material_requirement: "NO_MATERIAL",
    created_at: "2026-09-01T00:00:00Z",
  };
  const base = {
    project_id: "proj-w",
    start_date: "2026-09-15",
    end_date: "2026-09-21",
    budget_items: [item],
    executed_quantities_by_item: {},
    targets: [{ budget_item_id: "item-w", input_mode: "QUANTITY" as const, input_value: 120 }],
    materials_by_item: {},
    stock_and_inbound: {},
  };

  it("Weather OFF no llama al provider (fetch solo dentro de if weatherOverlay)", () => {
    // Batch UX-preview: el acceso al provider vive en el helper compartido
    // resolveWeeklyWeather (lib/procurement/weekly-plan-shared.ts), invocado
    // desde las actions SOLO dentro de bloques `if (weatherOverlay)`.
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    const overlayIdx = src.indexOf("if (weatherOverlay)");
    expect(overlayIdx).toBeGreaterThan(-1);
    // Única vía al proveedor desde las actions: el helper compartido.
    const helperIdx = src.indexOf("resolveWeeklyWeather(supabase");
    expect(helperIdx).toBeGreaterThan(overlayIdx);
    const beforeBlock = src.slice(0, overlayIdx);
    expect(beforeBlock).not.toContain("resolveWeeklyWeather(supabase");
    expect(beforeBlock).not.toContain("fetchWeatherForecastRange");
    // Y el helper solo consulta el provider real dentro de su propio cuerpo
    // (los llamadores con Clima OFF nunca lo invocan).
    const shared = readSource("lib/procurement/weekly-plan-shared.ts");
    expect(shared).toContain("fetchWeatherForecastRange");
  });

  it("Weather OFF: sin forecasts, sin overlay, meta intacta", () => {
    const calc = calculateWeeklyPlanRequirements({ ...base, weather_overlay_enabled: false, weather_forecasts: [] });
    expect(calc.weather_overlay_enabled).toBe(false);
    expect(calc.items[0].target_quantity).toBe(120);
    expect(calc.items[0].weather_adjusted_capacity).toBeNull();
  });

  it("Weather ON: conserva meta original y expone capacidad estimada separada", () => {
    const calc = calculateWeeklyPlanRequirements({
      ...base,
      weather_overlay_enabled: true,
      weather_forecasts: [
        { date: "2026-09-15", precipitation_sum_mm: 10, precipitation_hours: 5, precipitation_probability_max: 90, wind_gusts_max_kmh: 50, temperature_max_c: 30, temperature_min_c: 22, weather_code: 61 },
        { date: "2026-09-16", precipitation_sum_mm: 0, precipitation_hours: 0, precipitation_probability_max: 5, wind_gusts_max_kmh: 10, temperature_max_c: 31, temperature_min_c: 22, weather_code: 0 },
      ],
      operational_assessments: {
        "item-w": { budget_item_id: "item-w", productive_factor: 0.5, reasoning: "lluvia", confidence: "MEDIUM" } as any,
      },
    });
    expect(calc.items[0].target_quantity).toBe(120);
    expect(calc.items[0].weather_adjusted_capacity).toBe(60);
    expect(calc.weather_days_affected_count).toBe(1);
  });
});
