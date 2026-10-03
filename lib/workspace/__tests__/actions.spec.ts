import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({profile:vi.fn(),client:vi.fn(),admin:vi.fn(),refresh:vi.fn()}));
vi.mock("@/lib/auth",()=>({requirePlan:m.profile}));
vi.mock("@/lib/supabase/server",()=>({createClient:m.client}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.admin}));
vi.mock("next/cache",()=>({revalidatePath:m.refresh}));
import { adoptWorkspacePriceAction, recordPrebidOutcomeAction, savePrebidVersionAction, saveWorkspaceBudgetItemAction } from "../actions";
const id="10000000-0000-4000-8000-000000000001";
const product="20000000-0000-4000-8000-000000000002";
const quote="30000000-0000-4000-8000-000000000003";
const context={kind:"TENDER" as const,id};
let db:any;let admin:any;
beforeEach(()=>{
  vi.clearAllMocks();
  admin={rpc:vi.fn().mockResolvedValue({data:{id,version:1},error:null})};m.admin.mockReturnValue(admin);
  db={rpc:vi.fn().mockResolvedValue({data:73,error:null}),from:vi.fn((table:string)=>{
    const response=table==="licitaciones"?{id,moneda:"PYG"}:{estado:"BORRADOR"};
    const q:any={};for(const method of ["select","eq","insert","update","upsert"])q[method]=vi.fn(()=>q);
    q.maybeSingle=vi.fn().mockResolvedValue({data:response,error:null});q.single=vi.fn().mockResolvedValue({data:{id},error:null});
    q.then=(resolve:any)=>Promise.resolve({data:{id},error:null}).then(resolve);return q;
  })};
  m.profile.mockResolvedValue({id,empresa_id:id,active:true,empresa_active:true,role:"admin"});m.client.mockResolvedValue(db);
});
describe("PREBID server action boundaries",()=>{
  it("quote price is factual DB value and client price is not transmitted",async()=>{
    const r=await adoptWorkspacePriceAction(context,{productoId:product,fuente:"COTIZACION",precio:999,quoteVersionItemId:quote});
    expect(r.data).toBe(73);expect(db.rpc).toHaveBeenCalledWith("workspace_adopt_price",{p_context:context,p_product_id:product,p_source:"COTIZACION",p_price:null,p_quote_item_id:quote});
  });
  it("manual price forces quote provenance null",async()=>{
    await adoptWorkspacePriceAction(context,{productoId:product,fuente:"MANUAL",precio:40,quoteVersionItemId:quote});
    expect(db.rpc).toHaveBeenCalledWith("workspace_adopt_price",expect.objectContaining({p_price:40,p_quote_item_id:null}));
  });
  it.each([NaN,Infinity,0,-1])("rejects manual %s before RPC",async precio=>{
    expect((await adoptWorkspacePriceAction(context,{productoId:product,fuente:"MANUAL",precio})).error).toBeTruthy();expect(db.rpc).not.toHaveBeenCalled();
  });
  it("quote id mandatory without fallback",async()=>{
    expect((await adoptWorkspacePriceAction(context,{productoId:product,fuente:"COTIZACION",precio:40})).error).toBeTruthy();expect(db.rpc).not.toHaveBeenCalled();
  });
  it("DB rejection propagates and does not adopt manually",async()=>{
    db.rpc.mockResolvedValue({data:null,error:{message:"Invalid current quote provenance"}});
    expect((await adoptWorkspacePriceAction(context,{productoId:product,fuente:"COTIZACION",quoteVersionItemId:quote})).error).toMatch(/provenance/);expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("inactive account cannot open a write path",async()=>{
    m.profile.mockResolvedValue({active:false});expect((await adoptWorkspacePriceAction(context,{productoId:product,fuente:"MANUAL",precio:10})).error).toMatch(/inactiva/);expect(m.client).not.toHaveBeenCalled();
  });
  it("foreign tenant owner fails before factual pricing",async()=>{
    db.from=vi.fn(()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})}));
    expect((await adoptWorkspacePriceAction(context,{productoId:product,fuente:"MANUAL",precio:10})).error).toMatch(/otra empresa/);expect(db.rpc).not.toHaveBeenCalled();
  });
  it("GANADA requires human confirmed positive award",async()=>{
    expect((await recordPrebidOutcomeAction(id,"GANADA",0)).error).toBeTruthy();expect(db.rpc).not.toHaveBeenCalled();
  });
  it("GANADA records outcome without project creation",async()=>{
    await recordPrebidOutcomeAction(id,"GANADA",1000);expect(db.rpc).toHaveBeenCalledWith("prebid_record_outcome",{p_tender_id:id,p_estado:"GANADA",p_awarded_amount:1000});expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.from.mock.calls.every(([table]:[string])=>table!=="projects")).toBe(true);
  });
  it("PERDIDA discards award input",async()=>{
    await recordPrebidOutcomeAction(id,"PERDIDA",1000);expect(db.rpc).toHaveBeenCalledWith("prebid_record_outcome",expect.objectContaining({p_awarded_amount:null}));
  });
  it("presentation CAS rejects stale workspace before save",async()=>{
    db.rpc.mockResolvedValue({data:{hash:"new",facts:{}},error:null});expect((await savePrebidVersionAction(id,true,"old")).error).toMatch(/cambió/);expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("invalid measured quantity cannot create a budget row",async()=>{
    expect((await saveWorkspaceBudgetItemAction(context,{code:"1",description:"wall",unit:"m2",quantity:0})).error).toBeTruthy();expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe('server-only canonical finalizer',()=>{
 const facts={context,tender:{id},settings:null,items:[{id:'b',quantity:10,unit:'m2'}],materials:[{budget_item_id:'b',producto_id:product,cantidad_por_unidad_ejecutada:2,desperdicio_pct:0}],labor:[],equipment:[],subcontracts:[],products:[{id:product,costo_promedio:73}],prices:[],observations:[],rfqs:[],rfq_items:[],invitations:[],quotes:[],quote_versions:[],quote_items:[],reviews:[],bim_models:[],bim_elements:[],bim_matches:[],competition:[],asOf:'2026-10-03'};
 it('ignores extra browser offer amount and actor, computing 1460 from server facts',async()=>{
  db.rpc.mockResolvedValue({data:{facts,hash:'current'},error:null});
  const invoke=savePrebidVersionAction as (...args:any[])=>ReturnType<typeof savePrebidVersionAction>;
  expect((await invoke(id,true,'current',999999,'fake-actor')).error).toBeNull();
  expect(admin.rpc).toHaveBeenCalledWith('prebid_commit_version',{p_tender_id:id,p_actor_id:id,p_empresa_id:id,p_present:true,p_expected_hash:'current',p_offer_amount:1460});
  expect(db.rpc).toHaveBeenCalledTimes(1);expect(db.rpc).toHaveBeenCalledWith('prebid_workspace',{p_tender_id:id});
 });
 it('rechecks DB concurrency rejection without saving fallback',async()=>{db.rpc.mockResolvedValue({data:{facts,hash:'current'},error:null});admin.rpc.mockResolvedValue({data:null,error:{message:'Workspace changed'}});expect((await savePrebidVersionAction(id,true,'current')).error).toMatch(/changed/);expect(admin.rpc).toHaveBeenCalledTimes(1);});
 it('incomplete server facts cannot finalize',async()=>{db.rpc.mockResolvedValue({data:{facts:{...facts,materials:[]},hash:'current'},error:null});expect((await savePrebidVersionAction(id,true,'current')).error).toBeTruthy();expect(admin.rpc).not.toHaveBeenCalled();});
 it('same-tenant unauthorized role cannot reach finalizer',async()=>{m.profile.mockResolvedValue({id,empresa_id:id,active:true,empresa_active:true,role:'deposito'});expect((await savePrebidVersionAction(id,true,'current')).error).toMatch(/no autorizado/);expect(admin.rpc).not.toHaveBeenCalled();expect(db.rpc).not.toHaveBeenCalled();});
});
