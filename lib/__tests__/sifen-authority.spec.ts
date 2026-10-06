import { createElement } from "react";
import { readFileSync } from "node:fs";
import { GOEKUA_NC_MOTIVES } from "../goekua";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SalesDocStatus, SalesDocType } from "../types";
import type { CashflowSources } from "../cashflow/types";
import { buildCanonicalCashflow } from "../cashflow/model";

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>, events: [] as string[], persistFails: false, auditFails: false, audit: vi.fn(),
  provider: vi.fn(), http: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireModule: vi.fn(async () => ({ id: "user", empresa_id: "tenant" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/goekua", async importOriginal => ({
  ...await importOriginal<typeof import("../goekua")>(), goekuaEmitirFactura: state.provider,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (_name: string, args: unknown) => { state.audit(args); return { data: "audit-id", error: state.auditFails ? {message:"failure"} : null }; },
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
import { emitirFE, emitirNC as issueNC, consultarFE } from "@/app/(internal)/ventas/sifen-actions";
import { SifenButton } from "@/app/(internal)/ventas/[id]/sifen-button";

const emitirNC = (id: string, choice = { emissionMotive: 2, sourceItemIds: ["item"] }) => issueNC(id, choice);
const CDC = "1".repeat(44);
const SOURCE_CDC = "2".repeat(44);
const item = { id: "item", empresa_id: "tenant", description: "Service", quantity: 1, unit_price: 100, vat_rate: 10, line_total: 100 };
function document(id: string, type: SalesDocType = "FACTURA", status: SalesDocStatus = "EMITIDA", source: string | null = null) {
  return { id, empresa_id: "tenant", client_id: "client", code: "0000001", currency: "PYG", doc_type: type, status,
    total: 100, subtotal: 90, vat_amount: 10, cobrado_amount: 0, source_document_id: source,
    cdc: null, goekua_document_id: null, acceptance_status: "DRAFT", quotation_version: 4, due_date: "2026-10-10" };
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
}
beforeEach(() => {
  state.tables = { sales_documents: [], sales_document_items: [], clients: [{ id: "client", empresa_id: "tenant", name: "Client", address: "Synthetic address", tax_id: "80000000-1" }],
    empresas: [{ id: "tenant", nombre: "Company", ruc: "8000000-0", email_empresa: "issuer@example.test" }] };
  state.events = []; state.persistFails = false; state.provider.mockReset(); state.http.mockReset();
  state.auditFails = false; state.audit.mockReset();
  for (const key of ["GOEKUA_TRANSACTION_TYPE","GOEKUA_OPERATION_CONDITION_TYPE","GOEKUA_EMISSION_TYPE","GOEKUA_PRESENCE_INDICATOR_TYPE","GOEKUA_PAYMENT_TYPE"]) vi.stubEnv(key,"1");
  state.provider.mockImplementation(async payload => (await vi.importActual<typeof import("../goekua")>("../goekua")).goekuaEmitirFactura(payload));
  state.http.mockImplementation(async () => { state.events.push("external"); return { status: 201, json: async () => ({ id: "provider-id", cdc: CDC, xmlUrl: "xml", kudeUrl: "kude" }) }; });
  vi.stubGlobal("fetch", state.http); vi.stubEnv("GOEKUA_API_KEY", "test-only-placeholder");
  for (const [key,value] of Object.entries({ GOEKUA_BASE_URL:"https://goekua.example.test",GOEKUA_ESTABLISHMENT_ID:"001",GOEKUA_POINT_OF_EXPEDITION:"002",GOEKUA_USER_NAME:"Synthetic",GOEKUA_USER_LAST_NAME:"Issuer",GOEKUA_USER_DOCUMENT_TYPE:"2",GOEKUA_USER_DOCUMENT_NUMBER:"90000000-1",GOEKUA_ESTABLISHMENT_ADDRESS:"Synthetic street",GOEKUA_ESTABLISHMENT_HOUSE_NUMBER:"10",GOEKUA_ESTABLISHMENT_CITY_ID:"1",GOEKUA_ESTABLISHMENT_PHONE:"000000",GOEKUA_MEASURE_UNIT:"77" })) vi.stubEnv(key,value);
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
    expect(await emitirFE("doc")).toMatchObject({ ok:true, cdc:CDC });
    expect(state.provider).toHaveBeenCalledTimes(1); expect(state.http).toHaveBeenCalledTimes(1);
    expect(doc).toMatchObject({ status, cdc:CDC, xml_url:"xml", kude_url:"kude", cobrado_amount:0 });
    expect(state.events.indexOf("external")).toBeLessThan(state.events.indexOf("persist:sales_documents"));
  });
  it.each(["quote", "rem"])("supports valid OT invoice through %s after reading snapshot", async source => {
    acceptedQuote(); add(document("rem","REMISION","EMITIDA","quote"));
    const doc = add(document("doc","FACTURA","EMITIDA",source));
    expect((await emitirFE("doc")).ok).toBe(true); expect(doc.cdc).toBe(CDC);
    expect(state.provider).toHaveBeenCalledTimes(1);
    expect(state.events.indexOf("read:work_order_items")).toBeLessThan(state.events.indexOf("external"));
  });
  it("supports valid NC with an emitted OT invoice and preserves referenced CDC", async () => {
    acceptedQuote(); const source = add(document("source","FACTURA","EMITIDA","quote")); Object.assign(source,{ cdc:SOURCE_CDC });
    const nc = add(document("doc","NOTA_CREDITO","EMITIDA","source"));
    expect(await emitirNC("doc")).toMatchObject({ok:true,cdc:CDC});
    expect(state.http).toHaveBeenCalledTimes(1); expect(state.provider).not.toHaveBeenCalled();
    expect(JSON.parse(state.http.mock.calls[0][1].body)).toMatchObject({cdcElectronicDocumentAttached:SOURCE_CDC, emissionMotive:2});
    expect(nc.status).toBe("EMITIDA"); expect(nc.cdc).toBe(CDC);
    expect(state.events.indexOf("read:work_order_items")).toBeLessThan(state.events.indexOf("external"));
  });
  it.each(["FACTURA", "NOTA_CREDITO"] as const)("does not duplicate external emission with existing CDC for %s", async type => {
    const source=add(document("invoice")); Object.assign(source,{cdc:SOURCE_CDC});
    const doc=add(document("source",type,"EMITIDA",type==="NOTA_CREDITO"?"invoice":null)); Object.assign(doc,{cdc:CDC});
    expect((await (type === "FACTURA" ? emitirFE("source") : emitirNC("source"))).error).toMatch(/CDC/); noExternalCall();
    expect(doc.cdc).toBe(CDC);
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
    expect((await emitirFE("doc")).error).toMatch(/provider-id.*no se pudo guardar/);
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

describe("Goekua actual outbound request contract (mocked HTTP only)", () => {
  function nc() {
    const source = add(document("source")); Object.assign(source, { cdc: SOURCE_CDC });
    return add(document("doc", "NOTA_CREDITO", "EMITIDA", "source"));
  }
  function body() { return JSON.parse(state.http.mock.calls[0][1].body); }
  it("serializes the current invoice DTO, with exact nested field names", async () => {
    add(document("doc")); await emitirFE("doc");
    expect(state.http.mock.calls[0][0]).toBe("https://goekua.example.test/api/electronic-document/generate-invoice");
    expect(body()).toEqual({
      user: { name:"Synthetic",lastName:"Issuer",email:"issuer@example.test",documentType:2,documentNumber:"90000000-1" },
      establishment: { idSifen:"001",address:"Synthetic street",houseNumber:10,cityId:1,phone:"000000",email:"issuer@example.test",denomination:"Company" },
      client: { ruc:"80000000-1",businessName:"Client",address:"Synthetic address",isContributor:true },
      items: [{code:"item",description:"Service",measureUnit:77,amount:1,unitPrice:100,unitDiscountPercentage:0,unitNetDiscount:0,taxPercentage:100,taxRate:10,ivaType:1}],
      paymentMethods:[{paymentType:1,charge:100,currency:"PYG",currencyRate:1}],
      currency:"PYG",currencyRate:1,transactionType:1,operationConditionType:1,emissionType:1,presenceIndicatorType:1,pointOfExpedition:"002",documentNumber:"0000001",
    });
  });
  it("serializes the distinct NC DTO and preserves the human choice and source CDC", async () => {
    nc(); await emitirNC("doc", {emissionMotive:8,sourceItemIds:["item"]});
    expect(state.http.mock.calls[0][0]).toContain("/generate-credit-note");
    expect(body()).toEqual({
      cdcElectronicDocumentAttached:SOURCE_CDC,emissionMotive:8,
      user:{name:"Synthetic",lastName:"Issuer",email:"issuer@example.test",documentType:2,documentNumber:"90000000-1"},
      establishment:{idSifen:"001",address:"Synthetic street",houseNumber:10,cityId:1,phone:"000000",email:"issuer@example.test",denomination:"Company"},
      items:[{code:"item",amount:1,unitPrice:100}],pointOfExpedition:"002",documentNumber:"0000001",
    });
    expect(body()).not.toHaveProperty("referencedCdc");
    expect(body()).not.toHaveProperty("client");
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ p_detail: expect.objectContaining({emissionMotive:8,source_document_id:"source",cdcElectronicDocumentAttached:SOURCE_CDC}) }));
  });
  it.each(["FACTURA","NOTA_CREDITO"] as const)("stores ID-only %s and blocks retry/consultation without HTTP", async type => {
    const doc = type === "FACTURA" ? add(document("doc")) : nc();
    state.http.mockResolvedValue({status:201,json:async()=>({id:"opaque-provider-id"})});
    const run = () => type === "FACTURA" ? emitirFE("doc") : emitirNC("doc");
    expect(await run()).toEqual({ok:true,goekuaDocumentId:"opaque-provider-id",reconciliationRequired:true});
    expect(doc).toMatchObject({goekua_document_id:"opaque-provider-id",cdc:null,status:"EMITIDA"});
    expect((await run()).error).toMatch(/conciliación/);
    expect((await consultarFE("doc")).error).toMatch(/conciliación/);
    expect(state.http).toHaveBeenCalledTimes(1);
  });
  it.each(["FACTURA","NOTA_CREDITO"] as const)("keeps ID and explicit CDC separate for %s", async type => {
    const doc = type === "FACTURA" ? add(document("doc")) : nc();
    await (type === "FACTURA" ? emitirFE("doc") : emitirNC("doc"));
    expect(doc).toMatchObject({goekua_document_id:"provider-id",cdc:CDC});
  });
  it("does not promote a malformed returned CDC to fiscal identity", async () => {
    const doc=add(document("doc"));
    state.http.mockResolvedValue({status:201,json:async()=>({id:"opaque",cdc:"opaque",xml:"<xml/>"})});
    await emitirFE("doc");
    expect(doc).toMatchObject({goekua_document_id:"opaque",cdc:null});
    expect(doc).not.toHaveProperty("xml_url");
  });
  it.each([null,"","provider-id"])("rejects a source with no real CDC (%s) before NC HTTP",async cdc=>{
    nc(); Object.assign(state.tables.sales_documents[0],{cdc});
    expect((await emitirNC("doc")).error).toBe("La factura de origen debe estar emitida fiscalmente antes de emitir la NC.");
    noExternalCall();
  });
  it.each([undefined,0,9,1.5])("rejects absent/invalid human motive %s", async emissionMotive => {
    nc(); expect((await issueNC("doc",{emissionMotive,sourceItemIds:["item"]})).error).toMatch(/motivo/); noExternalCall();
  });
  it("requires exact source item selection",async()=>{
    nc(); expect((await emitirNC("doc",{emissionMotive:2,sourceItemIds:["foreign-item"]})).error).toMatch(/ítem/);noExternalCall();
  });
  it("blocks HTTP if recording the human motive fails",async()=>{
    nc();state.auditFails=true;expect((await emitirNC("doc")).error).toMatch(/registrar el motivo/);noExternalCall();
  });
  it("requires explicit commercial integration policy, without legacy defaults",async()=>{
    add(document("doc"));vi.stubEnv("GOEKUA_PAYMENT_TYPE","");expect((await emitirFE("doc")).error).toMatch(/GOEKUA_PAYMENT_TYPE/);noExternalCall();
  });
  it("includes the mandatory credit expiration date from the actual document",async()=>{
    add(document("doc"));vi.stubEnv("GOEKUA_OPERATION_CONDITION_TYPE","2");await emitirFE("doc");
    expect(body()).toMatchObject({operationConditionType:2,expirationDate:"2026-10-10T00:00:00.000Z"});
  });
  it.each(["number","configuration","client","unit","exchange"])("fails closed for missing mandatory fiscal data: %s",async gap=>{
    const doc=add(document("doc"));
    if(gap==="number") doc.code="V-00001";
    if(gap==="configuration") vi.stubEnv("GOEKUA_USER_LAST_NAME","");
    if(gap==="client") state.tables.clients[0].tax_id=null;
    if(gap==="unit") vi.stubEnv("GOEKUA_MEASURE_UNIT","");
    if(gap==="exchange") {doc.currency="USD";vi.stubEnv("GOEKUA_CURRENCY_RATE","");}
    expect((await emitirFE("doc")).error).toBeTruthy();noExternalCall();
  });
  it("consults only the actual CDC, saves KUDE within the tenant, and ignores inline XML",async()=>{
    const doc=add(document("doc")); Object.assign(doc,{cdc:CDC,goekua_document_id:"opaque"});
    state.http.mockResolvedValue({ok:true,json:async()=>({cdc:CDC,kudeUrl:"https://example.test/kude",xml:"<xml/>"})});
    expect((await consultarFE("doc")).ok).toBe(true);
    expect(state.http.mock.calls[0][0]).toBe(`https://goekua.example.test/api/electronic-document/${CDC}`);
    expect(doc).toMatchObject({cdc:CDC,kude_url:"https://example.test/kude"});
    expect(doc).not.toHaveProperty("xml_url");
  });
  it("rejects foreign tenant consultation before HTTP",async()=>{
    const doc=add(document("doc")); Object.assign(doc,{empresa_id:"foreign",cdc:CDC});
    expect((await consultarFE("doc")).error).toMatch(/no encontrado/);noExternalCall();
  });
  it("adapter refuses a provider ID in the CDC endpoint",async()=>{
    const adapter=await vi.importActual<typeof import("../goekua")>("../goekua");
    expect(await adapter.goekuaConsultarDocumento("opaque")).toHaveProperty("error");noExternalCall();
  });
  it("renders pending ID with no issuance, CDC consultation, or FE-issued claim",()=>{
    const html=renderToStaticMarkup(createElement(SifenButton,{docId:"doc",docType:"FACTURA",status:"EMITIDA",cdc:null,providerId:"opaque",kudeUrl:null,xmlUrl:null}));
    expect(html).toContain("conciliación");expect(html).toContain("opaque");
    expect(html).not.toContain("Emitir FE");expect(html).not.toContain("FE emitida");expect(html).not.toContain("<button");
  });
  it("renders eight motives with a blank human selection",()=>{
    const html=renderToStaticMarkup(createElement(SifenButton,{docId:"doc",docType:"NOTA_CREDITO",status:"EMITIDA",cdc:null,kudeUrl:null,xmlUrl:null,creditNoteItems:[item],sourceInvoiceItems:[item]}));
    expect(html).toContain("Seleccionar motivo");expect(html).toContain("disabled");
    expect(html).not.toContain("<select");
    expect(html).toMatch(/<input[^>]+value=""/);
    expect(html.match(/role="combobox"/g)).toHaveLength(2);
    const source = readFileSync("app/(internal)/ventas/[id]/sifen-button.tsx", "utf8");
    expect(source).toContain("Object.entries(GOEKUA_NC_MOTIVES)");
    expect(Object.keys(GOEKUA_NC_MOTIVES)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });
});
