import { describe, expect, it } from "vitest";
import { invoiceOrderContextMatches } from "../invoice-auto-match";
const order = { orderCode: "OC-2026-0010", orderProduct: "Cemento QA proveedor" };
describe("automatic invoice association evidence", () => {
 it("rejects a different product even with the exact OC reference", () => expect(invoiceOrderContextMatches({ ...order, descriptions: ["Cal agricola QA"], orderReference: order.orderCode })).toBe(false));
 it("rejects absent evidence regardless of one candidate/equal amount", () => expect(invoiceOrderContextMatches({ ...order, descriptions: [] })).toBe(false));
 it("rejects a conflicting or partial OC reference", () => {
   expect(invoiceOrderContextMatches({ ...order, descriptions: ["Cemento"], orderReference: "OC-2026-0011" })).toBe(false);
   expect(invoiceOrderContextMatches({ ...order, descriptions: ["Cemento"], orderReference: "OC-2026-001" })).toBe(false);
 });
 it("accepts documented matching product, including a partial invoice", () => expect(invoiceOrderContextMatches({ ...order, descriptions: ["Cemento QA proveedor"], orderReference: "Según OC-2026-0010" })).toBe(true));
 it("rejects generic subset product evidence", () => expect(invoiceOrderContextMatches({ orderCode: order.orderCode, orderProduct: "Material de construcción", descriptions: ["Material"] })).toBe(false));
 it("requires every documented product to match", () => expect(invoiceOrderContextMatches({ ...order, descriptions: ["Cemento", "Cal agricola"] })).toBe(false));
});
