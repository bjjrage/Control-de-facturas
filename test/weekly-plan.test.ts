import { describe, it, expect } from "vitest";
import {
  calculateWeeklyPlanRequirements,
  isLaborOrServiceItem,
  WeeklyPlanEngineInput,
} from "../lib/procurement/weekly-plan-engine";
import { BudgetItem } from "../lib/types";

describe("Plan Semanal de Obra / Lookahead Operacional - Pure Engine", () => {
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
    // Total budget: item-1 (100 * 1M = 100M) + item-2 (200 * 500k = 100M) = 200M total
    // Previous execution: item-1 executed 50 m3 (50M), item-2 executed 0 (0M) -> Global: 50M / 200M = 25%
    // Target: item-2 targets 100 m2 (50M)
    // New global value: 50M + 50M = 100M / 200M = 50% (+25 pp)
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

  it("4. Sequential stock and inbound deduction prevents double-counting across items", () => {
    // Both item-1 and item-2 require Cement ("prod-cement")
    // Target item-1 requires 10 bags.
    // Target item-2 requires 15 bags.
    // Total demand = 25 bags.
    // Warehouse stock = 12 bags.
    // Inbound OC = 8 bags.
    // Net cash purchase required = 25 - 12 - 8 = 5 bags.
    const cementCost = 70000;
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0], sampleItems[1]],
      executed_quantities_by_item: {},
      targets: [
        { budget_item_id: "item-1", input_mode: "QUANTITY", input_value: 10 },
        { budget_item_id: "item-2", input_mode: "QUANTITY", input_value: 15 },
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

    // Verify sequential consumption per item
    const i1Mat = res.items[0].materials[0];
    expect(i1Mat.demanda_bruta).toBe(10);
    expect(i1Mat.cubierto_por_stock).toBe(10); // Takes 10 of 12 available
    expect(i1Mat.cubierto_por_inbound).toBe(0);
    expect(i1Mat.deficit_compra_neta).toBe(0);

    const i2Mat = res.items[1].materials[0];
    expect(i2Mat.demanda_bruta).toBe(15);
    expect(i2Mat.cubierto_por_stock).toBe(2); // Remaining stock was 2
    expect(i2Mat.cubierto_por_inbound).toBe(8); // Takes all 8 inbound
    expect(i2Mat.deficit_compra_neta).toBe(5); // Net deficit
  });

  it("5. BOM warning flag: distinguishes unconfigured materials vs pure labor/service", () => {
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0], sampleItems[2]], // item-0: concrete (needs materials), item-2: cleaning (labor)
      executed_quantities_by_item: {},
      targets: [
        { budget_item_id: "item-1", input_mode: "QUANTITY", input_value: 5 },
        { budget_item_id: "item-3", input_mode: "QUANTITY", input_value: 0.5 },
      ],
      materials_by_item: {}, // No materials configured for any
      stock_and_inbound: {},
    };

    const res = calculateWeeklyPlanRequirements(input);
    expect(res.unconfigured_materials_count).toBe(1);

    const concreteItem = res.items.find((i) => i.budget_item_id === "item-1");
    expect(concreteItem?.materials_warning).toBe("MATERIALES NO CONFIGURADOS");

    const laborItem = res.items.find((i) => i.budget_item_id === "item-3");
    expect(laborItem?.is_labor_or_service).toBe(true);
    expect(laborItem?.materials_warning).toBeNull();
  });

  it("6. Advisory capacity check alerts when target is aggressive vs recent velocity", () => {
    // 7-day plan. Target is 70 m3 (10 m3/day).
    // Historical velocity was 2 m3/day with HIGH confidence (ratio 5.0x > 2.0x threshold).
    const input: WeeklyPlanEngineInput = {
      project_id: "proj-1",
      start_date: "2026-09-14",
      end_date: "2026-09-20",
      budget_items: [sampleItems[0]],
      executed_quantities_by_item: { "item-1": 10 },
      targets: [
        { budget_item_id: "item-1", input_mode: "QUANTITY", input_value: 70 },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
      recent_execution_entries: [
        { budget_item_id: "item-1", entry_date: "2026-09-08", quantity_executed: 2 },
        { budget_item_id: "item-1", entry_date: "2026-09-09", quantity_executed: 2 },
        { budget_item_id: "item-1", entry_date: "2026-09-10", quantity_executed: 2 },
        { budget_item_id: "item-1", entry_date: "2026-09-11", quantity_executed: 2 },
        { budget_item_id: "item-1", entry_date: "2026-09-12", quantity_executed: 2 },
      ],
    };

    const res = calculateWeeklyPlanRequirements(input);
    const item = res.items[0];
    expect(item.advisory_capacity_warning).toContain("Meta agresiva");
    expect(item.advisory_capacity_warning).toContain("superior a la velocidad observada reciente");
  });
});
