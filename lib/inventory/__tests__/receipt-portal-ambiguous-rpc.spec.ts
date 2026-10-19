import { beforeEach, expect,it,vi } from "vitest";
import { classifyPortalRpcError } from "../portal-rpc-error";
const state=vi.hoisted(()=>({error:{message:"lost response",code:""} as any,remove:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/inventory/receipt-portal-data",()=>({getReceiptPortalContext:async()=>({
 link:{id:"link",empresaId:"tenant",orderId:"order"},order:{projectId:"project",items:[{id:"11111111-1111-4111-8111-111111111111",pending:2}]},
 admin:{rpc:async()=>({data:null,error:state.error}),storage:{from:()=>({upload:async()=>({error:null}),remove:state.remove})}},
})}));
import { POST } from "@/app/api/recepcion-portal/[token]/route";
beforeEach(()=>{state.error={message:"lost response"};state.remove.mockReset();});
async function send(){
 const body=new FormData();body.set("fecha","2026-10-19");body.set("recibido_por","QA");
 body.set("items",JSON.stringify([{order_item_id:"11111111-1111-4111-8111-111111111111",quantity:1}]));
 body.set("files",new File(["%PDF-1.4"],"qa.pdf",{type:"application/pdf"}));
 return POST(new Request("http://localhost/api/recepcion-portal/token",{method:"POST",body}),{params:Promise.resolve({token:"token"})});
}
it("an uncertain legacy receipt response preserves potentially committed evidence",async()=>{
 const response=await send();expect(response.status).toBe(503);expect(state.remove).not.toHaveBeenCalled();
 expect((await response.json()).error).toMatch(/comprobar|consult/i);
});
it("a definite legacy receipt rejection can remove its unused new upload",async()=>{
 state.error={code:"P0001",message:"materiales sin vincular"};expect((await send()).status).toBe(409);expect(state.remove).toHaveBeenCalledOnce();
});
it("statement_completion_unknown is not a definitive rejection",()=>{
 expect(classifyPortalRpcError({code:"40003",message:"unknown"},"fallback").status).toBe(503);
});
it.each(["P0001","P0409","23505","23514","22023","42501","55000"])("business SQLSTATE %s remains a definitive rejection",code=>{
 expect(classifyPortalRpcError({code,message:"business"},"fallback").status).toBe(400);
});
