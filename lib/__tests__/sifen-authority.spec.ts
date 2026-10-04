import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SalesDocStatus, SalesDocType } from "../types";
import type { CashflowSources } from "../cashflow/types";
import { buildCanonicalCashflow } from "../cashflow/model";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>, events: [] as string[], persistFails: false,
  provider: vi.fn(), http: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireModule: vi.fn(async () => ({ id: "user", empresa_id: "tenant" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/goekua", () => ({
  isGoekuaConfigured: () => true, goekuaEmitirFactura: state.provider, goekuaConsultarDocumento: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const filters: [string, unknown][] = []; let values: Record<string, unknown> | null = null;
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      update: (value: Record<string, unknown>) => { values = value; return query; },
      async run(single = false) {
        state.events.push((values ? "persist:" : "read:") + table);
        const rows = (state.tables[table] ?? []).filter(row => filters.every(([key,value]) => row[key] === value));
        if (values && state.persistFails) return { data: null, error: { message: "simulated database failure" } };
        if (values) rows.forEach(row => Object.assign(row, values));
        return { data: single ? rows[0] ?? null : rows, error: null };
      },
      single: () => query.run(true), maybeSingle: () => query.run(true), returns: () => query.run(),
      then: (resolve: (value: unknown) => unknown) => query.run().then(resolve),
    };
    return query;
  },
}) }));
import { emitirFE, emitirNC } from "@/app/(internal)/ventas/sifen-actions";
import { SifenButton } from "@/app/(internal)/ventas/[id]/sifen-button";

