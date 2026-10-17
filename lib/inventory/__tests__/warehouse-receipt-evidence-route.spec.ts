/** Real handler with controlled persistence faults. Complements real browser
 * coverage; it does not certify the ledger RPC, authentication or stock.
 */
import { beforeEach, expect, it, vi } from "vitest";
const tenant="11111111-1111-4111-8111-111111111111", receipt="22222222-2222-4222-8222-222222222222";
const state=vi.hoisted(()=>({storageError:false,metadataError:false,calls:[] as {kind:string;value?:unknown}[]}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({
 from(table:string){
  const query={select:()=>query,eq:()=>query,limit:()=>query,maybeSingle:async()=>({error:null,data:table==="warehouse_portal_links"?{id:"link",empresa_id:tenant,location_id:"location",active:true,expires_at:null,created_by:"sponsor"}:table==="inventory_locations"?{id:"location",name:"QA",project_id:"project",location_type:"PROJECT",active:true}:table==="authorized_orders"?{id:"order",project_id:"project",status:"AUTORIZADO"}:null}),
  insert:async(value:unknown)=>{state.calls.push({kind:"insert",value});return{error:state.metadataError?{message:"injected metadata failure"}:null}}};return query;
 },
 rpc:async(name:string,value:unknown)=>{state.calls.push({kind:name,value});return{data:{receipt_id:receipt,movements:["movement"]},error:null}},
 storage:{from:()=>({upload:async(path:string)=>{state.calls.push({kind:"upload",value:path});return{error:state.storageError?{message:"injected storage failure"}:null}},remove:async(paths:string[])=>{state.calls.push({kind:"remove",value:paths});return{error:null}}})},
})}));
import { POST } from "@/app/api/warehouse-portal/[token]/route";
beforeEach(()=>{state.storageError=false;state.metadataError=false;state.calls=[]});
async function request(size=8){const body=new FormData();body.set("action","receipt");body.set("order_id","order");body.set("fecha","2026-10-17");body.set("recibido_por","Depositero QA");body.set("idempotency_key","33333333-3333-4333-8333-333333333333");body.set("items",JSON.stringify([{order_item_id:"item",quantity:1}]));body.set("files",new File([new Uint8Array(size)],"remito.pdf",{type:"application/pdf"}));return POST(new Request("http://localhost/api/warehouse-portal/test",{method:"POST",body}),{params:Promise.resolve({token:"A".repeat(43)})})}
it("reports confirmed stock separately when saving the original fails",async()=>{state.storageError=true;const response=await request();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,status:"CONFIRMED",receiptId:receipt,uploadIncomplete:true,pendingEvidence:["remito.pdf"]});expect(state.calls.filter(c=>c.kind==="insert")).toHaveLength(0)});
it("cleans only its new object if evidence metadata fails and reports retryable failure",async()=>{state.metadataError=true;const response=await request();expect(await response.json()).toMatchObject({uploadIncomplete:true,pendingEvidence:["remito.pdf"]});const uploaded=state.calls.find(c=>c.kind==="upload")!.value;expect(state.calls.find(c=>c.kind==="remove")!.value).toEqual([uploaded]);expect(String(uploaded)).toContain("receipts/"+receipt+"/")});
it("rejects an oversized attachment before registering stock",async()=>{const response=await request(20*1024*1024+1);expect(response.status).toBe(400);expect(state.calls).toEqual([])});
