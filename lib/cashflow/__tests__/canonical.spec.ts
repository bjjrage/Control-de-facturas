import { describe, expect, it, vi } from "vitest";
import { calculateWeeklyPlanRequirements } from "@/lib/procurement/weekly-plan-engine";
import { buildMrpPreview } from "@/lib/procurement/weekly-plan-coverage";
import type { SalesDocStatus } from "@/lib/types";
vi.mock("@/lib/procurement/weekly-plan-shared", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/procurement/weekly-plan-shared")>(),
  loadCentralAvailability: vi.fn(async () => ({ data: { availableByProduct: {}, location: null }, error: null })),
}));
import { buildCanonicalCashflow, summarizeCashflow } from "../model";
import { addCashDays, businessToday, dateOnly, financialWindow } from "../dates";
import { loadCanonicalCashflow, readAll } from "../load";
import type { CashflowSources, SourceRow } from "../types";
import { construirProyeccion, ocurrenciasGastoRecurrente } from "@/lib/flujo-caja";
import { calculate30DayNetCashflow } from "@/lib/dashboard/cashflow";
import previewSnapshot from "./preview-snapshot.json";
import { validateRecurringExpense } from "../recurring-validation";

const row=(id:string,extra:Record<string,unknown>={}):SourceRow=>({id,empresa_id:"tenant",...extra});
function empty():CashflowSources {
  return {empresa_id:"tenant",read_at:"2026-10-03T12:00:00Z",from:"2026-10-03",until:"2027-03-31",accounts:[],expenses:[],projects:[row("p")],sales:[],receipts:[],certificates:[],orders:[],invoices:[],invoice_links:[],payments:[],payment_links:[],movements:[],labor_payments:[],subcontracts:[],planning:[]};
}
function planned(count=1):CashflowSources {
  const s=empty();
  s.planning=[{project_id:"p",facts:{budget:[{id:"b",project_id:"p",parent_id:null,code:"1",description:"Wall",unit:"u",quantity:1000,unit_price:10,subtotal:10000,sort_order:0,start_date:"2026-10-03",end_date:"2027-03-31",depends_on:null,quantity_per_unit:null,created_at:s.read_at,material_requirement:"REQUIRES_BOM"}],bom:[row("bom",{project_id:"p",budget_item_id:"b",producto_id:"material",cantidad_por_unidad_ejecutada:1,desperdicio_pct:0})],labor:[row("labor",{project_id:"p",budget_item_id:"b",rol:"worker",horas_por_unidad_ejecutada:1,costo_hora:2})],equipment:[row("equipment",{project_id:"p",budget_item_id:"b",tipo_equipo:"crane",horas_por_unidad_ejecutada:1,costo_hora:3})],subcontracts:[row("sub",{project_id:"p",budget_item_id:"b",descripcion:"painting",precio_por_unidad:4})],execution:[],certificates:[],certificate_items:[],project_stock:[],central:null,central_stock:[],reservations:[],orders:[],products:[row("material",{nombre:"Bricks",unidad:"u",costo_promedio:10})],adopted_prices:[],observations:[]},plans:Array.from({length:count},(_,n)=>({plan:row("plan"+n,{project_id:"p",start_date:addCashDays(s.from,n*7),end_date:addCashDays(s.from,n*7+6),status:"COMMITTED"}),targets:[{budget_item_id:"b",input_mode:"QUANTITY",input_value:10}]}))}];
  return s;
}
const build=(s:CashflowSources)=>buildCanonicalCashflow(s,"tenant");
const expense=(s:CashflowSources,certainty:string)=>build(s).filter(i=>i.certainty===certainty && i.monto<0).reduce((n,i)=>n-i.monto,0);
function order(s:CashflowSources,q=4,received=0,invoiced=0) {
  s.orders=[row("oc",{project_id:"p",total_price:q*10,facturado_amount:invoiced,currency:"PYG",status:"AUTORIZADO",items:[row("item",{order_id:"oc",producto_id:"material",quantity:q,received,unit:"u",expected_delivery_date:"2026-10-09"})]})];
}
function invoice(s:CashflowSources,status="APTO_PARA_PAGO",currency="PYG") {
  s.invoices=[row("inv",{total:40,currency,status,due_date:"2026-10-12"})];
  if(s.orders.length) s.invoice_links=[row("link",{invoice_id:"inv",authorized_order_id:"oc"})];
}

