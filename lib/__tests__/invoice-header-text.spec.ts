import { describe, expect, it } from "vitest";
import { printedMoney, printedInvoiceHeader } from "../invoice-header-text";
describe("printed invoice monetary authority",()=>{
 it.each([["454.545,45",454545.45],["45.454,55",45454.55],["500.000",500000],["454,545.45",454545.45],["110000",110000],["1100.50",1100.5]])("preserves printed %s",(text,n)=>expect(printedMoney(String(text))).toBe(n));
 it("retains decimal net/VAT without using inferred line totals",()=>expect(printedInvoiceHeader("Subtotal sin IVA: 454.545,45 PYG\nIVA 10%: 45.454,55 PYG\nTOTAL IVA INCLUIDO: 500.000 PYG\nMoneda: PYG")).toEqual({subtotal:454545.45,vat:45454.55,total:500000,currency:"PYG"}));
 it("preserves printed inconsistency for arithmetic review",()=>expect(printedInvoiceHeader("Subtotal: 100.000 PYG\nIVA TOTAL: 5.000 PYG\nTotal: 110.000 PYG")).toEqual({subtotal:100000,vat:5000,total:110000}));
 it("never takes an item amount or ambiguous totals as a header",()=>expect(printedInvoiceHeader("Item: Cal | subtotal: 100.000\nTotal: 100.000 PYG\nTotal: 200.000 PYG")).toEqual({}));
 it("does not infer monetary precision from malformed text",()=>expect(printedMoney("12.34.567,8x")).toBeNull());
});
