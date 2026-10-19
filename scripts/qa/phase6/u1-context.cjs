const {db,must,session,action,fs,path,root,assert}=require('./context.cjs');
const out=path.join(root,'audit-evidence/c06-u1-2026-10-19');
(async()=>{
 const privatePath=path.join(out,'u1-private-context.json');
 if(fs.existsSync(privatePath)){console.log('U1 context already exists; no new links or documents');return;}
 const s=await session(),empresa='f775a9e6-30a6-4156-98f7-bfed0e8d87da';
 const client=must(await db.from('clients').select('id').eq('empresa_id',empresa).limit(1).single());
 const fd=new FormData();for(const[k,v]of Object.entries({client_id:client.id,doc_type:'PROFORMA',currency:'PYG',issue_date:'2026-10-19',notes:'QA U1 - no fiscal - revisión visual',items:JSON.stringify([{description:'QA U1 pantalla pública',quantity:1,unit_price:11000,vat_rate:10}])}))fd.set(k,v);
 const existing=must(await db.from('sales_documents').select('id').eq('empresa_id',empresa).eq('notes','QA U1 - no fiscal - revisión visual').order('created_at',{ascending:false}).limit(1).maybeSingle());
 const created=existing?{data:{error:null,id:existing.id}}:await action(s,'/proformas/nueva','createSalesDocument',[fd]);assert.equal(created.data.error,null,JSON.stringify(created));
 const saleId=created.data.id;
 const quote=await action(s,'/ventas/'+saleId,'createQuotationLink',[saleId,new FormData()]);assert.equal(quote.data.error,null,JSON.stringify(quote));
 const order=must(await db.from('authorized_orders').select('id,project_id').eq('id','fb4133a5-0976-47f6-bdb8-29835844734e').single());
 const receipt=await action(s,'/orders/'+order.id,'createReceiptPortalLink',[order.id]);assert.equal(receipt.data.error,null,JSON.stringify(receipt));
 const location=must(await db.from('inventory_locations').select('id,project_id').eq('empresa_id',empresa).eq('project_id',order.project_id).eq('location_type','PROJECT').eq('active',true).limit(1).single());
 const warehouse=await action(s,'/projects/'+location.project_id+'?tab=panol','createWarehousePortalLink',[location.id]);assert.equal(warehouse.data.error,null,JSON.stringify(warehouse));
 const invitations=must(await db.from('rfq_providers').select('token,rfq_id,token_revoked_at,token_expires_at,rfqs!rfq_providers_rfq_id_fkey(status,expires_at)').eq('empresa_id',empresa).is('token_revoked_at',null));
 const invite=invitations.find(x=>['BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS'].includes(x.rfqs.status)&&Date.parse(x.token_expires_at??x.rfqs.expires_at)>Date.now()&&Date.parse(x.rfqs.expires_at)>Date.now());
 const rfq=must(await db.from('rfqs').select('id,project_id').eq('empresa_id',empresa).not('project_id','is',null).limit(1).single());
 const route=value=>{assert.ok(value);return new URL(value,'http://localhost:3018').pathname;};
 const context={saleId,orderId:order.id,orderProjectId:order.project_id,rfqId:rfq.id,rfqProjectId:rfq.project_id,quote:route(quote.data.url),receipt:route(receipt.data.url),warehouse:route(warehouse.data.url),supplier:invite?'/cotizar/'+invite.token:null};
 fs.writeFileSync(privatePath,JSON.stringify(context,null,2));
 const {quote:q,receipt:r,warehouse:w,supplier:p,...publicContext}=context;
 fs.writeFileSync(path.join(out,'u1-fixture.json'),JSON.stringify({...publicContext,portalsPrepared:{quote:!!q,receipt:!!r,warehouse:!!w,supplier:!!p}},null,2));
 console.log(JSON.stringify({...publicContext,portalsPrepared:{quote:!!q,receipt:!!r,warehouse:!!w,supplier:!!p}}));
})().catch(e=>{console.error(e);process.exitCode=1});
