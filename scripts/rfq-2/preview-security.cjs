// Real Auth/RLS checks, exclusively against the dedicated synthetic Preview.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {createClient} = require('@supabase/supabase-js');
const root = 'audit-artifacts/batch-03/private';
const bytes = fs.readFileSync(`${root}/preview-config.json`);
const cfg = JSON.parse(bytes.toString(bytes[0] === 255 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, ''));
assert.equal(cfg.SUPABASE_URL, 'https://afedslxxtttyqunqmutz.supabase.co');
const fixture = JSON.parse(fs.readFileSync(`${root}/browser-fixture.json`, 'utf8'));
const result = JSON.parse(fs.readFileSync(`${root}/browser-result.json`, 'utf8'));
const client = key => createClient(cfg.SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
const admin = client(cfg.SUPABASE_SERVICE_ROLE_KEY);
const must = r => {if(r.error)throw Error(r.error.message);return r.data;};
async function main() {
  const anon = client(cfg.SUPABASE_ANON_KEY);
  const allocation = must(await admin.from('rfq_allocations').select('id,preview_hash').eq('rfq_id',result.rfq).eq('empresa_id',fixture.empresaId).single());
  for(const table of ['rfq_allocations','rfq_quote_reviews','direct_purchase_previews']) {
    const read=await anon.from(table).select('id');
    assert.ok(read.error || read.data.length===0,`Anonymous access to ${table}`);
  }
  assert.ok((await anon.rpc('rfq_submit_version',{p_token:'invalid',p_offer:{},p_items:[],p_attachment_id:null})).error);
  const human=client(cfg.SUPABASE_ANON_KEY);
  must(await human.auth.signInWithPassword({email:fixture.email,password:fixture.password}));
  assert.ok((await human.rpc('rfq_submit_version',{p_token:'invalid',p_offer:{},p_items:[],p_attachment_id:null})).error);
  assert.ok((await human.from('rfq_allocations').update({authorized_at:new Date().toISOString()}).eq('id',allocation.id)).error);
  const order=result.orderIds[0];
  assert.ok((await human.from('authorized_order_items').insert({empresa_id:fixture.empresaId,order_id:order,product:'Tampered append',quantity:1,unit:'un',unit_price:1,total_price:1})).error);
  const empresa=must(await admin.from('empresas').insert({nombre:'RFQ synthetic foreign tenant',plan:'pro',active:true}).select('id').single());
  const email=`rfq-foreign-${Date.now()}@example.com`,password=crypto.randomBytes(24).toString('base64url');
  const user=must(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
  must(await admin.from('profiles').upsert({id:user.id,email,full_name:'Synthetic foreign auditor',role:'admin',active:true,empresa_id:empresa.id}));
  const foreign=client(cfg.SUPABASE_ANON_KEY);
  must(await foreign.auth.signInWithPassword({email,password}));
  assert.deepEqual(must(await foreign.from('rfq_allocations').select('id').eq('id',allocation.id)),[]);
  assert.deepEqual(must(await foreign.from('rfqs').select('id').eq('id',result.rfq)),[]);
  for(const [name,args] of [
    ['rfq_preview_orders',{p_allocation_id:allocation.id}],
    ['rfq_authorize_allocation',{p_allocation_id:allocation.id,p_confirm:true}],
    ['rfq_confirm_orders',{p_allocation_id:allocation.id,p_preview_hash:allocation.preview_hash,p_confirm:true}],
    ['rfq_close_discovery',{p_rfq_id:result.discovery,p_confirm:true}],
  ]) assert.ok((await foreign.rpc(name,args)).error,`Foreign mutation ${name}`);
  const evidence={status:'PASS',preview:'afedslxxtttyqunqmutz',checks:['Anonymous read denied','Supplier RPC service-role only','Authenticated direct allocation writes denied','Append to confirmed OC denied','Real active foreign tenant RLS isolation','Foreign preview/authorization/confirmation/closure denied']};
  fs.writeFileSync(`${root}/security-result.json`,JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
