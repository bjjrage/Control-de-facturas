import { describe, expect, it } from "vitest";
import { proposeReceiptQuantities } from "../receipt-document";
import type { ExtractedInvoiceFields } from "@/lib/invoice-extraction";

const lines = [{ id: "cement", product: "Cemento", unit: "bolsa" }];
const document = (items: ExtractedInvoiceFields["items"], order_reference: string | null = null): ExtractedInvoiceFields => ({ provider_name: null, provider_tax_id: null, invoice_number: null, invoice_date: null, subtotal: null, vat: null, total: null, timbrado: null, product_description: null, order_reference, items });
const item = { description: "Cemento", quantity: "5.0000", unit: "bolsa", unit_price: null, subtotal: null };

describe("receipt document proposals", () => {
  it("preserves documented quantities on a unique matching OC line", () => {
    expect(proposeReceiptQuantities(document([item]), lines, "OC-1").quantities).toEqual({ cement: "5.0000" });
  });
  it("does not assign a remito referencing another OC", () => {
    expect(proposeReceiptQuantities(document([item], "OC-2"), lines, "OC-1").quantities).toEqual({});
  });
  it("does not guess a material with incompatible units or ambiguous description", () => {
    expect(proposeReceiptQuantities(document([{ ...item, unit: "kg" }]), lines, "OC-1").quantities).toEqual({});
    expect(proposeReceiptQuantities(document([item]), [...lines, { ...lines[0], id: "other" }], "OC-1").quantities).toEqual({});
  });
  it("requires review of duplicated document rows, unreadable or imprecise quantities", () => {
    for (const items of [[item, item, item], [{ ...item, quantity: null }], [{ ...item, quantity: "1.23456" }]]) {
      const result = proposeReceiptQuantities(document(items), lines, "OC-1");
      expect(result.quantities).toEqual({});
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});
