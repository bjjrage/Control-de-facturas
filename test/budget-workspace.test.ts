import { describe, expect, it } from "vitest";
import { budgetWorkspaceValues, parseWorkspaceNumber, pasteWorkspaceRange, rebaseWorkspaceValues, type BudgetWorkspaceRow } from "@/lib/projects/budget-workspace";

const rows: BudgetWorkspaceRow[] = [
  { id: "a", code: "1", description: "Revoque", unit: "m2", quantity: 1, unitPrice: 100, subtotal: 100 },
  { id: "b", code: "2", description: "Pintura", unit: "m2", quantity: 2, unitPrice: 50, subtotal: 100 },
];
describe("budget workspace clipboard", () => {
  it("preserves decimal coefficients and explicit zero/empty values", () => {
    expect(parseWorkspaceNumber("1.7424")).toBe(1.7424);
    expect(parseWorkspaceNumber("2,5")).toBe(2.5);
    expect(parseWorkspaceNumber("0")).toBe(0);
    expect(parseWorkspaceNumber("")).toBeNull();
    expect(parseWorkspaceNumber("1234000")).toBe(1234000);
  });
  it.each(["1.234", "1,234", "1.234.567", "1e4", "NaN", "Infinity", "=1+1", "-2"])("refuses ambiguous or unsafe %s", text => {
    expect(() => parseWorkspaceNumber(text)).toThrow();
  });
  it("stages an entire rectangle in visible order without changing saved totals or row identifiers", () => {
    const result = pasteWorkspaceRange(rows, 0, "quantity", "2,5\t120\r\n3\t60\r\n");
    expect(result.map(row => [row.id, row.quantity, row.unitPrice, row.subtotal])).toEqual([["a", 2.5, 120, 100], ["b", 3, 60, 100]]);
    expect(rows[0].quantity).toBe(1);
  });
  it("rejects the whole paste when any later cell is invalid", () => {
    expect(() => pasteWorkspaceRange(rows, 0, "quantity", "2\t120\n1.234\t60")).toThrow("ambiguo");
    expect(rows.map(row => row.quantity)).toEqual([1, 2]);
  });
  it("protects code, totals, hidden rows and nonrectangular ranges", () => {
    for (const [row, column, text] of [[0, "code", "9"], [0, "unitPrice", "2\t3"], [1, "quantity", "2\n3"], [0, "description", "x\ty\nz"]] as const) {
      expect(() => pasteWorkspaceRange(rows, row, column, text)).toThrow();
    }
  });
  it("does not silently round past database precision", () => {
    expect(budgetWorkspaceValues.safeParse({ description: "a", unit: null, quantity: 1.74241, unitPrice: 2 }).success).toBe(false);
    expect(budgetWorkspaceValues.safeParse({ description: "a", unit: null, quantity: 1.7424, unitPrice: 2.555 }).success).toBe(false);
  });
  it("keeps a colleague's price when reviewing only a quantity edit", () => {
    const expected = rows[0];
    const next = { ...expected, quantity: 3 };
    const current = { ...expected, unitPrice: 120, description: "Revoque exterior" };
    expect(rebaseWorkspaceValues(expected, next, current)).toEqual({ description: "Revoque exterior", unit: "m2", quantity: 3, unitPrice: 120 });
  });
});
