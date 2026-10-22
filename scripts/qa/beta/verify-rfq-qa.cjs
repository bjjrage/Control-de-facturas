const fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=process.cwd(),req=createRequire(root+'/package.json');req('@next/env').loadEnvConfig(root,false);assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'kyiihlkncatojvlasoag.supabase.co');
const {createClient}=req('@supabase/supabase-js'),{buildPdf}=require('./fixture-pdf.cjs');
const users=JSON.parse(fs.readFileSync(root+'/.qa/users.json','utf8')),url=process.env.NEXT_PUBLIC_SUPABASE_URL,options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options),human=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const output=process.env.BETA_EVAL_OUTPUT_DIR||root+'/.qa/beta-rfq';fs.mkdirSync(output,{recursive:true});
const report={qa:'kyiihlkncatojvlasoag',status:'RUNNING',checks:[],createdIds:[]};
async function rpc(client,name,args){const r=await client.rpc(name,args);if(r.error)throw Error(name+': '+r.error.message);return r.data;}
async function insert(table,row){const r=await service.from(table).insert(row).select('id').single();if(r.error)throw Error(table+': '+r.error.message);return r.data.id;}
(async()=>{
const auth=await human.auth.signInWithPassword({email:users.admin_a.email,password:process.env.E2E_PASSWORD});assert.equal(auth.error,null);
const company=users.admin_a.empresa_id,stamp=Date.now().toString(36).toUpperCase();
const providerIds=[];for(let i=0;i<2;i++)providerIds.push(await insert('providers',{empresa_id:company,name:'QA Beta RFQ '+stamp+' '+i,tax_id:String(Date.now()).slice(-8)+i,active:true}));
for(const moreFreight of [false,true]){
 const rfq=await rpc(human,'rfq_create',{p_header:{purpose:'PROCUREMENT',product:'QA Beta '+stamp+' flete='+moreFreight},p_items:[{descripcion:'Material QA beta',cantidad:10,unidad:'un'}],p_provider_ids:providerIds});
 report.createdIds.push({rfq:rfq.id});
 const items=await service.from('rfq_items').select('id').eq('rfq_id',rfq.id);assert.equal(items.error,null);
 const links=await service.from('rfq_providers').select('id,provider_id,token').eq('rfq_id',rfq.id);assert.equal(links.error,null);
 let selected;
 for(const link of links.data){
  const chosen=link.provider_id===providerIds[0];const path=company+'/beta-'+stamp+'-'+link.id+'.pdf';const bytes=buildPdf(['OFERTA QA SINTETICA','Material QA beta x10','Precio unitario: '+(chosen?90:100),'Flete: '+(chosen&&moreFreight?500:20)]);
  const uploaded=await service.storage.from('quote-pdfs').upload(path,bytes,{contentType:'application/pdf'});assert.equal(uploaded.error,null);
  const attachment=await insert('attachments',{empresa_id:company,bucket:'quote-pdfs',path,file_name:'oferta-qa.pdf',rfq_provider_id:link.id});
  const quote=await rpc(service,'rfq_submit_version',{p_token:link.token,p_offer:{budget_number:'QA-BETA',currency:'PYG',vat_included:false,invoice_available:true,valid_until:'2030-01-01T00:00:00Z',freight:chosen&&moreFreight?500:20,payment_terms:'30 days'},p_items:[{rfq_item_id:items.data[0].id,precio_unitario:chosen?90:100,available_quantity:10,tax_rate:10,lead_time_days:5}],p_attachment_id:attachment,p_actor_id:null});
  await rpc(human,'rfq_review_quote',{p_version_id:quote.versionId,p_extraction:{},p_comparison:{},p_resolution:'Verificado contra PDF sintetico QA beta'});
  if(chosen){const line=await service.from('quote_version_items').select('id').eq('quote_version_id',quote.versionId).single();assert.equal(line.error,null);selected=line.data.id;}
 }
 const allocation=await rpc(human,'rfq_save_allocation',{p_rfq_id:rfq.id,p_lines:[{quote_version_item_id:selected,quantity:10}],p_justification:'Precio conveniente',p_expected_revision:0});
 await rpc(human,'rfq_authorize_allocation',{p_allocation_id:allocation.id,p_confirm:true});
 const preview=await rpc(human,'rfq_preview_orders',{p_allocation_id:allocation.id});
 const confirmed=await rpc(human,'rfq_confirm_orders',{p_allocation_id:allocation.id,p_preview_hash:preview.hash,p_confirm:true});
 const row=await service.from('authorized_orders').select('id,is_cheapest,selection_reason,selection_reason_detail').eq('id',confirmed.orderIds[0]).single();assert.equal(row.error,null);
 assert.equal(row.data.is_cheapest,!moreFreight);assert.equal(row.data.selection_reason,!moreFreight?null:'OTRO');assert.equal(row.data.selection_reason_detail,'Precio conveniente');
 report.checks.push({higherFreight:moreFreight,...row.data});fs.writeFileSync(output+'/rfq-qa-results.json',JSON.stringify(report,null,2));
}
report.status='PASS';fs.writeFileSync(output+'/rfq-qa-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await human.auth.signOut({scope:'local'});
})().catch(e=>{report.status='FAIL';report.error=e.message;fs.writeFileSync(output+'/rfq-qa-results.json',JSON.stringify(report,null,2));console.error(e.message);process.exitCode=1;});