const item = { id: "item", empresa_id: "tenant", description: "Service", quantity: 1, unit_price: 100, vat_rate: 10, line_total: 100 };
function document(id: string, type: SalesDocType = "FACTURA", status: SalesDocStatus = "EMITIDA", source: string | null = null) {
  return { id, empresa_id: "tenant", client_id: "client", code: "V-001", currency: "PYG", doc_type: type, status,
    total: 100, subtotal: 90, vat_amount: 10, cobrado_amount: 0, source_document_id: source,
    cdc: null, acceptance_status: "DRAFT", quotation_version: 4, due_date: "2026-10-10" };
}
function add(doc: ReturnType<typeof document>) {
  state.tables.sales_documents.push(doc);
  state.tables.sales_document_items.push({ ...item, sales_document_id: doc.id });
  return doc;
}
function acceptedQuote() {
  const quote = add(document("quote", "PROFORMA")); quote.acceptance_status = "ACCEPTED";
  state.tables.work_orders = [{ ...quote, id: "ot", sales_document_id: "quote" }];
  state.tables.work_order_items = [{ ...item, work_order_id: "ot" }];
  state.tables.sales_quotation_acceptances = [{ empresa_id: "tenant", sales_document_id: "quote", work_order_id: "ot",
    client_id: "client", currency_snapshot: "PYG", quotation_version: 4, subtotal_snapshot: 90, vat_snapshot: 10,
    total_snapshot: 100, items_snapshot: [item] }];
}
function noExternalCall() {
  expect(state.provider).not.toHaveBeenCalled(); expect(state.http).not.toHaveBeenCalled();
  expect(state.events.some(event => event.startsWith("persist:"))).toBe(false);
  expect(state.tables.sales_documents.every(doc => doc.cdc === null || doc.id === "source")).toBe(true);
}
beforeEach(() => {
  state.tables = { sales_documents: [], sales_document_items: [], clients: [{ id: "client", empresa_id: "tenant", name: "Client" }],
    empresas: [{ id: "tenant", nombre: "Company", ruc: "8000000-0" }] };
  state.events = []; state.persistFails = false; state.provider.mockReset(); state.http.mockReset();
  state.provider.mockImplementation(async () => { state.events.push("external"); return { id: "provider-id", cdc: "cdc-1", xmlUrl: "xml", kudeUrl: "kude" }; });
  state.http.mockImplementation(async () => { state.events.push("external"); return { status: 201, json: async () => ({ id: "provider-nc", cdc: "cdc-nc", xmlUrl: "xml", kudeUrl: "kude" }) }; });
  vi.stubGlobal("fetch", state.http); vi.stubEnv("GOEKUA_API_KEY", "test-only-placeholder");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("fiscal issuance server authority before the external side effect", () => {
  it.each(["FACTURA", "NOTA_CREDITO"] as const)("rejects BORRADOR %s and leaves CDC unchanged", async type => {
    const doc = add(document("doc", type, "BORRADOR"));
    const result = type === "FACTURA" ? await emitirFE(doc.id) : await emitirNC(doc.id);
    expect(result.error).toMatch(/documento interno/); expect(doc.status).toBe("BORRADOR"); noExternalCall();
  });
  it.each(["FACTURA", "NOTA_CREDITO"] as const)("rejects ANULADA %s", async type => {
    add(document("doc",type,"ANULADA"));
    expect((await (type === "FACTURA" ? emitirFE("doc") : emitirNC("doc"))).error).toBeTruthy(); noExternalCall();
  });
  it.each(["missing", "annulled", "foreign", "client", "currency", "type"])("rejects %s lineage before provider call", async defect => {
    acceptedQuote(); const rem = add(document("source","REMISION","EMITIDA","quote"));
    add(document("doc","FACTURA","EMITIDA","source"));
    if (defect === "missing") state.tables.sales_documents = state.tables.sales_documents.filter(row => row.id !== "source");
    if (defect === "annulled") rem.status = "ANULADA";
    if (defect === "foreign") rem.empresa_id = "foreign";
    if (defect === "client") rem.client_id = "other";
    if (defect === "currency") rem.currency = "USD";
    if (defect === "type") rem.doc_type = "NOTA_VENTA";
    expect((await emitirFE("doc")).error).toBeTruthy(); noExternalCall();
  });
  it.each(["version", "items", "totals"])("rejects invalid accepted OT snapshot %s", async defect => {
    acceptedQuote(); add(document("doc","FACTURA","EMITIDA","quote"));
    if (defect === "version") state.tables.sales_quotation_acceptances[0].quotation_version = 5;
    if (defect === "items") state.tables.work_order_items[0].quantity = 2;
    if (defect === "totals") state.tables.work_orders[0].total = 101;
    expect((await emitirFE("doc")).error).toMatch(/snapshot/); noExternalCall();
  });
  it.each(["BORRADOR", "ANULADA", "missing", "foreign", "REMISION", "no-source"])("rejects invalid NC invoice source %s", async defect => {
    const source = add(document("source")); const nc = add(document("doc","NOTA_CREDITO","EMITIDA","source"));
    if (defect === "BORRADOR" || defect === "ANULADA") source.status = defect;
    if (defect === "missing") state.tables.sales_documents = state.tables.sales_documents.filter(row => row.id !== "source");
    if (defect === "foreign") source.empresa_id = "other";
    if (defect === "REMISION") source.doc_type = "REMISION";
    if (defect === "no-source") nc.source_document_id = null;
    expect((await emitirNC("doc")).error).toBeTruthy(); noExternalCall();
  });
  it.each(["EMITIDA", "COBRADA_PARCIAL", "COBRADA"] as const)("supports valid standalone invoice %s, one provider call and metadata only", async status => {
    const doc = add(document("doc","FACTURA",status));
    expect(await emitirFE("doc")).toMatchObject({ ok:true, cdc:"cdc-1" });
    expect(state.provider).toHaveBeenCalledTimes(1); expect(state.http).not.toHaveBeenCalled();
    expect(doc).toMatchObject({ status, cdc:"cdc-1", xml_url:"xml", kude_url:"kude", cobrado_amount:0 });
    expect(state.events.indexOf("external")).toBeLessThan(state.events.indexOf("persist:sales_documents"));
  });
  it.each(["quote", "rem"])("supports valid OT invoice through %s after reading snapshot", async source => {
    acceptedQuote(); add(document("rem","REMISION","EMITIDA","quote"));
    const doc = add(document("doc","FACTURA","EMITIDA",source));
    expect((await emitirFE("doc")).ok).toBe(true); expect(doc.cdc).toBe("cdc-1");
    expect(state.provider).toHaveBeenCalledTimes(1);
    expect(state.events.indexOf("read:work_order_items")).toBeLessThan(state.events.indexOf("external"));
  });
  it("supports valid NC with an emitted OT invoice and preserves referenced CDC", async () => {
    acceptedQuote(); const source = add(document("source","FACTURA","EMITIDA","quote")); Object.assign(source,{ cdc:"source-cdc" });
    const nc = add(document("doc","NOTA_CREDITO","EMITIDA","source"));
    expect(await emitirNC("doc")).toMatchObject({ok:true,cdc:"cdc-nc"});
    expect(state.http).toHaveBeenCalledTimes(1); expect(state.provider).not.toHaveBeenCalled();
    expect(JSON.parse(state.http.mock.calls[0][1].body)).toMatchObject({referencedCdc:"source-cdc"});
    expect(nc.status).toBe("EMITIDA"); expect(nc.cdc).toBe("cdc-nc");
    expect(state.events.indexOf("read:work_order_items")).toBeLessThan(state.events.indexOf("external"));
  });
  it.each(["FACTURA", "NOTA_CREDITO"] as const)("does not duplicate external emission with existing CDC for %s", async type => {
    const doc=add(document("source",type)); Object.assign(doc,{cdc:"existing"});
    expect((await (type === "FACTURA" ? emitirFE("source") : emitirNC("source"))).error).toMatch(/CDC/); noExternalCall();
  });
  it.each(["FACTURA", "NOTA_CREDITO"] as const)("denies cross-tenant %s even when transport offers it",async type=>{
    const doc=add(document("doc",type)); doc.empresa_id="other";
    expect((await (type === "FACTURA" ? emitirFE("doc") : emitirNC("doc"))).error).toMatch(/no encontrado/); noExternalCall();
  });
  it("never fiscally invoices a REMISION",async()=>{
    add(document("doc","REMISION")); expect((await emitirFE("doc")).error).toMatch(/facturas/); noExternalCall();
  });
  it("reports provider success/database failure without pretending persistence or retrying", async () => {
    const doc=add(document("doc")); state.persistFails=true;
    expect((await emitirFE("doc")).error).toMatch(/cdc-1.*no se pudo guardar/);
    expect(state.provider).toHaveBeenCalledTimes(1); expect(doc.cdc).toBeNull();
  });
});

describe("fiscal UI gate and B09 financial state",()=>{
  it.each(["BORRADOR","ANULADA"] as const)("renders no fiscal control for %s even with a historical CDC", status=>{
    for (const type of ["FACTURA","NOTA_CREDITO"] as const) for (const cdc of [null,"legacy-cdc"]) {
      expect(renderToStaticMarkup(createElement(SifenButton,{docId:"doc",docType:type,status,cdc,kudeUrl:null,xmlUrl:null}))).toBe("");
    }
  });
  it("renders Emitir FE only for issued fiscal types",()=>{
    expect(renderToStaticMarkup(createElement(SifenButton,{docId:"doc",docType:"FACTURA",status:"EMITIDA",cdc:null,kudeUrl:null,xmlUrl:null}))).toContain("Emitir FE");
    expect(renderToStaticMarkup(createElement(SifenButton,{docId:"doc",docType:"REMISION",status:"EMITIDA",cdc:null,kudeUrl:null,xmlUrl:null}))).toBe("");
  });
  it.each(["BORRADOR","EMITIDA","COBRADA_PARCIAL","COBRADA"] as const)("fiscal metadata cannot change B09 receivable for %s",async status=>{
    const doc=add(document("doc","FACTURA",status)); doc.cobrado_amount=status==="COBRADA_PARCIAL"?40:status==="COBRADA"?100:0;
    const sources=():CashflowSources=>({empresa_id:"tenant",read_at:"2026-10-04T12:00:00Z",from:"2026-10-04",until:"2026-11-04",
      accounts:[],expenses:[],projects:[],sales:[doc],receipts:[],certificates:[],orders:[],invoices:[],invoice_links:[],payments:[],payment_links:[],movements:[],labor_payments:[],subcontracts:[],planning:[]});
    const before=buildCanonicalCashflow(sources(),"tenant");
    await emitirFE("doc");
    const after=buildCanonicalCashflow(sources(),"tenant"); expect(after).toEqual(before);
    expect(after).toHaveLength(status==="EMITIDA"||status==="COBRADA_PARCIAL"?1:0);
    if(after.length) expect(after[0].monto).toBe(status==="COBRADA_PARCIAL"?60:100);
    if(status==="BORRADOR") noExternalCall();
  });
});
