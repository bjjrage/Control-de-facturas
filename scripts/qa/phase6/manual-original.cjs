const {db,must,session,action,save,assert,fs,path,out}=require('./context.cjs');
const {randomUUID}=require('node:crypto');
function pdf(lines){
 const stream='BT\n/F1 12 Tf\n40 780 Td\n18 TL\n'+lines.map((s,i)=>(i?'T*\n':'')+'('+s.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+'\nET';
 return assemble(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]);
}
function assemble(objects){let bytes=Buffer.from('%PDF-1.4\n');const offsets=[];objects.forEach((o,i)=>{offsets.push(bytes.length);bytes=Buffer.concat([bytes,Buffer.from(`${i+1} 0 obj\n`),Buffer.from(o),Buffer.from('\nendobj\n')])});const xref=bytes.length;return Buffer.concat([bytes,Buffer.from('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)]);}
async function main(){
 const s=await session(),empresaId='f775a9e6-30a6-4156-98f7-bfed0e8d87da',userId='6037b09a-c8b4-4aa5-9c3a-f655330bf430';const results=[];
 const provider=must(await db.from('providers').select('id,tax_id,name').eq('empresa_id',empresaId).not('tax_id','is',null).limit(1).single());
 for(const kind of ['ruc-mismatch','unreadable','blank-image']){
  const blank=require('@napi-rs/canvas').createCanvas(100,100);blank.getContext('2d').fillStyle='white';blank.getContext('2d').fillRect(0,0,100,100);
  const mime=kind==='blank-image'?'image/png':'application/pdf',extension=kind==='blank-image'?'.png':'.pdf';
  const number='009-006-'+String(Date.now()).slice(-7);const bytes=kind==='blank-image'?blank.toBuffer('image/png'):kind==='unreadable'?Buffer.from('%PDF-1.4\nINVALID unreadable QA'):pdf(['FACTURA SINTETICA QA - NO FISCAL','Proveedor de otro RUC','RUC EMISOR: 80099999-1','Factura Nro: '+number,'Fecha de emision: 19/10/2026','Moneda: PYG','Subtotal SIN IVA: 100.000 PYG','IVA 10%: 10.000 PYG','TOTAL CON IVA: 110.000 PYG']);
  const storagePath=empresaId+'/inbox/phase6-'+kind+'-'+randomUUID()+extension;must(await db.storage.from('invoice-files').upload(storagePath,bytes,{contentType:mime}));
  const job=must(await db.from('invoice_jobs').insert({empresa_id:empresaId,created_by:userId,storage_path:storagePath,file_name:kind+extension,mime_type:mime,status:'needs_review',extracted:{items:[]},attempts:0}).select('id').single());
  const fd=new FormData();for(const[k,v]of Object.entries({provider_id:provider.id,invoice_number:number,invoice_date:'2026-10-19',currency:'PYG',subtotal:'100000',vat:'10000',total:'110000',arithmetic_confirmed:'on'}))fd.set(k,v);
  const r=await action(s,'/invoices/revision','resolveInvoiceJob',[job.id,fd]);
  const after=must(await db.from('invoice_jobs').select('id,status,invoice_id,outcome,message').eq('id',job.id).single());
  const invoice=after.invoice_id?must(await db.from('invoices').select('id,status,attachment_id').eq('id',after.invoice_id).single()):null;
  const matches=after.invoice_id?must(await db.from('invoice_order_matches').select('id').eq('invoice_id',after.invoice_id)):[];
  const detail={kind,response:r,job:after,invoice,matches};results.push(detail);save('manual-original',results);
  assert.equal(r.status,200);assert.ok(r.data.error);assert.equal(after.status,'needs_review');assert.ok(invoice);assert.equal(invoice.status,'PENDIENTE');assert.equal(matches.length,0);
  if(kind==='ruc-mismatch')assert.match(r.data.error,/RUC/);else assert.match(r.data.error,/PDF|leer|original|RUC/);
  console.log('PASS #8',kind,after.id,invoice.id,r.data.error);
 }
 const {createCanvas}=require('@napi-rs/canvas');const canvas=createCanvas(1000,1400),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1000,1400);ctx.fillStyle='black';ctx.font='28px sans-serif';
 ['FACTURA QA ESCANEADA - NO FISCAL','Proveedor QA','RUC: 80099999-1','Factura Nro: 009-006-0000001','Fecha: 19/10/2026','Moneda: PYG','Subtotal sin IVA: 100.000 PYG','IVA 10%: 10.000 PYG','TOTAL CON IVA: 110.000 PYG'].forEach((l,i)=>ctx.fillText(l,40,80+i*70));
 const jpg=canvas.toBuffer('image/jpeg');const draw='q 595 0 0 842 0 0 cm /Im1 Do Q';
 const scan=assemble(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 1400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`),jpg,Buffer.from('\nendstream')]),`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
 fs.writeFileSync(path.join(out,'c06-scan.pdf'),scan);const fd=new FormData();fd.set('file',new File([scan],'c06-scan.pdf',{type:'application/pdf'}));const result=await action(s,'/invoices','extractInvoiceFromPhoto',[fd]);save('c06-scan-result',result);assert.match(result.data.error,/no tiene texto/);console.log('C06 reproduced: explicit unsupported scan, no invoice accepted');
}
main().catch(e=>{console.error(e);process.exitCode=1});
