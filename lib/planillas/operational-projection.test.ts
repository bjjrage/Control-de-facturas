import { expect, it } from "vitest";
import { projectMonthlyCurve, projectOperations, type OperationalInputs } from "./operational-projection";
import { computeProjectCostTotals } from "@/lib/costing/cost-budget";

const inputs: OperationalInputs = {
  schedules: { stable: { budgetCode: "old-code", startDay: 1, endDay: 60, source: { sheet: "Plan", row: 2 }, monthlyValues: [{ month: 1, value: 30, cell: "D2" }, { month: 2, value: 70, cell: "E2" }] } },
  unitCosts: { stable: 8 }, materials: [{ key: "p", description: "Material", unit: "kg", links: [{ rowId: "stable", code: "old-code", consumption: 1.5 }] }],
};
const rows = [{ _rowId: "stable", _version: null, code: "edited-code", description: "Partida", quantity: 2, unit_price: 10 }];
it("reconciles quantities, costs and material needs by month using stable item identity", () => {
  const result = projectOperations(rows, inputs);
  expect(result.sale).toBe(20); expect(result.cost).toBe(16);
  expect(result.months.map(month => month.sale)).toEqual([6, 14]);
  expect(result.months.map(month => month.cost)).toEqual([4.8, 11.2]);
  expect(result.months[0].materials[0].quantity).toBeCloseTo(.9);
  expect(result.months[1].materials[0].quantity).toBeCloseTo(2.1);
  expect(result.items[0].schedule?.startDay).toBe(1); expect(result.items[0].schedule?.endDay).toBe(60);
  expect(result.issues).toEqual([]);
});
it("APU changes alter costs and material planning without rewriting the selling price or baseline", () => {
  const revised = structuredClone(inputs); revised.unitCosts.stable = 12; revised.materials[0].links[0].consumption = 2;
  const result = projectOperations(rows, revised);
  expect(result.sale).toBe(20); expect(result.cost).toBe(24);
  expect(result.months[1].cost).toBeCloseTo(16.8); expect(result.months[1].materials[0].quantity).toBeCloseTo(2.8);
  expect(inputs.unitCosts.stable).toBe(8); expect(inputs.schedules.stable.monthlyValues[0].value).toBe(30);
});
it("missing prices and quantities remain pending; missing schedule is explicit", () => {
  const result = projectOperations([{ ...rows[0], quantity: null }], { ...inputs, unitCosts: {} });
  expect(result.sale).toBeNull(); expect(result.cost).toBeNull(); expect(result.months[0].cost).toBeNull(); expect(result.months[0].materials[0].quantity).toBeNull();
  const missing = projectOperations(rows, { ...inputs, schedules: {} }); expect(missing.issues).toHaveLength(1); expect(missing.months).toEqual([]);
});
it("deleted lines stop contributing to every projection", () => {
  const result = projectOperations([{ ...rows[0], _deleted: true }], inputs);
  expect(result.sale).toBe(0); expect(result.cost).toBe(0); expect(result.months).toEqual([]);
});
it("reports use the current item distribution for the cumulative curve and retain executed amounts", () => {
  const projection = projectOperations(rows, inputs);
  expect(projectMonthlyCurve(projection, [4])).toEqual([{ date: "M1", planificado: 6, real: 4 }, { date: "M2", planificado: 20, real: null }]);
  const decreased = projectOperations([{ ...rows[0], quantity: 1 }], inputs);
  expect(projectMonthlyCurve(decreased, [4])[1].planificado).toBe(10);
});
it("fractional quantities use the ERP's exact line rounding before monthly distribution", () => {
  const projection = projectOperations([{ ...rows[0], quantity: 1.125, unit_price: 2548695 }], inputs);
  expect(projection.sale).toBe(2867281.88);
  expect(computeProjectCostTotals([{ id: "stable", quantity: 1.125, unitPrice: 2548695 }], {}).ventaTotal).toBe(2867281.88);
  expect(projection.months.reduce((sum, month) => sum + month.sale!, 0)).toBeCloseTo(2867281.88, 6);
});
