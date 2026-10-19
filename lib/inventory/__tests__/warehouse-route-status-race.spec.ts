import { expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({status:"UPLOADED",patches:[] as unknown[]}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({
 from(table:string){
  let patch:any=null,allowed:string[]|null=null;
  const finish=()=>{
   if(table==="warehouse_submissions"&&patch){
    if(allowed&&!allowed.includes(state.status))return {data:null,error:null};
    state.patches.push(patch);state.status=patch.status??state.status;
   }
   const data=table==="warehouse_portal_links"?{id:"link",empresa_id:"tenant",location_id:"loc",active:true,expires_at:"2099-01-01"}:
    table==="inventory_locations"?{id:"loc",location_type:"PROJECT",active:true,project_id:"project"}:
    table==="warehouse_submissions"?{id:"submission",status:state.status}:null;
   return {data,error:null};
  };
  const q:any={select:()=>q,eq:()=>q,insert:()=>q,update:(value:any)=>{patch=value;return q},
   in:(_column:string,values:string[])=>{allowed=values;return q},single:async()=>finish(),maybeSingle:async()=>finish(),
   then:(resolve:any)=>Promise.resolve(finish()).then(resolve)};
  return q;
 },
 storage:{from:()=>({upload:async()=>({error:{message:"Storage failed"}})})},
 rpc:async()=>{state.status="CONFIRMED";return {data:[{upload_incomplete:true,pending_uploads:[]}],error:null}},
})}));
import { POST } from "@/app/api/warehouse-portal/[token]/route";
it("#15 the real POST preserves a confirmation made after the initial read",async()=>{
 state.status="UPLOADED";state.patches=[];
 const form=new FormData();form.set("action","submission");form.set("period_start","2026-10-01");form.set("period_end","2026-10-07");
 form.set("files",new File(["%PDF-1.4"],"qa.pdf",{type:"application/pdf"}));
 const response=await POST(new Request("http://localhost/api/warehouse-portal/token",{method:"POST",body:form}),{params:Promise.resolve({token:"token"})});
 expect(response.status).toBe(409);expect(state.status).toBe("CONFIRMED");expect(state.patches).toEqual([]);
});
