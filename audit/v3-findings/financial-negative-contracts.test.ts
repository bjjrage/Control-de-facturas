import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInvoiceLinesInput } from "../lib/invoice-items";
import { autoMatchInvoice } from "../lib/invoice-auto-match";

vi.mock("../lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const invoiceLine = (n: number) => ({
  description: "Componente de obra " + n,
  quantity: "1.0000",
  unit: "un",
  unit_price: 1000,
  subtotal: 1000,
});

function fakeClient(order: {
  id: string;
  code: string;
  product: string;
  total_price: number;
  facturado_amount: number;
}) {
  const links: unknown[] = [];
  const db = {
    from(name: string) {
      if (name === "authorized_orders") {
        return {
          select() {
            return {
              eq() {
                return {
                  async eq() {
                    return { data: [order], error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (name === "invoice_order_matches") {
        return {
          async insert(row: unknown) {
            links.push(row);
            return { data: null, error: null };
          },
        };
      }
      throw new Error("Unexpected table: " + name);
    },
    async rpc() {
      return { data: null, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, links };
}

describe("V3 adversarial repro - exact frozen source only", () => {
  it("baseline: 200 valid manual invoice lines remain complete", () => {
    const lines = parseInvoiceLinesInput(JSON.stringify(Array.from({length: 200}, (_, n) => invoiceLine(n))));
    expect(lines).toHaveLength(200);
  });

  it("V3-002: a supplied 201-line manual invoice must be rejected rather than truncated", () => {
    const payload = JSON.stringify(Array.from({length: 201}, (_, n) => invoiceLine(n)));
    expect(() => parseInvoiceLinesInput(payload)).toThrow();
  });

  it("V3-002: malformed supplied JSON must fail closed", () => {
    expect(() => parseInvoiceLinesInput("[{not-valid-json")).toThrow();
  });

  it("V3-002: one invalid line amongst valid lines must fail closed", () => {
    const payload = JSON.stringify([invoiceLine(1), { description: "", quantity: "2.0000" }]);
    expect(() => parseInvoiceLinesInput(payload)).toThrow();
  });

  it("V3-003: single open PO with mismatched amount and no context must stay unlinked", async () => {
    const { db, links } = fakeClient({
      id: "oc-one",
      code: "OC-ONLY",
      product: "Arena",
      total_price: 10000000,
      facturado_amount: 0,
    });
    const result = await autoMatchInvoice(db, {
      invoiceId: "invoice-new",
      providerId: "provider-A",
      total: 3000000,
      empresaId: "empresa-A",
      orderReference: null,
      productDescription: null,
    });
    expect(result).toBeNull();
    expect(links).toHaveLength(0);
  });

  it("V3-003: single open PO mismatching reference, product and amount must stay unlinked", async () => {
    const { db, links } = fakeClient({
      id: "oc-one",
      code: "OC-ALPHA",
      product: "Arena",
      total_price: 10000000,
      facturado_amount: 0,
    });
    const result = await autoMatchInvoice(db, {
      invoiceId: "invoice-new",
      providerId: "provider-A",
      total: 3000000,
      empresaId: "empresa-A",
      orderReference: "OC-OTHER",
      productDescription: "Cemento",
    });
    expect(result).toBeNull();
    expect(links).toHaveLength(0);
  });
});
