// Real browser + isolated QA Storage/DB; no deploy and no production credentials.
const { db, must, session, request, action, root, env, ref, fs, path, assert } = require('./phase6/context.cjs');
const { createClient } = require('@supabase/supabase-js');
const { chromium, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const MAX = 20 * 1024 * 1024;
const base = 'http://localhost:3018';
const output = path.join(root, 'audit-evidence/direct-storage-20mib-2026-10-19');
fs.mkdirSync(output, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
function pdf(lines, target) {
  const stream='BT\n/F1 11 Tf\n40 790 Td\n22 TL\n'+lines.map((s,i)=>(i?'T*\n':'')+'('+s.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+'\nET';
  function assemble(padding) {
    const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),Buffer.concat([Buffer.from(`<< /Length ${padding} >>\nstream\n`),Buffer.alloc(padding,32),Buffer.from('\nendstream')])];
    const parts=[Buffer.from('%PDF-1.4\n')],offsets=[];let offset=parts[0].length;
    objects.forEach((object,i)=>{offsets.push(offset);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(part);offset+=part.length;});
    parts.push(Buffer.from('xref\n0 7\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
  let padding=Math.max(0,target-assemble(0).length),bytes;
  for(let i=0;i<5;i++){bytes=assemble(padding);if(bytes.length===target)return bytes;padding+=target-bytes.length;}
  throw Error('No se pudo generar el PDF del tamaño exacto.');
}
let browser;
(async()=>{
  assert.equal(ref,'kyiihlkncatojvlasoag');
  const s=await session();
  const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const number='020-020-'+String(Date.now()).slice(-7);
  const bytes=pdf(['FACTURA QA SINTETICA - NO FISCAL','Proveedor QA C06','RUC EMISOR: 80099999-1','Factura Nro: '+number,'Fecha de emision: 19/10/2026','Moneda: PYG','Item: Servicio QA | Cantidad: 1 un | Precio unitario SIN IVA: 100.000 | Importe SIN IVA: 100.000','Subtotal SIN IVA: 100.000 PYG','IVA 10%: 10.000 PYG','TOTAL CON IVA: 110.000 PYG'],MAX);
  const metadata={name:'qa-exact-20mib.pdf',type:'application/pdf',size:bytes.length,sha256:sha(bytes)};
  const report={project:ref,base,baseCommit:'291ab36973816a9258fd8bbd6d931948c46afdca',buildId:fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim(),file:{bytes:bytes.length,sha256:sha(bytes)},checks:[],appRequests:[],storageRequests:[]};
  function pass(name,data={}){report.checks.push({name,status:'PASS',...data});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log('PASS '+name);}
  async function mint(context, metadataOverride=metadata, auth=s){
    const r=await request(auth,'/api/document-uploads',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify({context,file:metadataOverride})});
    return {status:r.status,data:await r.json()};
  }
  async function stage(context,buffer=bytes,auth=s,meta={...metadata,size:buffer.length,sha256:sha(buffer)}){
    const signed=await mint(context,meta,auth);assert.equal(signed.status,200,'mint status');
    const result=await anon.storage.from('direct-document-uploads').uploadToSignedUrl(signed.data.path,signed.data.token,buffer,{contentType:meta.type});assert.equal(result.error,null,'direct Storage upload');return signed.data;
  }
  const rejected=await mint({kind:'internal'},{...metadata,size:MAX+1});assert.equal(rejected.status,400);pass('20 MiB + 1 rejected before signing');
  const anonymous=await mint({kind:'internal'},metadata,{cookie:''});assert.equal(anonymous.status,400);pass('anonymous internal upload rejected');
  const oversizedGrant=await mint({kind:'internal'});assert.equal(oversizedGrant.status,200);
  const overflow=await anon.storage.from('direct-document-uploads').uploadToSignedUrl(oversizedGrant.data.path,oversizedGrant.data.token,Buffer.alloc(MAX+1),{contentType:'application/pdf'});assert.ok(overflow.error);pass('Storage independently rejects 20 MiB + 1');
  // Same length, different content: ticket checksum must stop extraction.
  const tampered=Buffer.from(bytes);tampered[100]^=1;
  const tamperedObject=await stage({kind:'internal'},tampered,s,metadata);
  const tamperForm=new FormData();tamperForm.set('file',tamperedObject.reference);
  const tamperResult=await action(s,'/invoices','extractInvoiceFromPhoto',[tamperForm]);assert.match(tamperResult.data.error,/contenido/);pass('modified bytes rejected before OCR');
  // Browser blocks app bodies above 4 MiB; Storage requests remain direct.
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  await context.addCookies(s.jar.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',sameSite:'Lax'})));
  const page=await context.newPage();
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname.endsWith('.supabase.co')&&url.hostname!==ref+'.supabase.co')return route.abort();
    if(url.origin===base&&req.method()==='POST'){
      const size=req.postDataBuffer()?.length||0;
      report.appRequests.push({route:url.pathname,bytes:size,action:Boolean(req.headers()['next-action'])});
      if(size>4*1024*1024)return route.fulfill({status:413,body:'QA guard: app request above 4 MiB'});
    }
    if(url.hostname===ref+'.supabase.co'&&url.pathname.includes('/storage/v1/object/upload/sign/'))report.storageRequests.push({bytes:req.postDataBuffer()?.length||0,method:req.method()});
    return route.continue();
  });
  await page.goto(base+'/invoices');
  await page.getByRole('button',{name:/^(\+ )?Nueva factura$/}).filter({visible:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({name:metadata.name,mimeType:metadata.type,buffer:bytes});
  await expect(dialog.locator('input[name=extraction_proof]')).not.toHaveValue('',{timeout:120000});
  await expect(dialog.getByLabel('N° de factura',{exact:true})).toHaveValue(number);
  await page.screenshot({path:path.join(output,'invoice-20mib-read.png'),fullPage:true});
  pass('browser reads exact 20 MiB PDF through direct Storage');
  await dialog.getByRole('button',{name:'Crear factura',exact:true}).click();
  await page.waitForURL(/\/invoices\/[a-f0-9-]+\?/,{timeout:120000});
  const invoiceId=new URL(page.url()).pathname.split('/').pop();
  const invoice=must(await db.from('invoices').select('id,attachment_id,status,total').eq('id',invoiceId).eq('empresa_id','f775a9e6-30a6-4156-98f7-bfed0e8d87da').single());
  const attachment=must(await db.from('attachments').select('bucket,path,size_bytes').eq('id',invoice.attachment_id).single());
  const original=must(await db.storage.from(attachment.bucket).download(attachment.path));assert.equal(sha(Buffer.from(await original.arrayBuffer())),sha(bytes));assert.equal(Number(attachment.size_bytes),MAX);
  const identity=must(await db.from('invoice_identity_evidence').select('invoice_id,attachment_id').eq('invoice_id',invoiceId).single());assert.equal(identity.attachment_id,invoice.attachment_id);
  assert.ok(report.appRequests.length>=4);assert.ok(report.appRequests.every(r=>r.bytes<4*1024*1024));assert.ok(report.storageRequests.filter(r=>r.bytes>=MAX).length>=2);
  pass('browser saves 20 MiB original byte-for-byte and verified identity',{invoice,largestAppRequestBytes:Math.max(...report.appRequests.map(r=>r.bytes))});
  await page.screenshot({path:path.join(output,'invoice-20mib-saved.png'),fullPage:true});
  // Real mobile session; initial QR cannot authorize file transport.
  const createdResponse=await request(s,'/api/scanner/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contextType:'general',metadata:{qa:'direct-storage-20mib'}})});
  const created=await createdResponse.json();assert.equal(createdResponse.status,200);
  const qrAttempt=await mint({kind:'scanner',mobileClaimToken:created.token},metadata,{cookie:''});assert.equal(qrAttempt.status,400);pass('initial QR token cannot authorize upload');
  const claimedResponse=await request({cookie:''},'/api/scanner/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:created.token,deviceInfo:{qa:'direct-storage-20mib'}})});
  const claimed=await claimedResponse.json();assert.equal(claimedResponse.status,200);assert.ok(claimed.mobileClaimToken);
  const mobile={kind:'scanner',mobileClaimToken:claimed.mobileClaimToken};
  const scan=await stage(mobile,bytes,{cookie:''});
  const scanForm=new FormData();scanForm.set('mobileClaimToken',claimed.mobileClaimToken);scanForm.set('pageCount','1');scanForm.set('file',scan.reference);
  const completed=await request({cookie:''},'/api/scanner/upload',{method:'POST',body:scanForm});assert.equal(completed.status,200,'scanner completion');
  const scanRow=must(await db.from('scan_sessions').select('status,storage_bucket,storage_path,file_size_bytes').eq('id',created.sessionId).single());assert.equal(scanRow.status,'completed');assert.equal(scanRow.file_size_bytes,MAX);
  const scanOriginal=must(await db.storage.from(scanRow.storage_bucket).download(scanRow.storage_path));assert.equal(sha(Buffer.from(await scanOriginal.arrayBuffer())),sha(bytes));
  const replay=await request({cookie:''},'/api/scanner/upload',{method:'POST',body:scanForm});assert.ok([403,409].includes(replay.status));pass('mobile scanner stores exact 20 MiB and blocks replay',{sessionId:created.sessionId});
  const orderId='fb4133a5-0976-47f6-bdb8-29835844734e';
  const itemId='e020ee10-21d7-41fa-9195-ed7685f88cf6';
  const empresaId='f775a9e6-30a6-4156-98f7-bfed0e8d87da';
  const order=must(await db.from('authorized_orders').select('id,project_id').eq('id',orderId).eq('empresa_id',empresaId).single());
  const location=must(await db.from('inventory_locations').select('id').eq('empresa_id',empresaId).eq('project_id',order.project_id).eq('location_type','PROJECT').eq('active',true).limit(1).single());
  // Internal receipt: same direct transport, existing canonical/idempotent write.
  const receiptDocument=await stage({kind:'internal'});
  const receiptKey=require('node:crypto').randomUUID();
  const receiptArgs=[orderId,'2026-10-19','QA direct Storage 20 MiB',[{order_item_id:itemId,cantidad_recibida:1,producto_id:'717910ae-3241-46b4-95d6-1aee45900a7c'}],'Synthetic QA evidence',receiptKey,'QA-20MIB',receiptDocument.reference];
  const registered=await action(s,'/orders/'+orderId,'registrarRecepcion',receiptArgs);assert.ok(!registered.data.error,'internal receipt must confirm');assert.ok(registered.data.receiptId);
  const receiptEvidence=must(await db.from('inventory_receipt_evidence').select('storage_bucket,storage_path,size_bytes').eq('receipt_id',registered.data.receiptId).single());
  const receiptBytes=must(await db.storage.from(receiptEvidence.storage_bucket).download(receiptEvidence.storage_path));assert.equal(sha(Buffer.from(await receiptBytes.arrayBuffer())),sha(bytes));assert.equal(Number(receiptEvidence.size_bytes),MAX);
  const countBefore=must(await db.from('oc_recepciones').select('id').eq('order_id',orderId)).length;
  receiptArgs[7]=(await stage({kind:'internal'})).reference;
  const receiptRetry=await action(s,'/orders/'+orderId,'registrarRecepcion',receiptArgs);assert.equal(receiptRetry.data.receiptId,registered.data.receiptId);assert.ok(!receiptRetry.data.error);assert.equal(must(await db.from('oc_recepciones').select('id').eq('order_id',orderId)).length,countBefore);
  pass('internal receipt stores exact 20 MiB and retry does not duplicate receipt',{receiptId:registered.data.receiptId});
  // Anonymous public receipt, authenticated solely by its newly generated QA capability.
  const receiptLink=await action(s,'/orders/'+orderId,'createReceiptPortalLink',[orderId]);assert.equal(receiptLink.data.error,null);
  const receiptToken=new URL(receiptLink.data.url).pathname.split('/').pop();
  const portalStage=await stage({kind:'receipt',token:receiptToken},bytes,{cookie:''});
  const publicForm=new FormData();publicForm.set('fecha','2026-10-19');publicForm.set('recibido_por','QA public direct Storage');publicForm.set('items',JSON.stringify([{order_item_id:itemId,quantity:1}]));publicForm.set('files',portalStage.reference);
  const publicReceipt=await request({cookie:''},'/api/recepcion-portal/'+receiptToken,{method:'POST',body:publicForm});const publicResult=await publicReceipt.json();assert.equal(publicReceipt.status,201,'public receipt status');assert.equal(publicResult.status,'CONFIRMED');
  const publicEvidence=must(await db.from('inventory_receipt_evidence').select('storage_bucket,storage_path,size_bytes').eq('receipt_id',publicResult.receiptId).single());
  const publicBytes=must(await db.storage.from(publicEvidence.storage_bucket).download(publicEvidence.storage_path));assert.equal(sha(Buffer.from(await publicBytes.arrayBuffer())),sha(bytes));assert.equal(Number(publicEvidence.size_bytes),MAX);
  pass('anonymous receipt portal confirms with exact 20 MiB original',{receiptId:publicResult.receiptId});
  const publicReplay=await mint({kind:'receipt',token:receiptToken},metadata,{cookie:''});assert.equal(publicReplay.status,400);pass('consumed receipt capability cannot authorize another upload');
  // Warehouse evidence is a separate public scope; no stock mutation for submission.
  const warehouseLink=await action(s,'/projects/'+order.project_id,'createWarehousePortalLink',[location.id]);assert.equal(warehouseLink.data.error,null);
  const warehouseToken=warehouseLink.data.token;
  const warehouseStage=await stage({kind:'warehouse',token:warehouseToken},bytes,{cookie:''});
  const warehouseForm=new FormData();warehouseForm.set('action','submission');warehouseForm.set('period_start','2040-01-01');warehouseForm.set('period_end','2040-01-01');warehouseForm.set('notes','Synthetic QA direct Storage 20 MiB');warehouseForm.set('files',warehouseStage.reference);
  const warehouseResponse=await request({cookie:''},'/api/warehouse-portal/'+warehouseToken,{method:'POST',body:warehouseForm});const warehouseResult=await warehouseResponse.json();assert.equal(warehouseResponse.status,200,'warehouse evidence status');assert.equal(warehouseResult.uploaded,1);
  const warehouseEvidence=must(await db.from('warehouse_submission_evidence').select('storage_bucket,storage_path,size_bytes').eq('submission_id',warehouseResult.submissionId).eq('sha256',sha(bytes)).single());
  const warehouseBytes=must(await db.storage.from(warehouseEvidence.storage_bucket).download(warehouseEvidence.storage_path));assert.equal(sha(Buffer.from(await warehouseBytes.arrayBuffer())),sha(bytes));
  pass('anonymous warehouse portal stores exact 20 MiB evidence',{submissionId:warehouseResult.submissionId});
  const linkHash=sha(Buffer.from(warehouseToken));
  must(await db.from('warehouse_portal_links').update({active:false}).eq('token_hash',linkHash).eq('empresa_id',empresaId));
  const revoked=await mint({kind:'warehouse',token:warehouseToken},metadata,{cookie:''});assert.equal(revoked.status,400);pass('revoked warehouse capability cannot authorize upload');
  await browser.close();browser=null;
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log('QA evidence saved without credentials or signed references.');
})().catch(async error=>{if(browser)await browser.close();console.error('QA failed: '+String(error.message).slice(0,700));process.exitCode=1;});
