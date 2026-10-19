import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({
 from(table:string){
   const data=table==="warehouse_portal_links"?{id:"link",empresa_id:"tenant",location_id:"loc",active:true,expires_at:"2099-01-01"}:
     table==="inventory_locations"?{id:"loc",location_type:"PROJECT",active:true,project_id:"project"}:
     table==="warehouse_submissions"?{id:"submission",status:"UPLOADED"}:{id:"existing-evidence"};
   const q:any={select:()=>q,eq:()=>q,insert:()=>q,maybeSingle:async()=>({data,error:null}),single:async()=>({data,error:null})};
   return q;
 },
 rpc:async()=>({data:null,error:{code:"P0001",message:"La rendición está cerrada y no admite cambios de ingestión"}}),
})}));
import { POST } from "@/app/api/warehouse-portal/[token]/route";
it("D5 returns a clear conflict if the submission closes during upload",async()=>{
 const form=new FormData();form.set("action","submission");form.set("period_start","2026-10-01");form.set("period_end","2026-10-07");
 form.set("files",new File(["%PDF-1.4"],"qa.pdf",{type:"application/pdf"}));
 const response=await POST(new Request("http://localhost/api/warehouse-portal/token",{method:"POST",body:form}),{params:Promise.resolve({token:"token"})});
 expect(response.status).toBe(409);expect((await response.json()).error).toMatch(/cerrada/);
});
