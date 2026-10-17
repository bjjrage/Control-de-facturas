import { describe, expect, it } from "vitest";
import { issueInvoiceExtractionProof, verifyInvoiceExtractionProof, invoiceIssuerMatches } from "../invoice-extraction-proof";
import type { ExtractedInvoiceFields } from "../invoice-extraction";
const bytes = Buffer.from("original document A");
const fields: ExtractedInvoiceFields = { provider_name: "Proveedor", provider_tax_id: "80000000-1", invoice_number: "001", invoice_date: "2026-10-17", subtotal: 100, vat: 10, total: 110, timbrado: null, order_reference: null, product_description: "Cemento", items: [] };
const input = { empresaId: "tenant", actorId: "admin", bytes, fields };
const now = 1000000;
const proof = () => issueInvoiceExtractionProof(input, "test-secret", now);
describe("file-bound invoice extraction authority", () => {
 it("verifies the original result without another model extraction", () => expect(verifyInvoiceExtractionProof(proof(), input, "test-secret", now)?.fields).toEqual(fields));
 it.each([{ empresaId: "foreign" }, { actorId: "other" }, { bytes: Buffer.from("document B") }])("rejects another file, company or actor %j", change => expect(verifyInvoiceExtractionProof(proof(), {...input, ...change}, "test-secret", now)).toBeNull());
 it("rejects forged issuer and unsigned payload", () => {
   const [payload, signature] = proof().split(".");
   const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()); decoded.fields.provider_tax_id = "88888888-2";
   const forged = Buffer.from(JSON.stringify(decoded)).toString("base64url") + "." + signature;
   expect(verifyInvoiceExtractionProof(forged, input, "test-secret", now)).toBeNull();
   expect(verifyInvoiceExtractionProof(payload, input, "test-secret", now)).toBeNull();
 });
 it("rejects expired or differently signed proofs", () => {
   expect(verifyInvoiceExtractionProof(proof(), input, "test-secret", now + 7200000)).toBeNull();
   expect(verifyInvoiceExtractionProof(proof(), input, "other-secret", now)).toBeNull();
 });
 it("preserves the RUC check digit and fails closed for missing identity", () => {
   expect(invoiceIssuerMatches("80.000.000-1", "800000001")).toBe(true);
   expect(invoiceIssuerMatches("80000000-1", "80000000-9")).toBe(false);
   expect(invoiceIssuerMatches("80000000", "80000000-1")).toBe(false);
   expect(invoiceIssuerMatches(null, "80000000-1")).toBe(false);
 });
});
