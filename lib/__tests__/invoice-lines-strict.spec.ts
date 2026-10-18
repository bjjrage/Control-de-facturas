import { describe, expect, it } from "vitest";
import { parseInvoiceLinesInputStrict } from "../invoice-items";

describe("#1 invoice line input integrity", () => {
  it("rejects the entire payload when one of several lines is invalid", () => {
    const result = parseInvoiceLinesInputStrict([
      { description: "Valid product", quantity: 1, unit_price: 10 },
      { description: "", quantity: 1, unit_price: 10 },
    ]);
    expect(result.error).toMatch(/l[ií]nea/i);
    expect(result.items).toEqual([]);
  });

  it("accepts all valid lines and rejects truncated input", () => {
    expect(parseInvoiceLinesInputStrict([{ description: "Valid", quantity: 1, unit_price: 10 }]).items)
      .toHaveLength(1);
    expect(parseInvoiceLinesInputStrict(Array.from({ length: 201 }, (_, i) => ({ description: `Line ${i}` }))).error)
      .toBeTruthy();
  });
});
