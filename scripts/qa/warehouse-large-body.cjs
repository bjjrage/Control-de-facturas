// HTTP regression through a running final Next build, isolated Supabase only.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^"|"$/g,'')]}));
const host=()=>assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,'kyiihlkncatojvlasoag.supabase.co');
host();
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const must=r=>{if(r.error)throw r.error;return r.data};
(async()=>{
 const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
 host();const actor=must(await db.from('profiles').select('id,empresa_id').eq('active',true).in('role',['admin','administracion']).limit(1).single());
 host();const location=must(await db.from('inventory_locations').select('id').eq('empresa_id',actor.empresa_id).eq('active',true).eq('location_type','PROJECT').limit(1).single());
 host();must(await db.from('warehouse_portal_links').insert({id,empresa_id:actor.empresa_id,location_id:location.id,token_hash:crypto.createHash('sha256').update(token).digest('hex'),token_hint:'QA-BODY',expires_at:new Date(Date.now()+3600000).toISOString(),created_by:actor.id}));
 try{
  for(const mb of [12,19]){
   const form=new FormData();form.set('action','receipt');form.set('files',new File(['%PDF-1.4\n',new Uint8Array(mb*1024*1024)],'qa.pdf',{type:'application/pdf'}));
   host();const response=await fetch('http://127.0.0.1:3018/api/warehouse-portal/'+token,{method:'POST',body:form});
   const text=await response.text();console.log(JSON.stringify({mb,status:response.status,body:text.slice(0,200)}));
   assert.equal(response.status,400,'Body must reach ordinary missing-fields validation, not truncate at proxy');
   assert.match(text,/Faltan datos/);
  }
 }finally{host();must(await db.from('warehouse_portal_links').delete().eq('id',id));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
