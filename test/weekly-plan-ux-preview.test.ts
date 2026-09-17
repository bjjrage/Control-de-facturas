import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  calculateWeeklyPlanRequirements,
  checkItemBomRequirement,
} from "../lib/procurement/weekly-plan-engine";
import {
  toEngineTargets,
  translateTargetToQuantity,
  sumRequestedByItem,
  remainingForItem,
  isGroupingItem,
} from "../lib/procurement/weekly-plan-shared";
import type { BudgetItem } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function sliceFunction(src: string, fnName: string): string {
  const start = src.indexOf(`export async function ${fnName}`);
  if (start < 0) return "";
  const nextExport = src.indexOf("export async function", start + 10);
  return nextExport > start ? src.slice(start, nextExport) : src.slice(start);
}

const excavation: BudgetItem = {
  id: "item-exc",
  project_id: "proj-ux",
  parent_id: null,
  code: "01.01",
  description: "Excavación manual de terreno",
  unit: "m³",
  quantity: 120,
  unit_price: 80000,
  subtotal: 9600000,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  depends_on: null,
  sort_order: 1,
  quantity_per_unit: null,
  material_requirement: "NO_MATERIAL",
  created_at: "2026-09-01T00:00:00Z",
};

const masonry: BudgetItem = {
  id: "item-mamp",
  project_id: "proj-ux",
  parent_id: null,
  code: "03.01",
  description: "Mampostería",
  unit: "m²",
  quantity: 1000,
  unit_price: 150000,
  subtotal: 150000000,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  depends_on: null,
  sort_order: 2,
  quantity_per_unit: null,
  material_requirement: "REQUIRES_BOM",
  created_at: "2026-09-01T00:00:00Z",
};

const grouping: BudgetItem = {
  id: "item-rubro",
  project_id: "proj-ux",
  parent_id: null,
  code: "03",
  description: "Mampostería (rubro)",
  unit: "gl",
  quantity: 0,
  unit_price: 0,
  subtotal: 0,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  depends_on: null,
  sort_order: 0,
  quantity_per_unit: null,
  material_requirement: "UNKNOWN",
  created_at: "2026-09-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// A. Meta local QUANTITY = 30 → preview calcula 30 → DB plans/items NO cambia
// ---------------------------------------------------------------------------
describe("A. Preview QUANTITY=30 calcula 30 sin tocar plans/items", () => {
  it("el engine calcula 30 m³ para la meta local (mismo motor del preview)", () => {
    const targets = toEngineTargets([
      { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "QUANTITY", inputValue: 30 },
    ]);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [excavation],
      executed_quantities_by_item: { "item-exc": 44 }, // 44 ejecutados, 76 pendientes
      targets,
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items.length).toBe(1);
    expect(calc.items[0].target_quantity).toBe(30);
    expect(calc.items[0].previously_executed_quantity).toBe(44);
    expect(calc.items[0].remaining_quantity).toBe(76);
  });

  it("previewWeeklyPlanAction NO persiste plans/items (ni RPC de guardado)", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    const previewSrc = sliceFunction(src, "previewWeeklyPlanAction");
    expect(previewSrc.length).toBeGreaterThan(500);
    // P2-6 (fuerte): ni siquiera MENCIONA las tablas de planes/ítems.
    // Los únicos writes del camino preview viven en resolveWeeklyWeather y son
    // batches climáticos append-only (ver test siguiente).
    expect(previewSrc).not.toContain("project_weekly_plans");
    expect(previewSrc).not.toContain("project_weekly_plan_items");
    // Sin escrituras a planes ni ítems
    expect(previewSrc).not.toContain("save_weekly_plan_atomic");
    expect(previewSrc).not.toMatch(/from\("project_weekly_plans"\)\s*\.\s*(insert|update|delete|upsert)/);
    expect(previewSrc).not.toMatch(/from\("project_weekly_plan_items"\)\s*\.\s*(insert|update|delete|upsert)/);
    expect(previewSrc).not.toContain(".insert(");
    expect(previewSrc).not.toContain(".update(");
    expect(previewSrc).not.toContain(".delete(");
    expect(previewSrc).not.toContain(".upsert(");
    expect(previewSrc).not.toContain(".rpc(");
    // Usa el MISMO engine, sin fórmulas paralelas
    expect(previewSrc).toContain("calculateWeeklyPlanRequirements(");
    expect(previewSrc).not.toContain("function calculateWeeklyPlanRequirements");
  });

  it("el único write del preview son batches climáticos append-only (documentado)", () => {
    const shared = readSource("lib/procurement/weekly-plan-shared.ts");
    const weatherFn = shared.slice(shared.indexOf("export async function resolveWeeklyWeather"));
    expect(weatherFn).toContain('from("project_weather_forecast_batches")');
    expect(weatherFn).toContain('from("project_weather_forecast_snapshots")');
    expect(weatherFn).not.toContain("project_weekly_plans");
    expect(weatherFn).not.toContain("project_weekly_plan_items");
  });
});

