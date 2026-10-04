import { beforeEach, describe, expect, it, vi } from "vitest";
import { SALES_DOC_FORM_TYPES, SALES_DOC_TYPE_LABELS } from "../sales";

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, writes: [] as string[] }));
vi.mock("@/lib/auth", () => ({ requireModule: vi.fn(async () => ({ id: "user", empresa_id: "tenant" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    let filters: [string, unknown][] = []; let values: Record<string, unknown> | null = null;
    let operation = "read";
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (key: string, value: unknown[]) => { filters.push([key, value]); return query; },
      insert: (value: Record<string, unknown>) => { operation = "insert"; values = value; return query; },
      update: (value: Record<string, unknown>) => { operation = "update"; values = value; return query; },
      delete: () => { operation = "delete"; return query; },
      async run(single = false) {
        const rows = state.tables[table] ?? [];
        const matched = rows.filter(row => filters.every(([k,v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
        if (operation !== "read") state.writes.push(operation + ":" + table);
        if (operation === "insert") {
          const row = { id: "created-" + rows.length, empresa_id: "tenant", ...values };
          state.tables[table] = [...rows, row]; return { data: row, error: null };
        }
        if (operation === "update") matched.forEach(row => Object.assign(row, values));
        if (operation === "delete") state.tables[table] = rows.filter(row => !matched.includes(row));
        return { data: single ? matched[0] ?? null : matched, error: null };
      },
      single: () => query.run(true), maybeSingle: () => query.run(true), returns: () => query.run(),
      then: (resolve: (value: unknown) => unknown) => query.run().then(resolve),
    };
    return query;
  },
}) }));
import { createSalesDocument, updateSalesDocument, emitSalesDocument, deleteSalesDocument, voidSalesDocument } from "@/app/(internal)/ventas/actions";

function document(id: string, type = "FACTURA", source: string | null = null) {
  return { id, empresa_id: "tenant", client_id: "client", currency: "PYG", doc_type: type,
    status: "BORRADOR", total: 100, subtotal: 90, vat_amount: 10, cobrado_amount: 0,
    acceptance_status: "DRAFT", quotation_version: 4, source_document_id: source };
}
function form(type: string, source?: string, ot?: string) {
  const fd = new FormData();
  fd.set("doc_type", type); fd.set("client_id", "client"); fd.set("currency", "PYG");
  fd.set("items", JSON.stringify([{ description: "Service", quantity: 1, unit_price: 100, vat_rate: 10 }]));
  if (source) fd.set("source_document_id", source);
  if (ot) fd.set("work_order_id", ot);
  return fd;
}
function acceptedQuote() {
  const quote = { ...document("quote", "PROFORMA"), acceptance_status: "ACCEPTED" };
  state.tables.sales_documents.push(quote);
  state.tables.clients = [{ id: "client", empresa_id: "tenant" }];
  state.tables.work_orders = [{ ...quote, id: "ot", sales_document_id: "quote" }];
  const item = { description: "Service", quantity: 1, unit_price: 100, vat_rate: 10, line_total: 100 };
  state.tables.work_order_items = [{ ...item, id: "item", empresa_id: "tenant", work_order_id: "ot" }];
  state.tables.sales_quotation_acceptances = [{ empresa_id: "tenant", sales_document_id: "quote", work_order_id: "ot",
    client_id: "client", currency_snapshot: "PYG", quotation_version: 4, subtotal_snapshot: 90, vat_snapshot: 10,
    total_snapshot: 100, items_snapshot: [item] }];
}
beforeEach(() => { state.tables = { sales_documents: [document("draft")] }; state.writes = []; });

describe("Sales server authority (actual actions, authenticated untrusted input)", () => {
  it.each(SALES_DOC_FORM_TYPES)("creates and updates allowed %s", async type => {
    expect((await createSalesDocument(form(type))).error).toBeNull();
    expect((await updateSalesDocument("draft", form(type))).error).toBeNull();
    expect(state.tables.sales_documents[0].doc_type).toBe(type);
  });
  it.each(["NOTA_VENTA", "INVALID", "factura"])("rejects crafted create/update %s with no writes", async type => {
    expect((await createSalesDocument(form(type))).error).toMatch(/Tipo/);
    expect((await updateSalesDocument("draft", form(type))).error).toMatch(/Tipo/);
    expect(state.writes).toEqual([]);
  });
  it("keeps legacy NOTA_VENTA readable and collectible", () => {
    expect(SALES_DOC_TYPE_LABELS.NOTA_VENTA).toBe("Nota de Venta");
    expect(SALES_DOC_FORM_TYPES).not.toContain("NOTA_VENTA");
  });
  it.each(["REMISION", "FACTURA"])("OT to %s retains quote ID and emits valid chain", async type => {
    acceptedQuote(); const result = await createSalesDocument(form(type, "quote", "ot"));
    expect(result.error).toBeNull();
    if (!("id" in result)) throw new Error("Draft creation failed");
    const created = state.tables.sales_documents.find(row => row.id === result.id)!;
    expect(created.source_document_id).toBe("quote"); Object.assign(created, { status: "BORRADOR", total: 100 });
    expect((await emitSalesDocument(result.id!)).error).toBeNull();
  });
  it("OT to remision to invoice, multiple descendants, invoice to NC", async () => {
    acceptedQuote(); state.tables.sales_documents.push(document("rem", "REMISION", "quote"));
    for (let i = 0; i < 2; i++) {
      const result = await createSalesDocument(form("FACTURA", "rem")); expect(result.error).toBeNull();
      if (!("id" in result)) throw new Error("Invoice creation failed");
      const created = state.tables.sales_documents.find(row => row.id === result.id)!;
      Object.assign(created, { status: "BORRADOR", total: 100 });
      expect(created.source_document_id).toBe("rem");
      expect((await emitSalesDocument(result.id!)).error).toBeNull();
      const nc = await createSalesDocument(form("NOTA_CREDITO", result.id!)); expect(nc.error).toBeNull();
      if (!("id" in nc)) throw new Error("NC creation failed");
      Object.assign(state.tables.sales_documents.find(row => row.id === nc.id)!, { status: "BORRADOR", total: 100 });
      expect((await emitSalesDocument(nc.id!)).error).toBeNull();
    }
    expect((await deleteSalesDocument("rem")).error).toMatch(/derivados/);
    expect((await voidSalesDocument("rem")).error).toMatch(/derivados/);
    expect(state.tables.sales_documents.filter(row => row.doc_type === "FACTURA" && row.source_document_id === "rem")).toHaveLength(2);
  });
  it.each(["missing", "annulled", "foreign", "version", "items", "totals", "client", "currency", "root-missing"])("blocks issuance with %s chain", async defect => {
    acceptedQuote(); state.tables.sales_documents.push(document("rem", "REMISION", "quote"), document("invoice", "FACTURA", "rem"));
    const quote = state.tables.sales_documents.find(row => row.id === "quote")!;
    const rem = state.tables.sales_documents.find(row => row.id === "rem")!;
    if (defect === "missing") state.tables.sales_documents = state.tables.sales_documents.filter(row => row.id !== "rem");
    if (defect === "annulled") rem.status = "ANULADA";
    if (defect === "foreign") rem.empresa_id = "other";
    if (defect === "version") quote.quotation_version = 5;
    if (defect === "items") state.tables.work_order_items[0].quantity = 2;
    if (defect === "totals") state.tables.work_orders[0].total = 101;
    if (defect === "client") rem.client_id = "other";
    if (defect === "currency") rem.currency = "USD";
    if (defect === "root-missing") rem.source_document_id = null;
    expect((await emitSalesDocument("invoice")).error).toBeTruthy();
    expect(state.tables.sales_documents.find(row => row.id === "invoice")!.status).toBe("BORRADOR");
    expect(state.writes).toEqual([]);
  });
  it.each(["foreign", ""])("rejects a crafted source rewrite/clear %s", async source => {
    acceptedQuote(); state.tables.sales_documents.push(document("rem", "REMISION", "quote"));
    const fd = form("REMISION"); fd.set("source_document_id", source);
    expect((await updateSalesDocument("rem", fd)).error).toMatch(/inmutable/);
    expect(state.tables.sales_documents.find(row => row.id === "rem")!.source_document_id).toBe("quote");
    expect(state.writes).toEqual([]);
  });
  it("preserves a canonical NC from an emitted standalone invoice", async () => {
    state.tables.sales_documents[0].status = "EMITIDA";
    state.tables.sales_documents.push(document("nc", "NOTA_CREDITO", "draft"));
    expect((await emitSalesDocument("nc")).error).toBeNull();
  });
});
