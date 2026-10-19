import { describe, expect, it } from "vitest";
import { calculateInvoiceVat } from "./invoice-vat";

describe("invoice VAT", () => {
  it("separates included IVA without adding it a second time", () => {
    expect(calculateInvoiceVat(100000, 10, true, "PYG")).toEqual({ subtotal: 90909, vat: 9091, total: 100000 });
    expect(calculateInvoiceVat(105000, 5, true, "PYG")).toEqual({ subtotal: 100000, vat: 5000, total: 105000 });
  });
  it("adds 5% or 10% to an untaxed subtotal", () => {
    expect(calculateInvoiceVat(100000, 5, false, "PYG")).toEqual({ subtotal: 100000, vat: 5000, total: 105000 });
    expect(calculateInvoiceVat(100000, 10, false, "PYG")).toEqual({ subtotal: 100000, vat: 10000, total: 110000 });
  });
  it("supports exempt amounts and currency precision", () => {
    expect(calculateInvoiceVat(100, 0, true, "PYG")).toEqual({ subtotal: 100, vat: 0, total: 100 });
    expect(calculateInvoiceVat(100, 10, true, "USD")).toEqual({ subtotal: 90.91, vat: 9.09, total: 100 });
  });
  it("rejects invalid inputs instead of guessing", () => {
    for (const amount of [0, -1, NaN, Infinity]) expect(calculateInvoiceVat(amount, 10, true, "PYG")).toBeNull();
    expect(calculateInvoiceVat(100, 8, true, "PYG")).toBeNull();
  });
});