// ---------------------------------------------------------------------------
// B. Meta local +10pp → traducción física correcta → preview correcto
// ---------------------------------------------------------------------------
describe("B. CONTRACT_PP se traduce a físico y el preview lo respeta", () => {
  it("+10 pp sobre contrato 120 m³ → 12 m³ (traducción informativa inmediata)", () => {
    expect(translateTargetToQuantity(120, "CONTRACT_PERCENTAGE_POINTS", 10)).toBe(12);
  });

  it("el engine convierte +10pp en 12 m³ de target", () => {
    const targets = toEngineTargets([
      { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "CONTRACT_PERCENTAGE_POINTS", inputValue: 10 },
    ]);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [excavation],
      executed_quantities_by_item: { "item-exc": 44 },
      targets,
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items[0].requested_quantity).toBe(12);
    expect(calc.items[0].target_quantity).toBe(12);
    expect(calc.items[0].item_increment_pp).toBe(10);
  });

  it("la UI muestra la traducción +pp → físico sin persistir", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("translateTargetToQuantity");
    expect(ui).toMatch(/\+.*pp →/);
  });
});

// ---------------------------------------------------------------------------
// C. Dos frentes misma partida → remanente compartido
// ---------------------------------------------------------------------------
describe("C. Multi-frente comparte el remanente contractual", () => {
  it("Sector A 20 + Sector B 10 sobre pendiente 76 → ambos íntegros", () => {
    const targets = toEngineTargets([
      { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "QUANTITY", inputValue: 20 },
      { budgetItemId: "item-exc", frontLabel: "Sector B", inputMode: "QUANTITY", inputValue: 10 },
    ]);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [excavation],
      executed_quantities_by_item: { "item-exc": 44 },
      targets,
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items.length).toBe(2);
    expect(calc.items[0].target_quantity).toBe(20);
    expect(calc.items[1].target_quantity).toBe(10);
    expect(calc.items[0].was_capped).toBe(false);
    expect(calc.items[1].was_capped).toBe(false);
  });

  it("exceso conjunto se capea secuencialmente y se marca (no silencioso)", () => {
    const targets = toEngineTargets([
      { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "QUANTITY", inputValue: 60 },
      { budgetItemId: "item-exc", frontLabel: "Sector B", inputMode: "QUANTITY", inputValue: 30 },
    ]);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [excavation],
      executed_quantities_by_item: { "item-exc": 44 }, // remanente 76
      targets,
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items[0].target_quantity).toBe(60);
    expect(calc.items[1].target_quantity).toBe(16); // 76 - 60
    expect(calc.items[1].was_capped).toBe(true);
  });

  it("helpers de remanente compartido para la UI", () => {
    expect(remainingForItem(120, 44)).toBe(76);
    const sums = sumRequestedByItem(
      [
        { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "QUANTITY", inputValue: 20 },
        { budgetItemId: "item-exc", frontLabel: "Sector B", inputMode: "QUANTITY", inputValue: 10 },
      ],
      { "item-exc": 120 }
    );
    expect(sums["item-exc"]).toBe(30);
  });

  it("la UI advierte cuando lo solicitado excede el remanente", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("excede el remanente");
    expect(ui).toContain("limitado al remanente");
  });
});

