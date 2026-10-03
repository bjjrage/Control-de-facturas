import { describe, it, expect } from "vitest";
import {
  magicLinkOpen,
  proposeAllocations,
  validateAllocation,
  reconcileOffer,
  offerSchema,
  offerLineSchema,
  type ComparativeLine,
  type RfqItem,
} from "../domain";
import { extractDocumentFacts } from "../reconciliation";
const id = "10000000-0000-4000-8000-000000000001",
  id2 = "10000000-0000-4000-8000-000000000002";
const items: RfqItem[] = [
  { id, descripcion: "Cement", cantidad: 10, unidad: "kg", producto_id: null },
];
const offer: ComparativeLine = {
  id,
  rfq_item_id: id,
  quote_version_id: id,
  provider_id: id,
  provider_name: "A",
  version_number: 2,
  currency: "PYG",
  precio_unitario: 10,
  tax_rate: 10,
  available_quantity: 6,
  lead_time_days: 3,
  vat_included: false,
  freight: 5,
  payment_terms: "cash",
  valid_until: "2099-01-01T00:00:00Z",
  attachment_id: id,
  review_id: id,
  revoked: false,
};
describe("RFQ domain invariants", () => {
  it.each([
    { token_revoked_at: "2026-01-01" },
    { token_expires_at: "2000-01-01" },
  ])("rejects revoked or expired link %j", (link) =>
    expect(
      magicLinkOpen(link, { expires_at: "2099-01-01", status: "COTIZANDO" }),
    ).toBe(false),
  );
  it("closed RFQ never accepts a magic link", () =>
    expect(
      magicLinkOpen({}, { expires_at: "2099-01-01", status: "AUTORIZADO" }),
    ).toBe(false));
  it("partial split leaves residual and never overassigns", () =>
    expect(
      validateAllocation([{ quote_version_item_id: id, quantity: 6 }], items, [
        offer,
      ])[0].unallocated,
    ).toBe(4));
  it.each([-1, Infinity, NaN, 0])("rejects bad allocation %s", (quantity) =>
    expect(() =>
      validateAllocation([{ quote_version_item_id: id, quantity }], items, [
        offer,
      ]),
    ).toThrow(),
  );
  it("rejects cross-item, missing review and insufficient availability", () => {
    expect(() =>
      validateAllocation([{ quote_version_item_id: id, quantity: 7 }], items, [
        offer,
      ]),
    ).toThrow(/Disponibilidad/);
    expect(() =>
      validateAllocation([{ quote_version_item_id: id, quantity: 1 }], items, [
        { ...offer, review_id: null },
      ]),
    ).toThrow(/Oferta/);
    expect(() =>
      validateAllocation(
        [{ quote_version_item_id: id, quantity: 1 }],
        [],
        [offer],
      ),
    ).toThrow(/Ítem/);
  });
  it("all proposals are non-decisions and currencies never pooled", () => {
    const scenarios = proposeAllocations(items, [
      offer,
      { ...offer, id: id2, provider_id: id2, currency: "USD" },
    ]);
    expect(scenarios.length).toBeGreaterThan(5);
    expect(scenarios.every((s) => s.decision === false)).toBe(true);
    expect(scenarios.every((s) => s.lines.length === 1)).toBe(true);
    expect(
      scenarios.every((s) => s.warnings.some((w) => w.includes("FX"))),
    ).toBe(true);
  });
  it("human terms scores and weighted scenario; no prose ranking", () => {
    expect(
      proposeAllocations(items, [offer]).some((s) => s.kind === "TERMS"),
    ).toBe(false);
    expect(
      proposeAllocations(items, [offer], { termScores: { [id]: 0.8 } }).some(
        (s) => s.kind === "TERMS",
      ),
    ).toBe(true);
  });
  it("quote invalidity removes proposals", () =>
    expect(
      proposeAllocations(items, [{ ...offer, valid_until: "2000-01-01" }]),
    ).toEqual([]));
  it("reconciliation exposes discrepancies and unknowns, never mutates offer", () => {
    const input = structuredClone(offer);
    const results = reconcileOffer(
      [input],
      [{ rfq_item_id: id, precio_unitario: 999, currency: "USD" }],
    );
    expect(results.filter((r) => r.reason === "Discrepancia")).toHaveLength(2);
    expect(results.some((r) => r.reason.includes("evidencia"))).toBe(true);
    expect(input).toEqual(offer);
  });
  it("ambiguous prices and descriptions remain unknown", () => {
    const facts = extractDocumentFacts(
      {
        documentId: id,
        mimeType: "application/xlsx",
        extractionMethod: "xlsx_structured",
        warnings: [],
        truncated: false,
        requiresVision: false,
        structured: {
          sheets: [
            {
              name: "Q",
              cols: [],
              rows: [
                {
                  descripcion: "Cement",
                  "precio unitario": "1.000,00",
                  moneda: "PYG",
                },
              ],
            },
          ],
        },
      },
      items,
    );
    expect(facts[0].precio_unitario).toBeUndefined();
  });
  it("offer requires all factual fields and finite values", () => {
    expect(offerSchema.safeParse({ currency: "PYG" }).success).toBe(false);
    expect(
      offerLineSchema.safeParse({ ...offer, precio_unitario: Infinity })
        .success,
    ).toBe(false);
  });
  it("all eight proposal kinds require human decisions, including custom", () => {
    const result = proposeAllocations(items, [offer], {
      termScores: { [id]: 0.8 },
      custom: [{ quote_version_item_id: id, quantity: 2 }],
    });
    expect(new Set(result.map((s) => s.kind))).toEqual(
      new Set([
        "ONE_SUPPLIER",
        "CHEAPEST",
        "LOTS",
        "FASTEST",
        "TERMS",
        "WEIGHTED",
        "PARTIAL",
        "CUSTOM",
      ]),
    );
    expect(result.every((s) => s.decision === false)).toBe(true);
  });
  it("equivalent validity timestamps are not a document discrepancy", () => {
    expect(
      reconcileOffer(
        [offer],
        [{ rfq_item_id: id, valid_until: "2099-01-01T00:00:00.000+00:00" }],
      ).some((d) => d.field === "valid_until"),
    ).toBe(false);
  });
});