describe("B09 canonical financial read model",()=>{
  it("real rollback Preview snapshot derives all 15 plans through the shared engine",()=>{
    const snapshot=previewSnapshot as unknown as CashflowSources;
    const items=buildCanonicalCashflow(snapshot,snapshot.empresa_id);
    expect(items).toHaveLength(15);
    expect(items.reduce((n,i)=>n-i.monto,0)).toBe(1500);
    expect(items.every(i=>i.certainty==="PLANNED" && i.quantity===10)).toBe(true);
  });
  it("empty verified facts are an intentional zero",()=>expect(build(empty())).toEqual([]));
  it("material demand uses start +7; no catalog-only demand",()=>{const s=planned();const items=build(s);expect(items.find(i=>i.tipo==="salida_proyectada_material")).toMatchObject({monto:-100,quantity:10,fecha:"2026-10-10",certainty:"PLANNED"});s.planning[0].plans=[];expect(build(s)).toEqual([]);});
  it("labor END, equipment END, subcontract END+30",()=>{const items=build(planned());expect(items.find(i=>i.tipo==="salida_plan_mano_de_obra")).toMatchObject({monto:-20,fecha:"2026-10-09"});expect(items.find(i=>i.tipo==="salida_plan_equipo")).toMatchObject({monto:-30,fecha:"2026-10-09"});expect(items.find(i=>i.tipo==="salida_plan_subcontrato")).toMatchObject({monto:-40,fecha:"2026-11-08"});});
  it("partial timely OC supersedes exactly its quantity",()=>{const s=planned();order(s);expect(build(s).find(i=>i.tipo==="salida_proyectada_material" && i.certainty==="PLANNED")).toMatchObject({quantity:6,monto:-60});expect(expense(s,"COMMITTED")).toBe(40);});
  it("full OC removes speculative material obligation",()=>{const s=planned();order(s,10);expect(build(s).filter(i=>i.tipo==="salida_proyectada_material" && i.certainty==="PLANNED")).toEqual([]);});
  it("confirmed receipt only changes stock coverage, no new cash",()=>{const s=planned();order(s,4,4);s.planning[0].facts.project_stock=[row("balance",{project_id:"p",producto_id:"material",quantity:4,unidad:"u"})];expect(expense(s,"COMMITTED")).toBe(40);expect(build(s).find(i=>i.tipo==="salida_proyectada_material" && i.certainty==="PLANNED")?.monto).toBe(-60);});
  it("invoice replaces invoiced OC amount and uses factual due date",()=>{const s=planned();order(s,4,0,40);invoice(s);expect(expense(s,"COMMITTED")).toBe(40);expect(build(s).find(i=>i.source_type==="INVOICE")).toMatchObject({fecha:"2026-10-12",project_id:"p",date_basis:"FACTUAL"});expect(build(s).some(i=>i.source_type==="AUTHORIZED_ORDER")).toBe(false);});
  it("partial invoicing retains OC residual once",()=>{const s=empty();order(s,10,0,40);invoice(s);expect(expense(s,"COMMITTED")).toBe(100);});
  it("stale cached OC invoiced total cannot duplicate its linked invoice",()=>{const s=empty();order(s,10,0,0);invoice(s);expect(expense(s,"COMMITTED")).toBe(100);});
  it("executed payment without treasury is ACTUAL, never projected again",()=>{const s=empty();order(s,4,0,40);invoice(s);s.payments=[row("op",{status:"EJECUTADA",executed_at:"2026-10-05T15:00:00Z"})];s.payment_links=[row("pi",{invoice_id:"inv",payment_order_id:"op"})];expect(expense(s,"COMMITTED")).toBe(0);expect(expense(s,"ACTUAL")).toBe(40);expect(financialWindow(build(s),s.from,s.until)).toEqual([]);});
  it("treasury supersedes paid invoice/OP",()=>{const s=empty();invoice(s,"PAGADO");s.payments=[row("op",{status:"EJECUTADA",executed_at:s.read_at})];s.payment_links=[row("pi",{invoice_id:"inv",payment_order_id:"op"})];s.movements=[row("movement",{payment_order_id:"op",fecha:s.from,monto:-40,currency:"PYG"})];expect(build(s)).toHaveLength(1);expect(build(s)[0].source_type).toBe("TREASURY");});
  it("issued payment order is not an additional payable",()=>{const s=empty();invoice(s);s.payments=[row("op",{status:"EMITIDA"})];s.payment_links=[row("pi",{invoice_id:"inv",payment_order_id:"op"})];expect(expense(s,"COMMITTED")).toBe(40);});
  it("internal treasury transfers excluded",()=>{const s=empty();s.movements=[row("t",{transferencia_id:"transfer",fecha:s.from,monto:-100,currency:"PYG"})];expect(build(s)).toEqual([]);});
  it("receipt without bank account remains an actual cash fact",()=>{const s=empty();s.receipts=[row("r",{amount:40,receipt_date:s.from,currency:"PYG"})];expect(build(s)[0]).toMatchObject({monto:40,certainty:"ACTUAL",fecha:s.from});});
  it("bank movement supersedes its receipt, reversed receipts excluded",()=>{const s=empty();s.receipts=[row("r",{amount:40,receipt_date:s.from,currency:"PYG"}),row("r2",{amount:10,receipt_date:s.from,currency:"PYG",reversed_at:s.read_at})];s.movements=[row("m",{sales_receipt_id:"r",monto:40,fecha:s.from,currency:"PYG"})];expect(build(s)).toHaveLength(1);});
  it("bank receipt retains factual certificate/project attribution",()=>{const s=empty();s.receipts=[row("r",{project_id:"p",amount:40,receipt_date:s.from,currency:"PYG"})];s.movements=[row("m",{sales_receipt_id:"r",monto:40,fecha:s.from,currency:"PYG"})];expect(build(s)[0].project_id).toBe("p");});
  it("central pool cannot fund two projects twice",()=>{
    const s=planned();const second=structuredClone(s.planning[0]);
    second.project_id="p2";second.facts.budget[0].id="b2";second.facts.budget[0].project_id="p2";
    for(const key of ["bom","labor","equipment","subcontracts"] as const) for(const r of second.facts[key]) {r.project_id="p2";r.budget_item_id="b2";}
    second.plans[0].plan={...second.plans[0].plan,id:"second",project_id:"p2"};second.plans[0].targets[0].budget_item_id="b2";
    s.projects.push(row("p2"));s.planning.push(second);
    for(const p of s.planning) p.facts.central_stock=[row("stock",{producto_id:"material",quantity:4,unidad:"u"})];
    expect(build(s).filter(i=>i.tipo==="salida_proyectada_material").reduce((n,i)=>n-i.monto,0)).toBe(160);
  });
  it("labor fact supersedes linked period/budget amount only",()=>{const s=planned();s.labor_payments=[row("lp",{project_id:"p",budget_item_id:"b",amount:8,period_from:s.from,period_to:"2026-10-09"})];expect(build(s).find(i=>i.tipo==="salida_plan_mano_de_obra" && i.certainty==="PLANNED")?.monto).toBe(-12);expect(build(s).find(i=>i.source_type==="LABOR_PAYMENT")?.fecha).toBeNull();});
  it("unrelated labor period cannot suppress forecast",()=>{const s=planned();s.labor_payments=[row("lp",{project_id:"p",budget_item_id:"b",amount:20,period_from:"2026-01-01",period_to:"2026-01-07"})];expect(build(s).find(i=>i.tipo==="salida_plan_mano_de_obra" && i.certainty==="PLANNED")?.monto).toBe(-20);});
  it("subcontract contract/certificate lifecycle counted once",()=>{const s=planned();s.subcontracts=[row("contract",{project_id:"p",budget_item_id:"b",contracted_amount:40,status:"ACTIVO",certificates:[row("sc",{approved_amount:20,retention_amount:1,net_payable:19,status:"APROBADO"})]})];expect(build(s).filter(i=>i.tipo==="salida_plan_subcontrato" && i.certainty==="PLANNED")).toEqual([]);expect(expense(s,"COMMITTED")).toBe(40);s.subcontracts[0].certificates[0].status="PAGADO";expect(expense(s,"COMMITTED")).toBe(21);expect(expense(s,"ACTUAL")).toBe(19);});
  it("all 15 weekly plans and their distinct provenance included",()=>{const s=planned(15);const material=build(s).filter(i=>i.tipo==="salida_proyectada_material");expect(material).toHaveLength(15);expect(new Set(material.map(i=>i.ref_id)).size).toBe(15);expect(material.reduce((n,i)=>n-i.monto,0)).toBe(1500);});
  it("stock and commitment pools consumed once across plans",()=>{const s=planned(2);order(s,4);s.planning[0].facts.project_stock=[row("stock",{project_id:"p",producto_id:"material",quantity:3,unidad:"u"})];expect(build(s).filter(i=>i.tipo==="salida_proyectada_material" && i.certainty==="PLANNED").reduce((n,i)=>n-i.monto,0)).toBe(130);});
  it("central physical stock consumed only once",()=>{const s=planned(2);s.planning[0].facts.central_stock=[row("central",{producto_id:"material",quantity:4,unidad:"u"})];expect(build(s).filter(i=>i.tipo==="salida_proyectada_material").reduce((n,i)=>n-i.monto,0)).toBe(160);});
  it("contractual remaining quantity caps successive plans",()=>{const s=planned(2);s.planning[0].facts.budget[0].quantity=15;expect(build(s).filter(i=>i.tipo==="salida_proyectada_material").reduce((n,i)=>n-i.monto,0)).toBe(150);});
  it("missing price fails instead of invented zero",()=>{const s=planned();s.planning[0].facts.products[0].costo_promedio=null;expect(()=>build(s)).toThrow(/Precio no disponible/);});
  it("missing BOM fails closed",()=>{const s=planned();s.planning[0].facts.bom=[];expect(()=>build(s)).toThrow(/BOM incompleto/);});
  it("physical units cannot be mixed",()=>{const s=planned();order(s);s.orders[0].items[0].unit="kg";expect(()=>build(s)).toThrow(/Unidad/);});
  it("unknown due date remains unknown despite issue date",()=>{const s=empty();invoice(s);s.invoices[0].due_date=null;s.invoices[0].invoice_date=s.from;expect(build(s)[0].fecha).toBeNull();expect(summarizeCashflow(build(s),s.from,s.until).items).toEqual([]);});
  it("historical unpaid obligation included, future outside range excluded",()=>{const s=empty();invoice(s);s.invoices[0].due_date="2026-09-01";expect(financialWindow(build(s),s.from,s.until)).toHaveLength(1);s.invoices[0].due_date="2027-04-01";expect(financialWindow(build(s),s.from,s.until)).toHaveLength(0);});
  it("actual does not decrement an opening account balance again",()=>{const s=empty();invoice(s,"PAGADO");const p=construirProyeccion(100,build(s),"PYG","mes",null,s.from);expect(p.totalSalidas).toBe(0);expect(p.periodos[0].saldoAcumulado).toBe(100);});
  it("company and project scopes share same canonical totals",()=>{const s=planned();invoice(s);const items=build(s);expect(summarizeCashflow(items,s.from,s.until,"p").totals.PYG?.outflow).toBe(190);expect(summarizeCashflow(items,s.from,s.until).totals.PYG?.outflow).toBe(230);expect(summarizeCashflow(items,s.from,s.until,"other").items).toEqual([]);});
  it("Dashboard and Cashflow net parity in same window",()=>{const s=planned();const items=build(s),summary=summarizeCashflow(items,s.from,addCashDays(s.from,30));const dashboard=calculate30DayNetCashflow(summary.items,"PYG");expect(dashboard.neto).toBe(summary.totals.PYG!.inflow-summary.totals.PYG!.outflow);});
  it("foreign currencies never converted or summed with PYG",()=>{const s=planned();invoice(s,"APTO_PARA_PAGO","USD");const summary=summarizeCashflow(build(s),s.from,s.until);expect(summary.totals.USD?.outflow).toBe(40);expect(summary.totals.PYG?.outflow).toBe(190);});
  it("cross currency invoice/OC fails without invented FX",()=>{const s=empty();order(s);invoice(s,"APTO_PARA_PAGO","USD");expect(()=>build(s)).toThrow(/moneda/);});
  it("rejects company mismatch",()=>expect(()=>buildCanonicalCashflow(empty(),"foreign")).toThrow(/empresa/));
  it("rejects injected other tenant financial row",()=>{const s=empty();invoice(s);s.invoices[0].empresa_id="other";expect(()=>build(s)).toThrow(/empresa/);});
  it("rejects other project in plan context",()=>{const s=planned();s.planning[0].plans[0].plan.project_id="foreign";expect(()=>build(s)).toThrow(/Contexto/);});
  it("rejects other tenant inner OC item",()=>{const s=empty();order(s);s.orders[0].items[0].empresa_id="foreign";expect(()=>build(s)).toThrow(/contexto/);});
  it("rejects malformed numeric source",()=>{const s=empty();invoice(s);s.invoices[0].total=NaN;expect(()=>build(s)).toThrow(/financiero/);});
  it("source missing != verified empty",()=>{const s=empty();s.planning=undefined as never;expect(()=>build(s)).toThrow(/ausente/);});
  it("RPC failure != zero",async()=>{await expect(loadCanonicalCashflow({rpc:async()=>({data:null,error:{message:"source unavailable"}})},"tenant","2026-10-03","2026-11-03")).rejects.toThrow(/source unavailable/);});
  it("pagination passes 1000 rows without a business cap",async()=>{const all=Array.from({length:1201},(_,n)=>n);expect(await readAll(async(from,to)=>({data:all.slice(from,to+1),error:null,count:all.length}))).toEqual(all);});
  it("truncated source cannot produce a partial KPI",async()=>{await expect(readAll(async()=>({data:[1],error:null,count:100}))).rejects.toThrow(/truncada/);});
  it("page error cannot produce zero",async()=>{await expect(readAll(async()=>({data:null,error:{message:"failed"}}))).rejects.toThrow(/failed/);});
  it("recurrence clamps month end without rolling into another month",()=>{expect(ocurrenciasGastoRecurrente(10,"MENSUAL",31,"2026-01-31",new Date("2026-04-01T00:00:00Z"),new Date("2026-01-01T00:00:00Z")).map(o=>o.fecha)).toEqual(["2026-01-31","2026-02-28","2026-03-31"]);});
  it("unknown recurring schedule is unknown",()=>{expect(ocurrenciasGastoRecurrente(10,"MENSUAL",null,null,new Date("2027-01-01"))).toEqual([]);});
  it("date arithmetic and timezone independent at year boundary",()=>{expect(addCashDays("2026-12-31",7)).toBe("2027-01-07");expect(businessToday(new Date("2026-10-03T01:00:00Z"))).toBe("2026-10-02");expect(()=>dateOnly("2026-02-30")).toThrow();});
  it.each([NaN,Infinity,0,-1])("invalid recurring amount %s rejected",amount=>expect(validateRecurringExpense({descripcion:"Office",monto_estimado:amount,moneda:"PYG",periodicidad:"MENSUAL",categoria:"OTRO"})).not.toBeNull());
  it("invalid recurring date/day/currency rejected before saving",()=>{
    const g={descripcion:"Office",monto_estimado:10,moneda:"PYG",periodicidad:"MENSUAL",categoria:"OTRO"};
    expect(validateRecurringExpense(g)).toBeNull();
    expect(validateRecurringExpense({...g,proximo_vencimiento:"2026-02-30"})).not.toBeNull();
    expect(validateRecurringExpense({...g,dia_del_mes:32})).not.toBeNull();
    expect(validateRecurringExpense({...g,moneda:"UNKNOWN"})).not.toBeNull();
  });
});

