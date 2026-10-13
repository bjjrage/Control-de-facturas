import { describe, expect, it } from "vitest";
import { reconcileOffer, type ComparativeLine, type DocumentFact } from "../domain";
import { isResolvedReview, REVIEW_POLICY, resolveQuoteReview, reviewDifferences } from "../quote-review";
const id = "10000000-0000-4000-8000-000000000001";
const offer: ComparativeLine = {
  id, rfq_item_id: id, quote_version_id: id, provider_id: id, provider_name: "Sintético",
  version_number: 1, precio_unitario: 1000, currency: "PYG", tax_rate: 10, available_quantity: 100,
  lead_time_days: 5, freight: 0, payment_terms: "Contado", valid_until: "2099-01-01T00:00:00Z",
  vat_included: true, attachment_id: id, review_id: null, revoked: false,
};
const fact: DocumentFact = {
  rfq_item_id: id, precio_unitario: 1200, currency: "PYG", tax_rate: 10,
  available_quantity: 100, lead_time_days: 5, freight: 0, payment_terms: "Contado",
  valid_until: "2099-01-01T00:00:00Z",
  vat_included: true,
};
const choices = (facts: DocumentFact[]) => reviewDifferences([offer], facts).map(d => ({ ...d, decision: "verified_original" as const }));
describe("commercial document review", () => {
  it("blocks blanket acceptance and requests for a corrected supplier version", () => {
    expect(() => resolveQuoteReview([offer], [fact], [])).toThrow(/cada diferencia/);
    expect(() => resolveQuoteReview([offer], [fact], choices([fact]).map(d => ({ ...d, decision: "request_correction" })))).toThrow(/versión corregida/);
  });
  it("records exactly the disputed field without overwriting the offer or original evidence", () => {
    const result = resolveQuoteReview([offer], [fact], choices([fact]));
    expect(result.facts[0].precio_unitario).toBe(1000);
    expect(fact.precio_unitario).toBe(1200);
    expect(offer.precio_unitario).toBe(1000);
    expect(result.decisions[0]).toMatchObject({ field: "precio_unitario", structured: 1000, document: 1200 });
    expect(reconcileOffer([offer], result.facts)).toEqual([]);
  });
  it("unknown evidence stays explicit for all commercial fields", () => {
    expect(reviewDifferences([offer], [])).toHaveLength(9);
    expect(reviewDifferences([offer], []).every(d => d.document === null)).toBe(true);
    expect(() => resolveQuoteReview([offer], [], [])).toThrow();
    expect(resolveQuoteReview([offer], [], choices([])).decisions).toHaveLength(9);
  });
  it("rejects missing, stale, duplicate and foreign decisions", () => {
    const c = choices([fact]);
    expect(() => resolveQuoteReview([offer], [{ ...fact, precio_unitario: 1300 }], c)).toThrow(/cambió/);
    expect(() => resolveQuoteReview([offer], [fact], [...c, ...c])).toThrow(/duplicada/);
    expect(() => resolveQuoteReview([offer], [fact], [{ ...c[0], field: "currency" }])).toThrow(/cambió/);
  });
  it("does not add decisions when the actual document agrees", () => {
    expect(resolveQuoteReview([offer], [{ ...fact, precio_unitario: 1000 }], []).differences).toEqual([]);
  });
  it("flags included versus additional IVA even when percentage and unit price agree", () => {
    const mismatches = reviewDifferences([offer], [{ ...fact, precio_unitario: 1000, vat_included: false }]);
    expect(mismatches).toEqual([expect.objectContaining({ field: "vat_included", structured: true, document: false })]);
    expect(() => resolveQuoteReview([offer], [{ ...fact, precio_unitario: 1000, vat_included: false }], [])).toThrow();
  });
  it("requires a specific resolved review after old blanket waivers", () => {
    const comparison = { automatic: [{ field: "precio_unitario" }], human: [] };
    expect(isResolvedReview({ comparison })).toBe(false);
    expect(isResolvedReview({ comparison, extraction: { reviewPolicy: REVIEW_POLICY } })).toBe(true);
    expect(isResolvedReview({ comparison: { ...comparison, human: [{}] }, extraction: { reviewPolicy: REVIEW_POLICY } })).toBe(false);
    expect(isResolvedReview({ comparison: { automatic: [], human: [] } })).toBe(true);
  });
});
