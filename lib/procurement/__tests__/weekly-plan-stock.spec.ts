import { describe, expect, it } from "vitest";
import { aggregateProjectStockByProduct } from "../weekly-plan-shared";

describe("canonical project stock aggregation", () => {
  it("sums separate cost-bucket rows for the same product", () => {
    expect(
      aggregateProjectStockByProduct([
        { producto_id: "cement", quantity: "12.5" },
        { producto_id: "cement", quantity: 7.5 },
        { producto_id: "steel", quantity: 4 },
      ])
    ).toEqual({ cement: 20, steel: 4 });
  });

  it("rejects non-finite stock rather than interpreting unknown stock as zero", () => {
    expect(() =>
      aggregateProjectStockByProduct([
        { producto_id: "cement", quantity: "3" },
        { producto_id: "cement", quantity: "not-a-number" },
      ])
    ).toThrow("cantidad inválida");
  });
});