it("timestamp actual uses Asuncion business date",()=>{const s=empty();invoice(s);s.payments=[row("op",{status:"EJECUTADA",executed_at:"2026-10-03T01:00:00Z"})];s.payment_links=[row("pi",{invoice_id:"inv",payment_order_id:"op"})];expect(build(s)[0].fecha).toBe("2026-10-02");});
it("target from unknown budget fails closed",()=>{const s=planned();s.planning[0].plans[0].targets[0].budget_item_id="foreign";expect(()=>build(s)).toThrow(/presupuesto/);});

describe("B09 external audit: canonical B08 physical delivery parity", () => {
  it.each([
    { label: "timely at need date", delivery: "2026-10-09", received: 0, shortage: 6, inbound: 4 },
    { label: "late after need date", delivery: "2026-10-10", received: 0, shortage: 10, inbound: 0 },
    { label: "unknown delivery", delivery: null, received: 0, shortage: 10, inbound: 0 },
    { label: "confirmed full receipt, unknown delivery", delivery: null, received: 4, shortage: 6, inbound: 0 },
    { label: "partial receipt plus timely remainder", delivery: "2026-10-09", received: 2, shortage: 6, inbound: 2 },
    { label: "partial receipt plus late remainder", delivery: "2026-10-10", received: 2, shortage: 8, inbound: 0 },
  ])("$label keeps commitment and matches B08 shortage", async ({ delivery, received, shortage, inbound }) => {
    const s = planned(); order(s, 4, received);
    s.orders[0].items[0].expected_delivery_date = delivery;
    const f = s.planning[0].facts, { plan, targets } = s.planning[0].plans[0];
    if (received) f.project_stock = [row("stock", { producto_id: "material", quantity: received, unidad: "u" })];
    const materials = { b: [{ budget_item_id: "b", producto_id: "material", producto_nombre: "Bricks", unidad_medida: "u", cantidad_por_unidad_ejecutada: 1, desperdicio_pct: 0, costo_unitario: 10 }] };
    const stock = { material: { producto_id: "material", stock_disponible: received, oc_inbound: 0 } };
    const calculation = calculateWeeklyPlanRequirements({ plan_id: plan.id, project_id: "p", start_date: plan.start_date, end_date: plan.end_date, status: plan.status,
      budget_items: f.budget, targets, executed_quantities_by_item: {}, materials_by_item: materials,
      labor_by_item: {}, equipment_by_item: {}, subcontracts_by_item: {}, stock_and_inbound: stock });
    // Exercise the actual B08 preview, not a second eligibility formula.
    const b08 = await buildMrpPreview({ from: () => { throw new Error("Unexpected query"); } }, "tenant", calculation, materials,
      { stockAndInbound: stock, inboundDetails: [{ producto_id: "material", net_quantity: 4 - received, expected_delivery_date: delivery }] }, plan.end_date);
    expect(b08.lines[0]).toMatchObject({ comprar: shortage, cubierto_obra: received, cubierto_inbound: inbound });
    const items = build(s), material = items.find(i => i.source_type === "WEEKLY_PLAN" && i.tipo === "salida_proyectada_material");
    expect(material).toMatchObject({ quantity: b08.lines[0].comprar, monto: -b08.lines[0].caja!, fecha: "2026-10-10" });
    expect(items.filter(i => i.source_type === "AUTHORIZED_ORDER")).toHaveLength(1);
    expect(expense(s, "COMMITTED")).toBe(40);
    const summary = summarizeCashflow(items, s.from, addCashDays(s.from, 30));
    expect(calculate30DayNetCashflow(summary.items, "PYG").neto).toBe(summary.totals.PYG!.inflow - summary.totals.PYG!.outflow);
  });
  it("late supply becomes eligible for a later plan and is consumed only once", () => {
    const s = planned(3); order(s);
    s.orders[0].items[0].expected_delivery_date = "2026-10-16";
    expect(build(s).filter(i => i.source_type === "WEEKLY_PLAN" && i.tipo === "salida_proyectada_material").map(i => i.quantity)).toEqual([10, 6, 10]);
    expect(expense(s, "COMMITTED")).toBe(40);
  });
  it("non-authorized supply does not enter canonical B08 physical coverage", () => {
    const s = planned(); order(s); s.orders[0].status = "FACTURADO";
    expect(build(s).find(i => i.source_type === "WEEKLY_PLAN" && i.tipo === "salida_proyectada_material")?.quantity).toBe(10);
  });
});

