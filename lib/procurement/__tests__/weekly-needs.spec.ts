import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocateMaterialCoverage, compareCentralLines } from "../mrp-coverage";
import { physicalNumber, samePhysicalUnit, assertWeeklyPeriod } from "../weekly-plan-validation";
import { needOriginArgs } from "../need-origin";
import type { BudgetItem } from "@/lib/types";

const mocks = vi.hoisted(()=>({
  profile: vi.fn(), source: vi.fn(), refresh: vi.fn(), base: vi.fn(), central:vi.fn(),
}));
vi.mock("@/lib/auth",()=>({requirePlan:mocks.profile}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.source})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.refresh})}));
vi.mock("../weekly-plan-shared",()=>({loadWeeklyPlanBaseData:mocks.base,loadCentralAvailability:mocks.central}));
import { refreshWeeklyPlanNeedsAction } from "@/app/(internal)/projects/weekly-plan-need-actions";

const plan="11111111-1111-4111-8111-111111111111",product="22222222-2222-4222-8222-222222222222";
const budget={id:"b",project_id:"project",code:"1",parent_id:null,description:"Concrete",unit:"m3",quantity:100,unit_price:50,sort_order:0,material_requirement:"REQUIRES_BOM"} as BudgetItem;
const targets=[{budget_item_id:"b",input_mode:"QUANTITY" as const,input_value:10,front_label:"A"}];
const seen={plan:{startDate:"2026-10-05",endDate:"2026-10-11",items:targets},coverage:[{comprar:999999}]};
let source:any,base:any;
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.profile.mockResolvedValue({id:"actor",empresa_id:"empresa",active:true});
  source={hash:"hash-db",facts:{plan:{empresa_id:"empresa",project_id:"project",status:"DRAFT",start_date:"2026-10-05",end_date:"2026-10-11"},targets}};
  mocks.source.mockImplementation(async()=>({data:source,error:null}));
  base={project:{id:"project"},budgetItems:[budget],executedQuantities:{},recentEntries:[],materialsByItem:{b:[{producto_id:product,producto_nombre:"Cement",unidad_medida:"kg",cantidad_por_unidad_ejecutada:2,desperdicio_pct:0,costo_unitario:10}]},laborByItem:{},equipmentByItem:{},subcontractsByItem:{},stockAndInbound:{[product]:{stock_disponible:3,oc_inbound:999}},inboundDetails:[{producto_id:product,net_quantity:2,expected_delivery_date:"2026-10-10"}]};
  mocks.base.mockImplementation(async()=>({data:base,error:null}));
  mocks.central.mockResolvedValue({data:{location:{id:"central",name:"Central"},availableByProduct:{[product]:4}},error:null});
  mocks.refresh.mockResolvedValue({data:{snapshot_id:"snapshot-db",hash:"hash-db",needs:[]},error:null});
});

