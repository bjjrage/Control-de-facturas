import { describe, it, expect } from "vitest";
import {
  calculateWeeklyPlanRequirements,
  checkItemBomRequirement,
  WeeklyPlanEngineInput,
} from "../lib/procurement/weekly-plan-engine";
import { BudgetItem, DailyWeatherForecast } from "../lib/types";

describe("Plan Semanal de Obra / Lookahead Operacional - Comprehensive Suite", () => {
  const sampleItems: BudgetItem[] = [
    {
      id: "item-1",
      project_id: "proj-1",
      parent_id: null,
      code: "01.01",
      description: "Hormigón de Vigas",
      unit: "m3",
      quantity: 100,
      unit_price: 1000000, // 1.000.000 Gs/m3 -> total 100M Gs
      subtotal: 100000000,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      depends_on: null,
      sort_order: 1,
      quantity_per_unit: null,
      material_requirement: "REQUIRES_BOM",
      created_at: "2026-09-01T00:00:00Z",
    },
    {
      id: "item-2",
      project_id: "proj-1",
      parent_id: null,
      code: "01.02",
      description: "Mampostería de Nivelación",
      unit: "m2",
      quantity: 200,
      unit_price: 500000, // 500.000 Gs/m2 -> total 100M Gs (Total obra: 200M Gs)
      subtotal: 100000000,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      depends_on: null,
      sort_order: 2,
      quantity_per_unit: null,
      material_requirement: "REQUIRES_BOM",
      created_at: "2026-09-01T00:00:00Z",
    },
    {
      id: "item-3",
      project_id: "proj-1",
      parent_id: null,
      code: "02.01",
      description: "Replanteo y Limpieza",
      unit: "gl",
      quantity: 1,
      unit_price: 10000000,
      subtotal: 10000000,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      depends_on: null,
      sort_order: 3,
      quantity_per_unit: null,
      material_requirement: "NO_MATERIAL",
      created_at: "2026-09-01T00:00:00Z",
    },
  ];

  it("1. Contractual capping: target_quantity cannot exceed remaining_quantity", () => {
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0]],
      executed_quantities_by_item: { "item-1": 85 }, // Remaining is 15 m3
      targets: [
        {
          budget_item_id: "item-1",
          input_mode: "QUANTITY",
          input_value: 30, // Tries to target 30 m3
        },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.items.length).toBe(1);
    const item = res.items[0];
    expect(item.remaining_quantity).toBe(15);
    expect(item.requested_quantity).toBe(30);
    expect(item.target_quantity).toBe(15);
    expect(item.was_capped).toBe(true);
    expect(item.item_target_progress_pct).toBe(100);
  });

  it("2. CONTRACT_PERCENTAGE_POINTS conversion works accurately", () => {
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0]], // Contractual quantity: 100 m3
      executed_quantities_by_item: { "item-1": 20 }, // 20% executed
      targets: [
        {
          budget_item_id: "item-1",
          input_mode: "CONTRACT_PERCENTAGE_POINTS",
          input_value: 12.5, // Target +12.5 pp
        },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
    };

    const res = calculateWeeklyPlanRequirements(input);
    const item = res.items[0];
    expect(item.target_quantity).toBe(12.5); // 100 * 12.5% = 12.5 m3
    expect(item.item_current_progress_pct).toBe(20);
    expect(item.item_target_progress_pct).toBe(32.5);
    expect(item.item_increment_pp).toBe(12.5);
  });

  it("3. Value-weighted global progress calculation is strictly compliant", () => {
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0], sampleItems[1]],
      executed_quantities_by_item: { "item-1": 50, "item-2": 0 },
      targets: [
        {
          budget_item_id: "item-2",
          input_mode: "QUANTITY",
          input_value: 100,
        },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.global_contractual_value).toBe(200000000);
    expect(res.global_previously_executed_value).toBe(50000000);
    expect(res.global_current_progress_pct).toBe(25);
    expect(res.global_target_progress_pct).toBe(50);
    expect(res.global_increment_pp).toBe(25);
    expect(res.total_plan_contractual_value).toBe(50000000);
  });

  it("4. Multi-front support: same item across Sector A and Sector B with joint capping", () => {
    // Contractual: 200 m2. Previous execution: 100 m2. Remaining: 100 m2.
    // Sector A targets 80 m2.
    // Sector B targets 40 m2. (Total requested = 120 m2 > 100 m2 remaining)
    // Sector A gets 80 m2. Sector B gets capped to 20 m2.
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[1]],
      executed_quantities_by_item: { "item-2": 100 },
      targets: [
        {
          budget_item_id: "item-2",
          front_label: "Sector A",
          input_mode: "QUANTITY",
          input_value: 80,
        },
        {
          budget_item_id: "item-2",
          front_label: "Sector B",
          input_mode: "QUANTITY",
          input_value: 40,
        },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.items.length).toBe(2);

    const sectorA = res.items.find((i) => i.front_label === "Sector A")!;
    expect(sectorA.target_quantity).toBe(80);
    expect(sectorA.was_capped).toBe(false);

    const sectorB = res.items.find((i) => i.front_label === "Sector B")!;
    expect(sectorB.target_quantity).toBe(20);
    expect(sectorB.was_capped).toBe(true);

    expect(res.total_plan_contractual_value).toBe((80 + 20) * 500000);
  });

  it("5. Sequential stock and inbound deduction prevents double-counting across items and fronts", () => {
    const cementCost = 70000;
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0], sampleItems[1]],
      executed_quantities_by_item: {},
      targets: [
        { budget_item_id: "item-1", front_label: "Losa 1", input_mode: "QUANTITY", input_value: 10 },
        { budget_item_id: "item-2", front_label: "Muro Norte", input_mode: "QUANTITY", input_value: 15 },
      ],
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-cement",
            producto_nombre: "Cemento Portland",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 1.0,
            desperdicio_pct: 0,
            costo_unitario: cementCost,
          },
        ],
        "item-2": [
          {
            budget_item_id: "item-2",
            producto_id: "prod-cement",
            producto_nombre: "Cemento Portland",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 1.0,
            desperdicio_pct: 0,
            costo_unitario: cementCost,
          },
        ],
      },
      stock_and_inbound: {
        "prod-cement": {
          producto_id: "prod-cement",
          stock_disponible: 12,
          oc_inbound: 8,
        },
      },
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.total_material_consumption_value).toBe(25 * cementCost);
    expect(res.total_covered_by_stock_value).toBe(12 * cementCost);
    expect(res.total_covered_by_inbound_value).toBe(8 * cementCost);
    expect(res.total_additional_cash_required).toBe(5 * cementCost);
  });

  it("6. BOM requirement state: replaces description heuristics with explicit fail-closed logic", () => {
    // item-1 is REQUIRES_BOM but has no BOM -> MATERIALES NO CONFIGURADOS
    const check1 = checkItemBomRequirement(sampleItems[0], false, 10);
    expect(check1.isLaborOrService).toBe(false);
    expect(check1.bomWarning).toBe("MATERIALES NO CONFIGURADOS");

    // item-3 is NO_MATERIAL and has no BOM -> valid (no warning)
    const check3 = checkItemBomRequirement(sampleItems[2], false, 1);
    expect(check3.isLaborOrService).toBe(true);
    expect(check3.bomWarning).toBeNull();

    // unknown requirement without BOM -> REVISIÓN REQUERIDA
    const unknownItem: BudgetItem = {
      ...sampleItems[0],
      material_requirement: "UNKNOWN",
    };
    const checkUnknown = checkItemBomRequirement(unknownItem, false, 5);
    expect(checkUnknown.bomWarning).toBe("REVISIÓN REQUERIDA (MATERIALES NO DEFINIDOS)");
  });

  it("7. Weather Overlay: adjusts estimated capacity and shows gap WITHOUT changing base plan targets or cash recommendations", () => {
    const cementCost = 70000;
    const sampleForecasts: DailyWeatherForecast[] = [
      { date: "2026-09-14", precipitation_sum_mm: 20, precipitation_hours: 6, wind_gusts_max_kmh: 50, weather_code: 65 },
      { date: "2026-09-15", precipitation_sum_mm: 0, precipitation_hours: 0, wind_gusts_max_kmh: 15, weather_code: 0 },
    ];

    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0]],
      executed_quantities_by_item: {},
      targets: [
        { budget_item_id: "item-1", input_mode: "QUANTITY", input_value: 63 },
      ],
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-cement",
            producto_nombre: "Cemento Portland",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 1.0,
            desperdicio_pct: 0,
            costo_unitario: cementCost,
          },
        ],
      },
      stock_and_inbound: {},
      weather_overlay_enabled: true,
      weather_forecasts: sampleForecasts,
      operational_assessments: {
        "item-1": {
          budget_item_id: "item-1",
          workability: "PARTIAL",
          productive_factor: 0.75, // Weather reduces expected capacity to 75%
          reason: "Lluvia intensa primer día",
        },
      },
      weather_snapshot_id: "snap-101",
    };

    const res = calculateWeeklyPlanRequirements(input);
    const item = res.items[0];

    // Base target is preserved strictly at 63 m3
    expect(item.target_quantity).toBe(63);
    expect(res.total_plan_contractual_value).toBe(63 * 1000000);
    // Base cash recommendation is based on the 63 m3 plan
    expect(res.total_additional_cash_required).toBe(63 * cementCost);

    // Weather overlay shows capacity = 63 * 0.75 = 47.25 m3, gap = 47.25 - 63 = -15.75 m3
    expect(item.weather_adjusted_capacity).toBe(47.25);
    expect(item.weather_gap_quantity).toBe(-15.75);
    expect(res.weather_days_affected_count).toBe(1);
    expect(res.weather_adjusted_material_consumption_value).toBe(Math.round(47.25 * cementCost));
  });

  it("8. Weather Fail-Closed: if weather fails closed, base plan remains intact and overlay is flagged unavailable", () => {
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0]],
      executed_quantities_by_item: {},
      targets: [
        { budget_item_id: "item-1", input_mode: "QUANTITY", input_value: 50 },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
      weather_overlay_enabled: true,
      weather_failed_closed: true, // Failed to fetch weather
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.items[0].target_quantity).toBe(50);
    expect(res.weather_failed_closed).toBe(true);
    expect(res.weather_summary).toContain("fail-closed");
    expect(res.items[0].weather_adjusted_capacity).toBeNull();
  });

  it("9. Deterministic Rain Fixture: NORMAL=1.0, BLOCKED=0.0, PARTIAL=0.5 — factor 0 NEVER becomes 1", () => {
    const testItems: BudgetItem[] = [
      {
        ...sampleItems[0],
        id: "item-normal",
        code: "01.01",
        description: "Trabajo Interior (NORMAL)",
        quantity: 100,
        unit_price: 100000,
      },
      {
        ...sampleItems[1],
        id: "item-blocked",
        code: "01.02",
        description: "Movimiento de Suelos Lluvia Extrema (BLOCKED)",
        quantity: 200,
        unit_price: 200000,
      },
      {
        ...sampleItems[2],
        id: "item-partial",
        code: "01.03",
        description: "Hormigonado Exterior (PARTIAL)",
        quantity: 50,
        unit_price: 500000,
      },
    ];

    const input: WeeklyPlanEngineInput = {
      project_id: "proj-weather-det",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: testItems,
      executed_quantities_by_item: {},
      targets: [
        { budget_item_id: "item-normal", input_mode: "QUANTITY", input_value: 40 },
        { budget_item_id: "item-blocked", input_mode: "QUANTITY", input_value: 80 },
        { budget_item_id: "item-partial", input_mode: "QUANTITY", input_value: 20 },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
      weather_overlay_enabled: true,
      weather_forecasts: [
        { date: "2026-09-14", precipitation_sum_mm: 55, precipitation_hours: 12, wind_gusts_max_kmh: 60, weather_code: 65 },
      ],
      operational_assessments: {
        "item-normal": {
          budget_item_id: "item-normal",
          workability: "NORMAL",
          productive_factor: 1.0,
          reason: "Bajo techo, sin afectación",
        },
        "item-blocked": {
          budget_item_id: "item-blocked",
          workability: "BLOCKED",
          productive_factor: 0, // EXPLICIT ZERO — MUST REMAIN 0, NEVER 1.0 OR 0 || 1.0
          reason: "Lluvia torrencial bloquea totalmente el suelo",
        },
        "item-partial": {
          budget_item_id: "item-partial",
          workability: "PARTIAL",
          productive_factor: 0.5,
          reason: "Rendimiento reducido al 50%",
        },
      },
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.items.length).toBe(3);

    const normal = res.items.find((i) => i.budget_item_id === "item-normal")!;
    const blocked = res.items.find((i) => i.budget_item_id === "item-blocked")!;
    const partial = res.items.find((i) => i.budget_item_id === "item-partial")!;

    // 1. BASE TARGETS ARE 100% UNCHANGED
    expect(normal.target_quantity).toBe(40);
    expect(blocked.target_quantity).toBe(80);
    expect(partial.target_quantity).toBe(20);
    expect(res.total_plan_contractual_value).toBe(40 * 100000 + 80 * 200000 + 20 * 500000);

    // 2. NORMAL (factor 1.0): adjusted = plan, gap = 0
    expect(normal.weather_workability_factor).toBe(1.0);
    expect(normal.weather_adjusted_capacity).toBe(40);
    expect(normal.weather_gap_quantity).toBe(0);

    // 3. BLOCKED (factor 0.0): adjusted = 0, gap = -80 (NEVER fallback to 1.0 or 80)
    expect(blocked.weather_workability_factor).toBe(0);
    expect(blocked.weather_adjusted_capacity).toBe(0);
    expect(blocked.weather_gap_quantity).toBe(-80);

    // 4. PARTIAL (factor 0.5): adjusted = 10, gap = -10
    expect(partial.weather_workability_factor).toBe(0.5);
    expect(partial.weather_adjusted_capacity).toBe(10);
    expect(partial.weather_gap_quantity).toBe(-10);

    // 5. Invariant: weather-adjusted capacity < plan for affected items
    expect(blocked.weather_adjusted_capacity!).toBeLessThan(blocked.target_quantity);
    expect(partial.weather_adjusted_capacity!).toBeLessThan(partial.target_quantity);
  });
});

