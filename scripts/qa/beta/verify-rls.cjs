const {createRequire}=require('node:module'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=process.cwd(),req=createRequire(root+'/package.json');
req('@next/env').loadEnvConfig(root,false);
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,'kyiihlkncatojvlasoag.supabase.co');
const {createClient}=req('@supabase/supabase-js');
const users=JSON.parse(fs.readFileSync(root+'/.qa/users.json','utf8'));
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const client=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,opts);
(async()=>{const report={project:'kyiihlkncatojvlasoag',checks:[],status:'RUNNING'};
 const clients={anon:client()};for(const role of ['admin_a','administracion_a','comercial_a','admin_b']){const c=client();const r=await c.auth.signInWithPassword({email:users[role].email,password:process.env.E2E_PASSWORD});assert.equal(r.error,null,'QA login '+role);clients[role]=c;}
 for(const table of ['cuentas_financieras','movimientos_tesoreria','gastos_recurrentes']){
   const counts={};for(const [role,c]of Object.entries(clients)){const r=await c.from(table).select('id',{count:'exact',head:true}).eq('empresa_id',users.admin_a.empresa_id);assert.equal(r.error,null,role+' '+table);counts[role]=r.count;}
   assert.ok(counts.admin_a>0,table+' existing QA data');assert.equal(counts.administracion_a,counts.admin_a);for(const role of ['comercial_a','admin_b','anon'])assert.equal(counts[role],0,table+' denied '+role);
   report.checks.push({table,...counts});
 }
 report.cashflow=[];for(const [role,c] of Object.entries(clients)){
   const r=await c.rpc('cashflow_read_sources',{p_from:'2026-10-01',p_until:'2026-10-31'});
   if(role==='comercial_a'||role==='anon'){assert.equal(r.error?.code,'42501',role+' cashflow denied');report.cashflow.push({role,denied:true,code:r.error.code});}
   else {assert.equal(r.error,null,role+' cashflow');assert.equal(r.data.empresa_id,users[role].empresa_id);report.cashflow.push({role,allowed:true,ownTenant:true});}
 }
 report.status='PASS';const out=process.env.BETA_EVAL_OUTPUT_DIR||root+'/.qa/beta-rls';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/rls-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
