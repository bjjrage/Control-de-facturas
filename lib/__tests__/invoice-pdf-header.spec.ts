import { afterEach, expect, it, vi } from "vitest";
import { extractInvoiceFieldsFromPdf } from "../invoice-extraction";
function pdfBytes(lines:string[]) {
 const text="BT\n/F1 11 Tf\n50 790 Td\n15 TL\n"+lines.map((s,i)=>(i?"T*\n":"")+"("+s+") Tj").join("\n")+"\nET";
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`];
 let source="%PDF-1.4\n";const offsets:number[]=[];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(source));source+=`${i+1} 0 obj\n${o}\nendobj\n`});
 const xref=Buffer.byteLength(source);source+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return Buffer.from(source);
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
it("actual PDF text overrides a model that dropped printed monetary decimals",async()=>{
 vi.stubEnv("OPENAI_API_KEY","unit-test-key");
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({provider_tax_id:"800000001",invoice_number:"001",invoice_date:"2026-10-17",subtotal:454545,vat:45454,total:500000,items:[]})}}]})})));
 const result=await extractInvoiceFieldsFromPdf(pdfBytes(['FACTURA SINTETICA QA','Subtotal sin IVA: 454.545,45 PYG','IVA 10%: 45.454,55 PYG','TOTAL IVA INCLUIDO: 500.000 PYG','Moneda: PYG']));
 expect(result.error).toBeNull();expect(result.data).toMatchObject({subtotal:454545.45,vat:45454.55,total:500000,currency:"PYG"});
},30000);
