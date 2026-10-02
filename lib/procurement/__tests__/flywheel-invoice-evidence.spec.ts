import { describe, expect, it } from "vitest";
import { recordCostObservationFromInvoice, validateInvoiceLineEvidence } from "../flywheel";

function fakeSupabase() {
  const calls: { table: string; select?: string; inserted?: Record<string, unknown> }[] = [];
  const supabase = {
    from(table: string) {
      const call = { table } as (typeof calls)[number];
      calls.push(call);
      let mode: "select" | "insert" | null = null;
      const query: any = {
        select(columns: string) {
          call.select = columns;
          mode = "select";
          return query;
        },
        insert(row: Record<string, unknown>) {
          call.inserted = row;
          mode = "insert";
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle: async () => {
          if (table === "authorized_orders") return { data: { project_id: "project-1" }, error: null };
          if (mode === "insert") return { data: { id: "observation-1" }, error: null };
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { supabase, calls };
}

describe("invoice flywheel line evidence", () => {
  it("rechaza una línea sin precio explícito antes de consultar o insertar, aunque tenga OC asociada", async () => {
    const { supabase, calls } = fakeSupabase();
    const result = await recordCostObservationFromInvoice(supabase, {
      empresaId: "empresa-1",
      invoiceId: "invoice-1",
      providerId: "provider-1",
      orderId: "order-1",
      itemDescription: "Cemento",
      quantity: 2,
      unit: "bolsa",
      invoiceDate: "2026-09-30",
    });

    expect(result).toEqual({ recorded: false, reason: "MISSING_INVOICE_LINE_UNIT_PRICE" });
    expect(calls).toHaveLength(0);
  });

  it("registra el precio de línea 95 y sólo lee de la OC el contexto del proyecto, aunque su precio sea 100", async () => {
    const { supabase, calls } = fakeSupabase();
    const result = await recordCostObservationFromInvoice(supabase, {
      empresaId: "empresa-1",
      invoiceId: "invoice-1",
      providerId: "provider-1",
      orderId: "order-1",
      itemDescription: "Cemento",
      productoId: "cemento",
      quantity: 2,
      unit: "bolsa",
      unitPrice: 95,
      currency: "PYG",
      invoiceDate: "2026-09-30",
    });

    const orderRead = calls.find((call) => call.table === "authorized_orders");
    const insert = calls.find((call) => call.table === "cost_observations" && call.inserted)?.inserted;
    expect(result.recorded).toBe(true);
    expect(orderRead?.select).toBe("project_id");
    expect(insert).toMatchObject({ fuente: "FACTURA", precio_unitario: 95, project_id: "project-1", cantidad: 2, unidad: "bolsa" });
  });

  it("valida cantidad, unidad y precio explícitos y finitos", () => {
    const validBase = { itemDescription: "Cemento", quantity: 1, unit: "bolsa", unitPrice: 95, invoiceDate: "2026-09-30" };
    expect(validateInvoiceLineEvidence(validBase).valid).toBe(true);
    expect(validateInvoiceLineEvidence({ ...validBase, unitPrice: Number.NaN })).toMatchObject({ valid: false, reason: "INVALID_INVOICE_LINE_UNIT_PRICE" });
    expect(validateInvoiceLineEvidence({ ...validBase, quantity: 0 })).toMatchObject({ valid: false, reason: "INVALID_INVOICE_LINE_QUANTITY" });
    expect(validateInvoiceLineEvidence({ ...validBase, unit: " " })).toMatchObject({ valid: false, reason: "MISSING_INVOICE_LINE_UNIT" });
  });
});