describe("B09 external audit: certificate and sales document lifecycle", () => {
  const cases: { certificate: string; doc: SalesDocStatus | null; expectedSource: string | null; remaining: number; collected: number }[] = [
    { certificate: "APROBADO", doc: null, expectedSource: "CERTIFICATE", remaining: 100, collected: 0 },
    { certificate: "APROBADO", doc: "BORRADOR", expectedSource: "CERTIFICATE", remaining: 100, collected: 0 },
    { certificate: "FACTURADO", doc: "BORRADOR", expectedSource: "CERTIFICATE", remaining: 100, collected: 0 },
    { certificate: "FACTURADO", doc: "EMITIDA", expectedSource: "SALES_DOCUMENT", remaining: 100, collected: 0 },
    { certificate: "FACTURADO", doc: "COBRADA_PARCIAL", expectedSource: "SALES_DOCUMENT", remaining: 60, collected: 40 },
    { certificate: "FACTURADO", doc: "COBRADA", expectedSource: null, remaining: 0, collected: 100 },
    { certificate: "FACTURADO", doc: "ANULADA", expectedSource: "CERTIFICATE", remaining: 100, collected: 0 },
  ];
  it.each(cases)("$certificate + $doc retains exactly the canonical receivable", ({ certificate, doc, expectedSource, remaining, collected }) => {
    const s = empty();
    s.certificates = [row("cert", { project_id: "p", status: certificate, monto_liquido: 100, period_end: s.from,
      sales_documents: doc ? [row("sale", { status: doc })] : [] })];
    // RPC returns only issued unpaid documents; nested lifecycle retains all statuses.
    if (doc === "EMITIDA" || doc === "COBRADA_PARCIAL") s.sales = [row("sale", { certificate_id: "cert", status: doc, total: 100, cobrado_amount: collected, currency: "PYG", due_date: "2026-11-02" })];
    if (collected) {
      s.receipts = [row("receipt", { project_id: "p", sales_document_id: "sale", amount: collected, currency: "PYG", receipt_date: s.from })];
      s.movements = [row("bank", { sales_receipt_id: "receipt", monto: collected, currency: "PYG", fecha: s.from })];
    }
    const items = build(s), committed = items.filter(i => i.certainty === "COMMITTED"), actual = items.filter(i => i.certainty === "ACTUAL");
    expect(committed).toHaveLength(expectedSource ? 1 : 0);
    if (expectedSource) expect(committed[0]).toMatchObject({ source_type: expectedSource, monto: remaining, project_id: "p" });
    expect(actual).toHaveLength(collected ? 1 : 0);
    if (collected) expect(actual[0]).toMatchObject({ source_type: "TREASURY", monto: collected });
    expect(items.reduce((n, i) => n + i.monto, 0)).toBe(100);
    const summary = summarizeCashflow(items, s.from, "2026-11-03");
    expect(summary.totals.PYG!.inflow).toBe(remaining);
    expect(summary.totals.PYG!.actual).toBe(collected);
  });
});
