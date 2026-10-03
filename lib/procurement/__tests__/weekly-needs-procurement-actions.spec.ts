import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({profile:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireProfile:mock.profile}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({})}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import { previewDirectPurchaseAction, confirmDirectPurchaseAction } from "@/app/(internal)/orders/direct-purchase-actions";
import { createRfq } from "@/app/(internal)/rfqs/actions";

const id="11111111-1111-4111-8111-111111111111";
const origin={planId:id,snapshotId:id,needIds:[id],seen:{coverage:"human reference"}};
function direct(withOrigin=true){const fd=new FormData();fd.set("provider_id",id);fd.set("project_id",id);
  fd.set("currency","PYG");fd.set("freight","0");fd.set("payment_terms","cash");
  fd.set("items",JSON.stringify([{product:"Cement",producto_id:id,quantity:10,unit:"kg",unit_price:5,tax_rate:0}]));
  if(withOrigin)fd.set("need_origin",JSON.stringify(origin));return fd;
}
function rfq(withOrigin=true){const fd=new FormData();fd.set("product","Cement");fd.set("quantity","1");fd.set("unit","lote");
  fd.set("purpose","PROCUREMENT");fd.set("items",JSON.stringify([{producto_id:id,descripcion:"Cement",cantidad:10,unidad:"kg"}]));
  if(withOrigin)fd.set("need_origin",JSON.stringify(origin));return fd;
}
beforeEach(()=>{vi.resetAllMocks();mock.profile.mockResolvedValue({id,empresa_id:id,active:true});mock.rpc.mockResolvedValue({data:{id,hash:"hash"},error:null});});
describe("human procurement server boundaries",()=>{
  it("weekly direct path uses the guarded gateway and human header",async()=>{
    expect((await previewDirectPurchaseAction(direct())).error).toBeNull();
    expect(mock.rpc).toHaveBeenCalledWith("weekly_plan_need_direct_preview",expect.objectContaining({p_plan_id:id,p_snapshot_id:id,p_need_ids:[id],p_seen:origin.seen,p_header:expect.objectContaining({provider_id:id,payment_terms:"cash",freight:0})}));
  });
  it("ordinary direct purchase preserves the canonical gateway",async()=>{
    expect((await previewDirectPurchaseAction(direct(false))).error).toBeNull();expect(mock.rpc.mock.calls[0][0]).toBe("direct_purchase_preview");
  });
  it("stale direct need rejects without trying a generic fallback",async()=>{
    mock.rpc.mockResolvedValue({data:null,error:{message:"Stock changed; recalculate"}});
    expect((await previewDirectPurchaseAction(direct())).error).toContain("Stock changed");expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("duplicate need ids reject before direct RPC",async()=>{
    const fd=direct();fd.set("need_origin",JSON.stringify({...origin,needIds:[id,id]}));expect((await previewDirectPurchaseAction(fd)).error).toBeTruthy();expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("human direct confirmation remains the canonical confirm RPC",async()=>{
    mock.rpc.mockResolvedValue({data:id,error:null});expect((await confirmDirectPurchaseAction(id,"hash",true)).id).toBe(id);
    expect(mock.rpc).toHaveBeenCalledWith("direct_purchase_confirm",{p_preview_id:id,p_hash:"hash",p_confirm:true});
  });
  it("weekly RFQ path cannot trust browser product quantities or purpose",async()=>{
    const fd=rfq();fd.set("purpose","COST_DISCOVERY");fd.set("items","[]");
    expect((await createRfq(fd)).error).toBeNull();
    expect(mock.rpc).toHaveBeenCalledWith("weekly_plan_need_rfq",expect.objectContaining({p_plan_id:id,p_snapshot_id:id,p_need_ids:[id],p_header:{specifications:null,internal_reference:null,observations:null}}));
    expect(mock.rpc.mock.calls[0][1]).not.toHaveProperty("p_items");
  });
  it("ordinary RFQ continues to use the B03 engine",async()=>{
    expect((await createRfq(rfq(false))).error).toBeNull();expect(mock.rpc.mock.calls[0][0]).toBe("rfq_create");
    expect(mock.rpc.mock.calls[0][1].p_provider_ids).toEqual([]);
  });
  it("stale RFQ rejects without generic fallback",async()=>{
    mock.rpc.mockResolvedValue({data:null,error:{message:"Targets changed; recalculate"}});
    expect((await createRfq(rfq())).error).toContain("Targets changed");expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
});