describe("saved-plan needs server action",()=>{
  it("reuses the weekly engine and ordered coverage, ignores browser shortage",async()=>{
    const r=await refreshWeeklyPlanNeedsAction(plan,seen);expect(r.error).toBeNull();
    const [name,args]=mocks.refresh.mock.calls[0];expect(name).toBe("weekly_plan_refresh_needs");
    expect(args.p_lines[0]).toMatchObject({requerido:20,cubierto_obra:3,cubierto_central:4,cubierto_inbound:2,comprar:11});
    expect(args).toMatchObject({p_actor_id:"actor",p_plan_id:plan,p_hash:"hash-db",p_needed_by:"2026-10-11",p_seen:seen});
    expect(mocks.source).toHaveBeenCalledWith("weekly_plan_need_sources",{p_plan_id:plan});
    expect(mocks.central.mock.calls[0][2].planId).toBe(plan);
  });
  it("rejects unsaved targets before writing needs",async()=>{
    const r=await refreshWeeklyPlanNeedsAction(plan,{...seen,plan:{...seen.plan,items:[{...targets[0],input_value:11}]}});
    expect(r.error).toContain("Guardá");expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects unsaved dates",async()=>{
    const r=await refreshWeeklyPlanNeedsAction(plan,{...seen,plan:{...seen.plan,endDate:"2026-10-12"}});
    expect(r.error).toContain("Guardá");expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects cross tenant sources even with privileged writer",async()=>{
    source.facts.plan.empresa_id="other";expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toBeTruthy();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects closed plans",async()=>{
    source.facts.plan.status="CLOSED";expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toBeTruthy();expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects inactive actors",async()=>{
    mocks.profile.mockResolvedValue({active:false});expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toContain("inactiva");expect(mocks.source).not.toHaveBeenCalled();
  });
  it("propagates source changes rejected inside the DB transaction",async()=>{
    mocks.refresh.mockResolvedValue({data:null,error:{message:"Planning sources changed; recalculate"}});
    expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toContain("changed");
  });
  it("rejects missing BOM without false zero demand",async()=>{
    base.materialsByItem={};expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toContain("BOM");expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("propagates unreadable stock without creating purchase needs",async()=>{
    mocks.central.mockResolvedValue({data:null,error:"Stock query failed"});
    expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toBe("Stock query failed");expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("excludes delayed and undated inbound",async()=>{
    base.inboundDetails=[{producto_id:product,net_quantity:200,expected_delivery_date:null},{producto_id:product,net_quantity:200,expected_delivery_date:"2026-10-12"}];
    const r=await refreshWeeklyPlanNeedsAction(plan,seen);expect(r.data?.coverage.lines[0].comprar).toBe(13);expect(r.data?.coverage.unconfirmedInbound[0].cantidad).toBe(400);
  });
  it("full stock yields zero shortage",async()=>{
    base.stockAndInbound[product].stock_disponible=50;const r=await refreshWeeklyPlanNeedsAction(plan,seen);expect(r.data?.coverage.lines[0].comprar).toBe(0);
  });
  it("physical supply failure does not fallback",async()=>{
    mocks.base.mockResolvedValue({data:null,error:"Receipt query failed"});expect((await refreshWeeklyPlanNeedsAction(plan,seen)).error).toBe("Receipt query failed");expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
describe("physical validation and procurement origin",()=>{
  it.each([NaN,Infinity,-Infinity,-1,null,undefined,"","invalid",true,1e16])("rejects invalid physical value %s",v=>expect(()=>physicalNumber(v,"quantity")).toThrow());
  it.each(["2026-02-30","not-a-date",""])("rejects invalid planning day %s",day=>expect(()=>assertWeeklyPeriod(day,"2026-10-11")).toThrow());
  it("rejects reversed period",()=>expect(()=>assertWeeklyPeriod("2026-10-12","2026-10-11")).toThrow());
  it("compares aliases and exact custom units without inventing conversion",()=>{
    expect(samePhysicalUnit("m³","m3")).toBe(true);expect(samePhysicalUnit("BOLSA","bolsa")).toBe(true);
    expect(samePhysicalUnit("bolsa","kg")).toBe(false);expect(samePhysicalUnit("","")).toBe(false);
  });
  it("same product incompatible material units reject aggregation",()=>expect(()=>allocateMaterialCoverage({gross:[{producto_id:product,producto_nombre:"x",unidad_medida:"kg",costo_unitario:null,requerido:1,cubierto_obra:0},{producto_id:product,producto_nombre:"x",unidad_medida:"bolsa",costo_unitario:null,requerido:1,cubierto_obra:0}],centralAvailableByProduct:{},validInboundByProduct:{}})).toThrow("Unidades"));
  it("duplicate and NaN central references cannot pass equality",()=>{
    expect(compareCentralLines([{producto_id:product,quantity:2}],[{producto_id:product,quantity:NaN}])).toBe(false);
    expect(compareCentralLines([{producto_id:product,quantity:1},{producto_id:"other",quantity:1}],[{producto_id:product,quantity:1},{producto_id:product,quantity:1}])).toBe(false);
  });
  it("origin validates UUIDs and unique need ids",()=>{
    expect(()=>needOriginArgs({planId:plan,snapshotId:product,needIds:[plan,plan],seen:{}})).toThrow();
    expect(needOriginArgs({planId:plan,snapshotId:product,needIds:[plan],seen:{}})).toMatchObject({p_plan_id:plan,p_need_ids:[plan]});
  });
});
