import { expect,it,vi } from "vitest";
import * as sales from "../lib/sales";
import { sourceFunctions } from "./support/source-functions";
const doc={id:"d",client_id:"c",doc_type:"FACTURA",status:"EMITIDA",currency:"PYG",total:10,cobrado_amount:0,code:"V1"};
const receipt={id:"r",sales_document_id:"d",method:"EFECTIVO",amount:10,receipt_date:"2026-10-01",reversed_at:null};
function db(reversed=false){return {from(table:string){
 const rows=table==="sales_documents"?[doc]:table==="sales_receipts"?[{...receipt,reversed_at:reversed?"2026-10-02":null,reversal_reason:"Error de carga"}]:[];
 const q:any={};for(const m of["select","eq","in","order","limit","returns"])q[m]=()=>q;
 q.single=q.maybeSingle=async()=>({data:table==="sales_documents"?doc:table==="clients"?{name:"Cliente"}:{nombre:"Empresa"},error:null});
 q.then=(resolve:any)=>Promise.resolve({data:rows,error:null}).then(resolve);return q;
 }};}
function nodes(n:any):any[]{return !n||typeof n!=="object"?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)]}
function deps(reversed=false){return {...sales,requireModule:async()=>({role:"admin",empresa_id:"e"}),createClient:async()=>db(reversed),
 formatDate:String,formatMoney:String,Link:"a",ArrowLeft:"icon",Printer:"icon",Badge:"badge",Button:"button",
 ReceiptDialog:"dialog",SifenButton:"sifen",QuotationPanel:"quotation",PrintTrigger:"print",LOGO_STORAGE_PATH:"logo",
 salesReceivables:()=>({balances:new Map([["d",10]]),signedBalances:new Map([["d",10]]),pendingByCurrency:new Map(),creditByCurrency:new Map()}),
 };}
it("#21 a failed receipt reversal reaches the existing error alert through redirect",async()=>{
 const redirect=vi.fn(),{VentaDetailPage}=sourceFunctions("app/(internal)/ventas/[id]/page.tsx",["VentaDetailPage"],{
  ...deps(),reverseReceipt:async()=>({error:"No se pudo revertir"}),redirect,
 });
 const tree=await VentaDetailPage({params:Promise.resolve({id:"d"}),searchParams:Promise.resolve({})});
 const form=nodes(tree).find(n=>n.type==="form"&&nodes(n).some(c=>c.type==="button"&&c.props.children==="Revertir"));
 await form.props.action();expect(redirect).toHaveBeenCalledWith("/ventas/d?error="+encodeURIComponent("No se pudo revertir"));
});

