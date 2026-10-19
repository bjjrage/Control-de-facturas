const {db,must,session,request,action,save,assert,fs,path,out}=require('./context.cjs');
const control=body=>fetch('http://localhost:4018/rules',{method:'POST',body:JSON.stringify(body)});
const {createHash}=require('node:crypto');
(async()=>{
 const s=await session(); const f=JSON.parse(fs.readFileSync(path.join(out,'api-fixture.json'),'utf8'));const empresa='f775a9e6-30a6-4156-98f7-bfed0e8d87da';
 if(!f.receiptOrderId){
  // Reuse the existing synthetic 100-unit OC; do not bypass direct-purchase guards.
  const source=must(await db.from('authorized_order_items').select('id,order_id').eq('order_id','fb4133a5-0976-47f6-bdb8-29835844734e').not('producto_id','is',null).limit(1).single());
  f.receiptOrderId=source.order_id;f.receiptItemId=source.id;save('api-fixture',f);
 }
 const link=await action(s,'/orders/'+f.receiptOrderId,'createReceiptPortalLink',[f.receiptOrderId]);assert.equal(link.data.error,null,JSON.stringify(link));
 const token=new URL(link.data.url).pathname.split('/').pop();
 const pdf=Buffer.from('%PDF-1.4\n% synthetic QA evidence '+Date.now()+'\n%%EOF');
 const canvas=require('@napi-rs/canvas').createCanvas(2,2);canvas.getContext('2d').fillRect(0,0,2,2);const png=canvas.toBuffer('image/png');
 function form(both=false){const fd=new FormData();fd.set('fecha','2026-10-19');fd.set('recibido_por','QA fase6 Storage');fd.set('items',JSON.stringify([{order_item_id:f.receiptItemId,quantity:1}]));if(both)fd.append('files',new File([png],'qa-first.png',{type:'image/png'}));fd.append('files',new File([pdf],'qa-original.pdf',{type:'application/pdf'}));return fd}
 const bucket=must(await db.storage.getBucket('warehouse-evidence'));save('warehouse-bucket-before',bucket);
 const r0=must(await db.from('oc_recepciones').select('id').eq('order_id',f.receiptOrderId));
 const before=must(await db.storage.from('warehouse-evidence').list('receipt-portals'));
 let failure;
 try{
  // Real Storage rejection in isolated environment, not proxy. Narrow MIME temporarily.
  must(await db.storage.updateBucket('warehouse-evidence',{public:bucket.public,allowedMimeTypes:['image/png'],fileSizeLimit:bucket.file_size_limit}));
  const r=await request(s,'/api/recepcion-portal/'+token,{method:'POST',body:form(true)});failure={status:r.status,body:await r.json()};
 }finally{
  must(await db.storage.updateBucket('warehouse-evidence',{public:bucket.public,allowedMimeTypes:bucket.allowed_mime_types,fileSizeLimit:bucket.file_size_limit}));
 }
 const restored=must(await db.storage.getBucket('warehouse-evidence'));assert.equal(restored.public,bucket.public);assert.deepEqual(restored.allowed_mime_types,bucket.allowed_mime_types);assert.equal(restored.file_size_limit,bucket.file_size_limit);
 const afterFail=must(await db.from('oc_recepciones').select('id').eq('order_id',f.receiptOrderId));
 const portalLink=must(await db.from('receipt_portal_links').select('id,active').eq('order_id',f.receiptOrderId).eq('active',true).single());
 const residual=must(await db.storage.from('warehouse-evidence').list('receipt-portals/'+portalLink.id));
 save('real-storage-failure',{failure,receiptsBefore:r0.length,receiptsAfter:afterFail.length,remainingUploadedObjects:residual.length,bucketRestored:true,configuration:restored});
 assert.equal(failure.status,502);assert.equal(afterFail.length,r0.length);assert.equal(residual.length,0);console.log('PASS real Storage MIME rejection; first upload compensated, no receipt; original bucket configuration restored');
 await control([{match:'^POST /rest/v1/rpc/submit_receipt_portal',kind:'lost'}]);
 const r=await request(s,'/api/recepcion-portal/'+token,{method:'POST',body:form()});const uncertain={status:r.status,body:await r.json()};await control([]);
 const receipts=must(await db.from('oc_recepciones').select('id,status').eq('order_id',f.receiptOrderId));
 const attachments=must(await db.storage.from('warehouse-evidence').list('receipt-portals/'+portalLink.id));
 const stored=await Promise.all(attachments.map(async a=>{const blob=must(await db.storage.from('warehouse-evidence').download('receipt-portals/'+portalLink.id+'/'+a.name));return {name:a.name,sha256:createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')}}));
 save('receipt-uncertain',{uncertain,receipts,originals:stored,expectedSha256:createHash('sha256').update(pdf).digest('hex')});
 assert.equal(uncertain.status,503);assert.equal(receipts.length,r0.length+1);assert.equal(receipts.at(-1).status,'CONFIRMED');assert.equal(stored.length,1);assert.equal(stored[0].sha256,createHash('sha256').update(pdf).digest('hex'));
 console.log('PASS submit_receipt_portal: real commit then response loss, HTTP503, original preserved byte-for-byte');
})().catch(e=>{console.error(e);process.exitCode=1});
