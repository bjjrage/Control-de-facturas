import {expect,it,vi} from "vitest";
import {sourceFunctions} from "./support/source-functions";
it("#8 manual resolution verifies the actual original before attempting any OC match",async()=>{
 const match=vi.fn(async()=>null),verify=vi.fn(async()=>({error:"RUC del original distinto"}));
 const job={id:"j",status:"needs_review",attempts:1,storage_bucket:"invoice-files",storage_path:"e/inbox/qa.pdf",file_name:"qa.pdf",mime_type:"application/pdf",extracted:{items:[]}};
 const writes:any[]=[];
 const db={from:(table:string)=>{
  let patch:any=null;const q:any={};for(const name of["select","eq","is","delete"])q[name]=()=>q;
  q.update=(p:any)=>{patch=p;writes.push(p);return q};q.insert=()=>q;
  q.single=q.maybeSingle=async()=>({error:null,data:table==="invoice_jobs"?patch?{id:"j",attempts:2}:job:table==="providers"?{id:"p"}:{id:"att"}});
  q.then=(resolve:any)=>Promise.resolve({error:null,data:{id:"j"}}).then(resolve);return q;
 },rpc:async()=>({data:{ok:true,invoice_id:"i"},error:null}),storage:{from:()=>({copy:async()=>({error:null})})}};
 const {resolveInvoiceJob}=sourceFunctions("app/(internal)/invoices/revision/actions.ts",["str","num","isOwnedInboxObject","resolveInvoiceJob"],{
  requireProfile:async()=>({id:"u",empresa_id:"e"}),createClient:async()=>db,createAdminClient:()=>db,
  parseInvoiceLinesInputStrict:()=>({items:[],error:null}),validateInvoiceArithmetic:()=>({status:"VALIDA"}),
  sanitizeFileName:(s:string)=>s,autoMatchInvoiceByAmount:match,verifyInvoiceOriginal:verify,logAudit:vi.fn(),revalidatePath:vi.fn(),
 });
 const form=new FormData();for(const[k,v]of Object.entries({provider_id:"p",invoice_number:"001",invoice_date:"2026-10-01",total:"100"}))form.set(k,v);
 const result=await resolveInvoiceJob("j",form);
 expect(verify).toHaveBeenCalledWith("i");expect(match).not.toHaveBeenCalled();expect(result.error).toContain("RUC");
 expect(writes.some(p=>p.status==="needs_review"&&p.invoice_id==="i")).toBe(true);
});
