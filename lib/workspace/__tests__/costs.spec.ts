import { describe, it, expect } from "vitest";
import { composeOffer, computeWorkspaceCosts, DEFAULT_COST_SETTINGS, costSettingsSchema, normalizeCostSettings, type WorkspaceFacts, type CostSettingsV2 } from "../costs";
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
    expect(composeOffer(100,{indirectPct:10,generalPct:5,financingPct:3,riskPct:2,marginPct:20})).toMatchObject({directCost:100,indirect:10,general:5,financing:3,risk:2,totalCost:120,margin:30,offerAmount:150});
  });
  it.each([NaN,Infinity,-1,100])("rejects invalid margin %s",n=>expect(()=>costSettingsSchema.parse({...DEFAULT_COST_SETTINGS,marginPct:n})).toThrow());
  it.each([NaN,Infinity,-1,0])("rejects invalid direct cost %s",n=>expect(()=>composeOffer(n,DEFAULT_COST_SETTINGS)).toThrow());
  it("archived facts remain reproducible after live changes",()=>{
    const live=facts();const snapshot=structuredClone(live);const amount=computeWorkspaceCosts(snapshot).offer?.offerAmount;
    live.products[0].costo_promedio=999;expect(computeWorkspaceCosts(snapshot).offer?.offerAmount).toBe(amount);
  });
});

function v2(): CostSettingsV2 { return {schemaVersion:2,indirect:{mode:'PERCENT',value:0},financing:{mode:'PERCENT',value:0},risk:{mode:'PERCENT',value:0},generalItems:[],marginPct:0}; }
describe('V2 economics and immutable V1 compatibility',()=>{
 it('fixed indirect',()=>{const s=v2();s.indirect={mode:'FIXED',value:37};expect(composeOffer(100,s).indirect).toBe(37);});
 it('percent indirect preserves direct base',()=>{const s=v2();s.indirect.value=10;expect(composeOffer(200,s).indirect).toBe(20);});
 it('fixed general line retains concept and result',()=>{const s=v2();s.generalItems=[{id:'office',concept:'Oficina',mode:'FIXED',value:25}];expect(composeOffer(100,s).generalItems).toEqual([{...s.generalItems[0],base:null,result:25}]);});
 it('percent general line explicitly records direct base',()=>{const s=v2();s.generalItems=[{id:'insurance',concept:'Seguros',mode:'PERCENT',value:5}];expect(composeOffer(200,s).generalItems[0]).toMatchObject({base:200,result:10});});
 it('multiple concepts sum without compounded percentages',()=>{const s=v2();s.generalItems=[{id:'a',concept:'Oficina',mode:'FIXED',value:25},{id:'b',concept:'Seguros',mode:'PERCENT',value:10},{id:'c',concept:'Movilidad',mode:'FIXED',value:7}];expect(composeOffer(200,s).general).toBe(52);});
 it.each(['financing','risk'] as const)('fixed %s',key=>{const s=v2();s[key]={mode:'FIXED',value:33};expect(composeOffer(200,s)[key]).toBe(33);});
 it.each(['financing','risk'] as const)('percent %s uses direct base',key=>{const s=v2();s[key]={mode:'PERCENT',value:3};expect(composeOffer(200,s)[key]).toBe(6);});
 it('margin is on revenue, not a markup',()=>{const s=v2();s.marginPct=20;s.indirect={mode:'FIXED',value:20};const o=composeOffer(100,s);expect(o.offerAmount).toBe(150);expect(o.margin/o.offerAmount).toBe(0.2);expect(o.directCost+o.indirect+o.general+o.financing+o.risk+o.margin).toBe(o.offerAmount);});
 it('V1 and normalized V2 reproduce the same economics without modifying historical settings',()=>{const legacy={indirectPct:10,generalPct:5,financingPct:3,riskPct:2,marginPct:20};const original=structuredClone(legacy);expect(composeOffer(123.45,legacy)).toEqual(composeOffer(123.45,normalizeCostSettings(legacy)));expect(legacy).toEqual(original);});
 it('immutable historical facts keep V1 schema and hash input',()=>{const f=facts();const original=JSON.stringify(f);computeWorkspaceCosts(f);expect(JSON.stringify(f)).toBe(original);expect(f.settings).not.toHaveProperty('schemaVersion');});
 it('canonical 1460 fixture remains exact',()=>{const f=facts();f.materials[0].desperdicio_pct=0;f.labor=[];f.products[0].costo_promedio=73;expect(computeWorkspaceCosts(f).offer?.offerAmount).toBe(1460);});
 it.each([NaN,Infinity,-1])('rejects invalid fixed value %s',value=>{const s=v2();s.risk={mode:'FIXED',value};expect(()=>composeOffer(100,s)).toThrow();});
 it('rejects percent >100, missing concept and duplicate ids',()=>{const s=v2();s.generalItems=[{id:'a',concept:'',mode:'PERCENT',value:101}];expect(()=>composeOffer(100,s)).toThrow();s.generalItems=[{id:'a',concept:'one',mode:'FIXED',value:1},{id:'a',concept:'two',mode:'FIXED',value:1}];expect(()=>composeOffer(100,s)).toThrow();});
});
