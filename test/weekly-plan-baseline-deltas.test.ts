import { describe, it, expect } from "vitest";
import {
  selectBaselineCertificate,
  computeBaselineWithDeltas,
} from "../lib/procurement/weekly-plan-shared";
import { calculateWeeklyPlanRequirements } from "../lib/procurement/weekly-plan-engine";
import { calculateRecentVelocity } from "../lib/procurement/progress-forecast-engine";
import type { BudgetItem } from "../lib/types";

describe("Plan Semanal: Baseline Contractual + Deltas Operativos", () => {
  const dummyItem: BudgetItem = {
    id: "item-1",
    project_id: "proj-1",
    parent_id: null,
    code: "01.01",
    description: "Hormigón de Vigas",
    unit: "m3",
    quantity: 100,
    unit_price: 1000,
    subtotal: 100000,
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    depends_on: null,
    sort_order: 1,
    quantity_per_unit: null,
    material_requirement: "REQUIRES_BOM",
    created_at: "2026-09-01T00:00:00Z",
  };

  // 1. Sin certificado + sin partes: avance 0%
  it("1. Sin certificado + sin partes: avance 0%", () => {
    const { executedQuantities, recentEntries } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: null,
      certificateItems: [],
      executionEntries: [],
    });

    expect(executedQuantities["item-1"] || 0).toBe(0);
    expect(recentEntries.length).toBe(0);

    const engineResult = calculateWeeklyPlanRequirements({
      project_id: "proj-1",
      start_date: "2026-09-01",
      end_date: "2026-09-07",
      budget_items: [dummyItem],
      executed_quantities_by_item: executedQuantities,
      recent_execution_entries: recentEntries,
      targets: [],
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      currency: "PYG",
    });

    expect(engineResult.global_current_progress_pct).toBe(0);
  });

  // 2. Sin certificado + partes: comportamiento actual intacto
  it("2. Sin certificado + partes: comportamiento actual intacto", () => {
    const { executedQuantities, recentEntries } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: null,
      certificateItems: [],
      executionEntries: [
        { budget_item_id: "item-1", quantity_executed: 25, entry_date: "2026-09-05" },
        { budget_item_id: "item-1", quantity_executed: 15, entry_date: "2026-09-06" },
      ],
    });

    expect(executedQuantities["item-1"]).toBe(40);
    expect(recentEntries.length).toBe(2);

    const engineResult = calculateWeeklyPlanRequirements({
      project_id: "proj-1",
      start_date: "2026-09-07",
      end_date: "2026-09-13",
      budget_items: [dummyItem],
      executed_quantities_by_item: executedQuantities,
      recent_execution_entries: recentEntries,
      targets: [],
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      currency: "PYG",
    });

    expect(engineResult.global_current_progress_pct).toBe(40);
  });

  // 3. Certificado 6 + sin partes: avance parte de qty_acumulada del certificado
  it("3. Certificado 6 + sin partes: avance parte de qty_acumulada del certificado", () => {
    const { executedQuantities } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: "item-1",
          codigo: "01.01",
          qty_acumulada: 30,
        },
      ],
      executionEntries: [],
    });

    expect(executedQuantities["item-1"]).toBe(30);

    const engineResult = calculateWeeklyPlanRequirements({
      project_id: "proj-1",
      start_date: "2026-08-21",
      end_date: "2026-08-27",
      budget_items: [dummyItem],
      executed_quantities_by_item: executedQuantities,
      recent_execution_entries: [],
      targets: [],
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      currency: "PYG",
    });

    expect(engineResult.global_current_progress_pct).toBe(30);
  });

  // 4. Certificado 6 + partes ANTERIORES al period_end: NO doble contar
  it("4. Certificado 6 + partes ANTERIORES o iguales al period_end: NO doble contar", () => {
    const { executedQuantities } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: "item-1",
          codigo: "01.01",
          qty_acumulada: 30,
        },
      ],
      executionEntries: [
        { budget_item_id: "item-1", quantity_executed: 10, entry_date: "2026-08-10" },
        { budget_item_id: "item-1", quantity_executed: 5, entry_date: "2026-08-20" },
      ],
    });

    // Both entries are <= 2026-08-20, so delta is 0 and executedQuantities remains 30
    expect(executedQuantities["item-1"]).toBe(30);
  });

  // 5. Certificado 6 + partes POSTERIORES: baseline + delta
  it("5. Certificado 6 + partes POSTERIORES: baseline + delta", () => {
    const { executedQuantities } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: "item-1",
          codigo: "01.01",
          qty_acumulada: 30,
        },
      ],
      executionEntries: [
        // Parte anterior: ignorado
        { budget_item_id: "item-1", quantity_executed: 10, entry_date: "2026-08-15" },
        // Partes posteriores: sumados
        { budget_item_id: "item-1", quantity_executed: 8, entry_date: "2026-08-21" },
        { budget_item_id: "item-1", quantity_executed: 4, entry_date: "2026-08-25" },
      ],
    });

    // 30 (baseline) + 8 + 4 = 42
    expect(executedQuantities["item-1"]).toBe(42);

    const engineResult = calculateWeeklyPlanRequirements({
      project_id: "proj-1",
      start_date: "2026-08-26",
      end_date: "2026-09-01",
      budget_items: [dummyItem],
      executed_quantities_by_item: executedQuantities,
      recent_execution_entries: [],
      targets: [],
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      currency: "PYG",
    });

    expect(engineResult.global_current_progress_pct).toBe(42);
  });

  // 6. Certificados importados 6 → 8 → 7: baseline seleccionada por period_end más reciente, NO por numero
  it("6. Certificados importados 6 → 8 → 7: baseline seleccionada por period_end más reciente, NO por numero", () => {
    const certs = [
      { id: "c-6", numero: 6, period_end: "2026-06-30" },
      { id: "c-8", numero: 8, period_end: "2026-07-31" },
      { id: "c-7", numero: 7, period_end: "2026-08-31" },
    ];

    const selected = selectBaselineCertificate(certs);
    expect(selected?.id).toBe("c-7");
    expect(selected?.numero).toBe(7);
    expect(selected?.period_end).toBe("2026-08-31");

    // Desempate por numero si coinciden en period_end
    const tieCerts = [
      { id: "c-a", numero: 1, period_end: "2026-08-31" },
      { id: "c-b", numero: 2, period_end: "2026-08-31" },
    ];
    const tieSelected = selectBaselineCertificate(tieCerts);
    expect(tieSelected?.id).toBe("c-b");
    expect(tieSelected?.numero).toBe(2);
  });

  // 7. budget_item_id directo: match correcto
  it("7. budget_item_id directo: match correcto", () => {
    const { executedQuantities, mappedItemsCount, unmappedItemsCount } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: "item-1",
          codigo: "CODIGO_DIFERENTE_O_INEXISTENTE",
          qty_acumulada: 50,
        },
      ],
      executionEntries: [],
    });

    expect(executedQuantities["item-1"]).toBe(50);
    expect(mappedItemsCount).toBe(1);
    expect(unmappedItemsCount).toBe(0);
  });

  // 8. budget_item_id NULL + codigo único: fallback correcto
  it("8. budget_item_id NULL + codigo único: fallback correcto", () => {
    const { executedQuantities, mappedItemsCount, unmappedItemsCount } = computeBaselineWithDeltas({
      budgetItems: [dummyItem], // code: "01.01"
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: null,
          codigo: "01.01",
          qty_acumulada: 65,
        },
      ],
      executionEntries: [],
    });

    expect(executedQuantities["item-1"]).toBe(65);
    expect(mappedItemsCount).toBe(1);
    expect(unmappedItemsCount).toBe(0);
  });

  // 9. codigo ambiguo: NO inventar match
  it("9. codigo ambiguo: NO inventar match", () => {
    const itemA: BudgetItem = { ...dummyItem, id: "item-a", code: "REPETIDO" };
    const itemB: BudgetItem = { ...dummyItem, id: "item-b", code: "REPETIDO" };

    const { executedQuantities, mappedItemsCount, unmappedItemsCount } = computeBaselineWithDeltas({
      budgetItems: [itemA, itemB],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: null,
          codigo: "REPETIDO",
          qty_acumulada: 20,
        },
      ],
      executionEntries: [],
    });

    // Ambiguo: neither item receives the quantity
    expect(executedQuantities["item-a"]).toBe(0);
    expect(executedQuantities["item-b"]).toBe(0);
    expect(mappedItemsCount).toBe(0);
    expect(unmappedItemsCount).toBe(1);
  });

  // 10. qty ejecutada resultante > contractual: conservar comportamiento/clamp existente
  it("10. qty ejecutada resultante > contractual: conservar comportamiento/clamp existente", () => {
    // dummyItem has quantity: 100, unit_price: 1000
    const { executedQuantities } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: "item-1",
          qty_acumulada: 120, // > 100
        },
      ],
      executionEntries: [
        { budget_item_id: "item-1", quantity_executed: 10, entry_date: "2026-08-25" },
      ],
    });

    // 120 + 10 = 130
    expect(executedQuantities["item-1"]).toBe(130);

    const engineResult = calculateWeeklyPlanRequirements({
      project_id: "proj-1",
      start_date: "2026-08-26",
      end_date: "2026-09-01",
      budget_items: [dummyItem],
      executed_quantities_by_item: executedQuantities,
      recent_execution_entries: [],
      targets: [
        {
          budget_item_id: "item-1",
          front_label: null,
          input_mode: "CONTRACT_PERCENTAGE_POINTS",
          input_value: 10,
        },
      ],
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      currency: "PYG",
    });

    // Global contractual value is 100 * 1000 = 100,000
    // Previously executed clamped at Math.min(130, 100) * 1000 = 100,000 -> 100%
    expect(engineResult.global_current_progress_pct).toBe(100);
    // Target was capped to 0 because itemRemainingBudget is 0
    expect(engineResult.items[0].target_quantity).toBe(0);
    expect(engineResult.items[0].was_capped).toBe(true);
    expect(engineResult.items[0].remaining_quantity).toBe(-30);
  });

  // 11. calculateRecentVelocity: NO utilizar certificado como observación diaria
  it("11. calculateRecentVelocity: NO utilizar certificado como observación diaria", () => {
    const { recentEntries } = computeBaselineWithDeltas({
      budgetItems: [dummyItem],
      baselineCertificate: { id: "cert-6", period_end: "2026-08-20", numero: 6 },
      certificateItems: [
        {
          certificate_id: "cert-6",
          budget_item_id: "item-1",
          codigo: "01.01",
          qty_acumulada: 30,
        },
      ],
      // No daily execution entries logged
      executionEntries: [],
    });

    // recentEntries MUST be empty
    expect(recentEntries.length).toBe(0);

    // Calling calculateRecentVelocity on this item
    const velocity = calculateRecentVelocity(
      "item-1",
      dummyItem.quantity ?? 100,
      7,
      recentEntries,
      "2026-08-25",
      30
    );

    // Confidence MUST remain UNOBSERVED
    expect(velocity.observationsCount).toBe(0);
    expect(velocity.confidence).toBe("UNOBSERVED");
  });
});
