import { describe, it, expect } from "vitest";
import { composeOffer, computeWorkspaceCosts, DEFAULT_COST_SETTINGS, costSettingsSchema, type WorkspaceFacts } from "../costs";
import { workspaceContextSchema, ownerValues, ownerColumn } from "../context";

const id = "11111111-1111-4111-8111-111111111111";
function facts(): WorkspaceFacts {
  return { context: { kind:"TENDER",id }, tender:{id}, settings:DEFAULT_COST_SETTINGS,
    items:[{id:"a",quantity:10,unit:"m2"}], materials:[{budget_item_id:"a",producto_id:"p",cantidad_por_unidad_ejecutada:2,desperdicio_pct:10}],
    labor:[{budget_item_id:"a",horas_por_unidad_ejecutada:1,costo_hora:5}],equipment:[],subcontracts:[],
    products:[{id:"p",costo_promedio:3}],prices:[],observations:[],rfqs:[],rfq_items:[],invitations:[],quotes:[],quote_versions:[],quote_items:[],reviews:[],
    bim_models:[],bim_elements:[],bim_matches:[],competition:[],asOf:"2026-10-03" };
}
describe("common PREBID context and existing engines",()=>{
  it("tender has no project id",()=>expect(ownerValues({kind:"TENDER",id})).toEqual({tender_id:id,project_id:null}));
  it("execution remains project scoped",()=>expect(ownerColumn({kind:"PROJECT",id})).toBe("project_id"));
  it("rejects invalid context identities",()=>expect(()=>workspaceContextSchema.parse({kind:"TENDER",id:"fake"})).toThrow());
  it("uses the existing APU engine for four cost legs",()=>{
    const f=facts();f.equipment=[{budget_item_id:"a",horas_por_unidad_ejecutada:2,costo_hora:4}];f.subcontracts=[{budget_item_id:"a",precio_por_unidad:7}];
    expect(computeWorkspaceCosts(f).totals.costoTotal).toBeCloseTo(266);
  });
  it("missing price prevents a submitted offer",()=>{const f=facts(); f.products[0].costo_promedio=null;expect(computeWorkspaceCosts(f).complete).toBe(false);});
  it("missing APU prevents an offer",()=>{const f=facts();f.items.push({id:"b",quantity:1,unit:"u"});expect(computeWorkspaceCosts(f).offer).toBeNull();});
  it("unmeasured leaf prevents an offer",()=>{const f=facts();f.items[0].quantity=null;expect(computeWorkspaceCosts(f).complete).toBe(false);});
  it("parent subtotal is not counted twice",()=>{const f=facts();f.items[0].parent_id="parent";f.items.push({id:"parent",quantity:10,unit:"m2"});expect(computeWorkspaceCosts(f).totals.costoTotal).toBeCloseTo(116);});
  it("human adoption wins over CPP",()=>{const f=facts();f.prices=[{producto_id:"p",precio_unitario:10,fuente:"COTIZACION",quote_version_item_id:"q"}];expect(computeWorkspaceCosts(f).prices.p.precio).toBe(10);});
  it("market quote alone does not become cost",()=>{const f=facts();f.products[0].costo_promedio=null;f.quote_items=[{precio_unitario:50}];expect(computeWorkspaceCosts(f).complete).toBe(false);});
  it("burdens and revenue margin use explicit bases",()=>{
    expect(composeOffer(100,{indirectPct:10,generalPct:5,financingPct:3,riskPct:2,marginPct:20})).toEqual({directCost:100,indirect:10,general:5,financing:3,risk:2,totalCost:120,margin:30,offerAmount:150});
  });
  it.each([NaN,Infinity,-1,100])("rejects invalid margin %s",n=>expect(()=>costSettingsSchema.parse({...DEFAULT_COST_SETTINGS,marginPct:n})).toThrow());
  it.each([NaN,Infinity,-1,0])("rejects invalid direct cost %s",n=>expect(()=>composeOffer(n,DEFAULT_COST_SETTINGS)).toThrow());
  it("archived facts remain reproducible after live changes",()=>{
    const live=facts();const snapshot=structuredClone(live);const amount=computeWorkspaceCosts(snapshot).offer?.offerAmount;
    live.products[0].costo_promedio=999;expect(computeWorkspaceCosts(snapshot).offer?.offerAmount).toBe(amount);
  });
});