// ---------------------------------------------------------------------------
// D. Preview usa EXACTAMENTE el motor actual (caso de control)
// ---------------------------------------------------------------------------
describe("D. Preview usa el mismo engine: stock+inbound+faltante+caja", () => {
  it("caso de control: faltante 2.000 × Gs. 2.400 = Gs. 4.800.000", () => {
    const targets = toEngineTargets([
      { budgetItemId: "item-mamp", frontLabel: "Frente 1", inputMode: "QUANTITY", inputValue: 120 },
    ]);
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [masonry],
      executed_quantities_by_item: {},
      targets,
      materials_by_item: {
        "item-mamp": [
          {
            budget_item_id: "item-mamp",
            producto_id: "prod-ladrillo",
            producto_nombre: "LADRILLO",
            producto_codigo: "LAD",
            unidad_medida: "unid",
            cantidad_por_unidad_ejecutada: 52.5, // 120 × 52.5 = 6300
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

  it("load y preview comparten el MISMO loader (sin duplicar ~300 líneas)", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(src).toContain("loadWeeklyPlanBaseData");
    const loadUses = src.split("loadWeeklyPlanBaseData").length - 1;
    expect(loadUses).toBeGreaterThanOrEqual(3); // import + load + preview
    expect(src).toContain("resolveWeeklyWeather");
    // Sin segundo motor
    const engineDefs = (src.match(/function calculateWeeklyPlanRequirements/g) || []).length;
    expect(engineDefs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E. Preview Clima OFF → cero llamadas meteorológicas
// ---------------------------------------------------------------------------
describe("E. Clima OFF no llama al proveedor", () => {
  it("el preview solo consulta clima con toggle ON y metas (cero llamadas en OFF)", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    const previewSrc = sliceFunction(src, "previewWeeklyPlanAction");
    // Guarda P2-5: sin metas no hay assessment posible ni batch huérfano.
    expect(previewSrc).toContain("const withWeather = weatherOverlay && targets.length > 0;");
    const ifIdx = previewSrc.indexOf("if (withWeather)");
    expect(ifIdx).toBeGreaterThan(-1);
    const resolveIdx = previewSrc.indexOf("resolveWeeklyWeather");
    expect(resolveIdx).toBeGreaterThan(ifIdx);
    expect(previewSrc.slice(0, ifIdx)).not.toContain("resolveWeeklyWeather(supabase");
    expect(previewSrc.slice(0, ifIdx)).not.toContain("fetchWeatherForecastRange");
  });

  it("con overlay desactivado el engine no expone capacidad climática", () => {
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [excavation],
      executed_quantities_by_item: {},
      targets: toEngineTargets([
        { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "QUANTITY", inputValue: 30 },
      ]),
      materials_by_item: {},
      stock_and_inbound: {},
      weather_overlay_enabled: false,
      weather_forecasts: [],
    });
    expect(calc.weather_overlay_enabled).toBe(false);
    expect(calc.items[0].target_quantity).toBe(30);
    expect(calc.items[0].weather_adjusted_capacity).toBeNull();
  });

  it("la carga inicial de la UI no consulta clima (cero llamadas en OFF)", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("weatherOverlay: false");
  });
});

// ---------------------------------------------------------------------------
// F. Preview Clima ON → rango exacto → target base preservado
// ---------------------------------------------------------------------------
describe("F. Clima ON usa rango exacto y preserva la meta base", () => {
  it("el preview resuelve clima con las fechas exactas del plan", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    const previewSrc = sliceFunction(src, "previewWeeklyPlanAction");
    expect(previewSrc).toContain("startDate");
    expect(previewSrc).toContain("endDate");
    expect(previewSrc).toMatch(/resolveWeeklyWeather\(supabase, \{[\s\S]*startDate[\s\S]*endDate/);
  });

  it("el helper compartido usa fetchWeatherForecastRange con fechas exactas", () => {
    const shared = readSource("lib/procurement/weekly-plan-shared.ts");
    expect(shared).toContain("fetchWeatherForecastRange");
    expect(shared).toMatch(/fetchWeatherForecastRange\(\s*opts\.latitude[\s\S]*opts\.startDate,\s*opts\.endDate/);
  });

  it("con clima ON la meta base no se modifica ni se recortan compras", () => {
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [masonry],
      executed_quantities_by_item: {},
      targets: toEngineTargets([
        { budgetItemId: "item-mamp", frontLabel: "Frente 1", inputMode: "QUANTITY", inputValue: 80 },
      ]),
      materials_by_item: {
        "item-mamp": [
          {
            budget_item_id: "item-mamp",
            producto_id: "prod-ladrillo",
            producto_nombre: "LADRILLO",
            unidad_medida: "unid",
            cantidad_por_unidad_ejecutada: 10,
            desperdicio_pct: 0,
            costo_unitario: 2400,
          },
        ],
      },
      stock_and_inbound: {},
      weather_overlay_enabled: true,
      weather_forecasts: [
        { date: "2026-09-14", precipitation_sum_mm: 20, precipitation_hours: 6, wind_gusts_max_kmh: 50, weather_code: 65 },
        { date: "2026-09-15", precipitation_sum_mm: 0, precipitation_hours: 0, wind_gusts_max_kmh: 10, weather_code: 0 },
      ],
      operational_assessments: {
        "item-mamp": {
          budget_item_id: "item-mamp",
          workability: "PARTIAL",
          productive_factor: 0.5,
          reason: "lluvia",
        } as any,
      },
    });
    // Base intacta: 80 m² y caja sobre 80 m² (800 × 2400)
    expect(calc.items[0].target_quantity).toBe(80);
    expect(calc.total_additional_cash_required).toBe(800 * 2400);
    // Overlay separado
    expect(calc.items[0].weather_adjusted_capacity).toBe(40);
    expect(calc.items[0].weather_gap_quantity).toBe(-40);
  });
});

// ---------------------------------------------------------------------------
// G. Falta BOM → warning fail-closed → no falsa caja 0
// ---------------------------------------------------------------------------
describe("G. BOM faltante es fail-closed en preview", () => {
  it("REQUIRES_BOM sin receta advierte MATERIALES NO CONFIGURADOS", () => {
    const { bomWarning } = checkItemBomRequirement(masonry, false, 10);
    expect(bomWarning).toBe("MATERIALES NO CONFIGURADOS");
  });

  it("el cálculo expone el warning y no finge caja 0 como 'todo bien'", () => {
    const calc = calculateWeeklyPlanRequirements({
      project_id: "proj-ux",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [masonry],
      executed_quantities_by_item: {},
      targets: toEngineTargets([
        { budgetItemId: "item-mamp", frontLabel: "Frente 1", inputMode: "QUANTITY", inputValue: 10 },
      ]),
      materials_by_item: {},
      stock_and_inbound: {},
    });
    expect(calc.items[0].materials_warning).toBe("MATERIALES NO CONFIGURADOS");
    expect(calc.items[0].materials.length).toBe(0);
    expect(calc.unconfigured_materials_count).toBe(1);
  });

  it("la UI muestra el fail-closed de forma explícita", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain("MATERIALES NO CONFIGURADOS");
    expect(ui).toContain("no se muestra 0 como si estuviera todo bien");
  });
});

// ---------------------------------------------------------------------------
// H/I. Guardar borrador / Comprometer persisten exactamente lo previsualizado
// ---------------------------------------------------------------------------
describe("H/I. Guardado post-preview persiste lo previsualizado (mecanismo atómico)", () => {
  it("el guardado usa el RPC atómico existente (sin duplicar persistencia)", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    const saveSrc = sliceFunction(src, "saveWeeklyPlanAction");
    expect(saveSrc).toContain("save_weekly_plan_atomic");
  });

  it("la UI guarda EXACTAMENTE las metas del preview (mismos items + snapshot)", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    // Ambas rutas nacen de frontTargets filtrados por input_value > 0
    expect(ui).toContain("previewWeeklyPlanAction");
    // P1-1: con preview stale NO se enlaza el snapshot viejo (trazabilidad).
    expect(ui).toContain("const snapshotToLink = previewStale ? null : preview?.weather_snapshot_id || null;");
    expect(ui).toContain("weatherSnapshotBatchId: snapshotToLink,");
    expect(ui).toContain('handleSaveWithStatus("DRAFT")');
    expect(ui).toContain('handleSaveWithStatus("COMMITTED")');
    expect(ui).toContain("Guardar borrador");
    expect(ui).toContain("Comprometer plan");
    // El preview no guarda: no hay saveWeeklyPlanAction dentro de handleCalcular
    const calcIdx = ui.indexOf("const handleCalcular");
    const saveIdx = ui.indexOf("const handleSaveWithStatus");
    const calcBlock = ui.slice(calcIdx, saveIdx);
    expect(calcBlock).not.toContain("saveWeeklyPlanAction");
  });

  it("H: el payload de borrador equivale a los targets del preview", () => {
    const local = [
      { budgetItemId: "item-exc", frontLabel: "Sector A", inputMode: "QUANTITY" as const, inputValue: 20 },
      { budgetItemId: "item-exc", frontLabel: "Sector B", inputMode: "QUANTITY" as const, inputValue: 10 },
    ];
    const previewTargets = toEngineTargets(local);
    const savePayload = local
      .filter((t) => t.inputValue > 0)
      .map((t) => ({
        budget_item_id: t.budgetItemId,
        front_label: t.frontLabel,
        input_mode: t.inputMode,
        input_value: t.inputValue,
      }));
    expect(savePayload).toEqual(
      previewTargets.map((t) => ({
        budget_item_id: t.budget_item_id,
        front_label: t.front_label,
        input_mode: t.input_mode,
        input_value: t.input_value,
      }))
    );
  });

  it("I: el selector de compatibilidad conserva CLOSED sin ser protagonista", () => {
    const ui = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(ui).toContain('value="CLOSED"');
    // El estado NO está en el header de período: aparece después del cálculo
    const headerIdx = ui.indexOf("1. PERÍODO");
    const compatIdx = ui.indexOf("compat-status");
    expect(compatIdx).toBeGreaterThan(headerIdx);
  });
});

// ---------------------------------------------------------------------------
// J. Viewport: Definir meta sin scroll horizontal + flujo legible
// ---------------------------------------------------------------------------
describe("J. UX legible en 1366×768 con panel lateral abierto", () => {
  const ui = () => readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");

  it("el botón Definir meta existe por partida y es siempre visible", () => {
    expect(ui()).toContain("+ Definir meta");
    expect(ui()).toContain("definir-meta-");
  });

  it("la lista de partidas NO usa scroll horizontal (Definir meta sin scroll-x)", () => {
    const src = ui();
    const listIdx = src.indexOf('data-testid="partidas-list"');
    expect(listIdx).toBeGreaterThan(-1);
    // El contenedor de la lista declara explícitamente que no usa overflow-x
    expect(src).toContain("Sin overflow-x-auto a propósito");
    const listTagStart = src.lastIndexOf("<div", listIdx);
    const listTag = src.slice(listTagStart, listIdx + 60);
    expect(listTag).not.toContain("overflow-x-auto");
    // Ningún ancestro entre la tarjeta y el botón impone scroll-x:
    // las tarjetas usan flex-wrap (quiebran) en lugar de tabla ancha.
    expect(src).toContain("flex-wrap");
  });

  it("no hay tabla gigante para crear metas (cards compactas por partida)", () => {
    const src = ui();
    // La creación de metas vive en cards (partida-*) con editor inline,
    // no en una tabla horizontal de 10 columnas.
    expect(src).toContain("data-testid={`partida-${bItem.code}`}");
    expect(src).toContain("data-testid={`editor-${bItem.code}`}");
    expect(src).toContain("META DE ESTA SEMANA");
    expect(src).toContain("Pendiente disponible");
    expect(src).toContain("Agregar otro frente");
    expect(src).toContain("Quitar meta");
  });

  it("flujo legible: período → metas → CALCULAR → resultado → guardar", () => {
    const src = ui();
    expect(src).toContain("Plan Semanal de Obra");
    expect(src).toContain("Período:");
    expect(src).toContain("Clima OFF");
    expect(src).toContain("Clima ON");
    expect(src).toContain("CALCULAR PLAN");
    expect(src).toContain("calcular-plan");
    expect(src).toContain("RESULTADO DEL PLAN");
    expect(src).toContain("Caja necesaria para cumplir el plan");
    expect(src).toContain("caja-necesaria");
    expect(src).toContain("guardar-borrador");
    expect(src).toContain("comprometer-plan");
    // Orden del flujo en el archivo: calcular antes que resultado antes que guardar
    const order = ["CALCULAR PLAN", "RESULTADO DEL PLAN", "Guardar borrador"].map((s) => src.indexOf(s));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
  });

  it("rubros agrupadores (cantidad 0) no se ofrecen como ejecutables", () => {
    expect(isGroupingItem(grouping)).toBe(true);
    expect(isGroupingItem(excavation)).toBe(false);
    const src = ui();
    expect(src).toContain("Rubro agrupador");
    expect(src).toContain("No ejecutable");
  });

  it("el valor contractual queda secundario frente a la caja adicional", () => {
    const src = ui();
    expect(src).toContain("Valor contractual de la meta");
    expect(src).toContain("referencial, no es caja");
    const cajaIdx = src.indexOf("Caja necesaria para cumplir el plan");
    const contractualIdx = src.indexOf("Valor contractual de la meta");
    expect(cajaIdx).toBeGreaterThan(-1);
    expect(contractualIdx).toBeGreaterThan(cajaIdx);
  });

  it("race conditions: respuestas stale no pisan metas locales (regresión E2E)", () => {
    const src = ui();
    // Guarda de secuencia en carga base y en cálculo; la respuesta vieja se ignora.
    expect(src).toContain("loadSeq");
    expect(src).toContain("calcSeq");
    expect(src).toContain("if (loadSeq.current !== seq) return;");
    expect(src).toContain("if (calcSeq.current !== seq) return;");
    // El preview calculado no reescribe las metas locales.
    const calcIdx = src.indexOf("setPreview(res.data.calculation)");
    expect(calcIdx).toBeGreaterThan(-1);
    const handleCalcIdx = src.indexOf("const handleCalcular");
    const handleSaveIdx = src.indexOf("const handleSaveWithStatus");
    const calcBlock = src.slice(handleCalcIdx, handleSaveIdx);
    expect(calcBlock).not.toContain("setFrontTargets");
  });

  it("robustez: ningún botón cuelga para siempre si se pierde la respuesta (timeout explícito)", () => {
    const src = ui();
    // Sin useTransition (su pending quedaba trabado si la respuesta no llegaba):
    // estados manuales + timeout que libera con error claro.
    expect(src).not.toContain("useTransition");
    expect(src).toContain("withActionTimeout");
    expect(src).toContain("setIsCalculating(false)");
    expect(src).toContain("setIsSaving(false)");
    expect(src).toContain("tardó demasiado");
  });
});
