import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Client } from "pg";

const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const statusEnv = execFileSync("supabase", ["status", "-o", "env"], {encoding:"utf8",stdio:["ignore","pipe","pipe"]});
const envKeys={};
for (const line of statusEnv.split(/\r?\n/)) {
  const m=line.match(/^\s*([A-Z_]+)=(.*)$/);
  if (m) envKeys[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");
}
const endpoint=envKeys.API_URL || "http://127.0.0.1:54321";
const url=new URL(endpoint);
assert.ok(["localhost","127.0.0.1","::1"].includes(url.hostname),"REFUSED: non-local Supabase API");
assert.ok(envKeys.ANON_KEY && envKeys.SERVICE_ROLE_KEY,"Local Supabase credentials not available from local CLI");
const anon=envKeys.ANON_KEY,service=envKeys.SERVICE_ROLE_KEY;
const result={run:"V3-PERIMETER-AND-TASK-TRANSITION",source_sha:"953ebba505b38313bd3e18e6cb9fbf31b7e1eb89",postgres:"localhost:54322",api:"localhost:54321",checks:[]};

async function sql(fn) {
 const c=new Client({connectionString:DB_URL});await c.connect();
 try {await c.query("SET statement_timeout='12s'");return await fn(c);}
 finally {await c.end();}
}
async function request(path,{method="GET",token=anon,key=anon,data}={}) {
 const response=await fetch(new URL(path,endpoint),{
  method,headers:{"apikey":key,"Authorization":"Bearer "+token,"Content-Type":"application/json","Prefer":"return=representation"},
  ...(data===undefined?{}:{body:JSON.stringify(data)}),
  signal:AbortSignal.timeout(15000)
 });
 const bodyText=await response.text();
 let payload;try{payload=bodyText?JSON.parse(bodyText):null}catch{payload={unparsed:true};}
 return {status:response.status,payload};
}
function cleanHttpError(r) {
 return {status:r.status,error_code:r.payload?.code??r.payload?.error_code??null};
}
async function makeUser(email,password) {
 const r=await request("/auth/v1/admin/users",{method:"POST",token:service,key:service,data:{email,password,email_confirm:true}});
 assert.equal(r.status,200,r.status===201?"":JSON.stringify(cleanHttpError(r)));
 return r.payload.id;
}
async function login(email,password){
 const r=await request("/auth/v1/token?grant_type=password",{method:"POST",data:{email,password}});
 assert.equal(r.status,200,"Local auth login failed "+JSON.stringify(cleanHttpError(r)));
 assert.ok(r.payload.access_token,"Local GoTrue did not issue access token");
 return r.payload.access_token;
}
async function pgActor(client,userId){
 await client.query("SET ROLE authenticated");
 await client.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[userId]);
}
async function main() {
 const companyA=randomUUID(),companyB=randomUUID(),taskId=randomUUID(),approvalId=randomUUID(),taskRace=randomUUID();
 const password=randomBytes(24).toString("base64url")+"!A1";
 const emails=[randomUUID()+"@v3.invalid",randomUUID()+"@v3.invalid",randomUUID()+"@v3.invalid"];
 await sql(c=>c.query("INSERT INTO public.empresas(id,nombre,slug) VALUES($1,'Audit A',$3),($2,'Audit B',$4)",[companyA,companyB,"v3-http-"+companyA,"v3-http-"+companyB]));
 const users=[];
 for(let i=0;i<3;i++) {
   const r=await request("/auth/v1/admin/users",{method:"POST",token:service,key:service,data:{email:emails[i],password,email_confirm:true}});
   assert.ok([200,201].includes(r.status),"Local auth admin create failed "+JSON.stringify(cleanHttpError(r)));
   assert.ok(r.payload?.id,"Created user id missing");users.push(r.payload.id);
 }
 const [adminA,adminB,administracionA]=users;
 await sql(async c=>{
   const rows=[[adminA,emails[0],"admin",companyA],[adminB,emails[1],"admin",companyB],[administracionA,emails[2],"administracion",companyA]];
   for(const [id,email,role,empresa] of rows) {
    await c.query("INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES($1,$2,'V3 HTTP synthetic',$3::public.user_role,$4) ON CONFLICT(id) DO UPDATE SET role=excluded.role,empresa_id=excluded.empresa_id,active=true",[id,email,role,empresa]);
   }
   await c.query("INSERT INTO public.agent_tasks(id,empresa_id,user_id,type,status,context_json) VALUES ($1,$3,$4,'USER_INTENT','PENDING','{}'::jsonb),($2,$3,$4,'USER_INTENT','RUNNING','{}'::jsonb)",[taskId,taskRace,companyA,adminA]);
   await c.query("INSERT INTO public.agent_approvals(id,task_id,empresa_id,tool_name,payload_json,payload_hash,risk_level,status,requested_by) VALUES($1,$2,$3,'send_email','{}'::jsonb,$4,2,'REQUESTED',$5)",[approvalId,taskId,companyA,"0".repeat(64),adminA]);
 });
 const [jwtAdminA,jwtAdminB,jwtAdministracionA]=await Promise.all(emails.map(email=>login(email,password)));
 const jwtUser=JSON.parse(Buffer.from(jwtAdministracionA.split(".")[1],"base64url").toString());
 assert.equal(jwtUser.sub,administracionA,"JWT subject mismatch");
 assert.equal(jwtUser.role,"authenticated","JWT role mismatch");
 result.checks.push({id:"LOCAL_REAL_AUTH",outcome:"PASS",mechanism:"GoTrue token endpoint returned signed JWT with expected subject/role",synthetic_subject_verified:true});

 const anonRead=await request("/rest/v1/agent_approvals?select=id&limit=1",{token:anon});
 const crossRead=await request("/rest/v1/agent_approvals?select=id,status&id=eq."+approvalId,{token:jwtAdminB});
 const crossWrite=await request("/rest/v1/agent_approvals?id=eq."+approvalId,{method:"PATCH",token:jwtAdminB,data:{status:"APPROVED",decided_by:adminB}});
 assert.equal(anonRead.status,200,"Anon SELECT unexpected "+JSON.stringify(cleanHttpError(anonRead)));
 assert.deepEqual(anonRead.payload,[],"Anon could SELECT approval!");
 assert.equal(crossRead.status,200,"Foreign tenant SELECT unexpected "+JSON.stringify(cleanHttpError(crossRead)));
 assert.deepEqual(crossRead.payload,[],"Foreign tenant could SELECT approval!");
 assert.equal(crossWrite.status,200,"Foreign tenant PATCH unexpected "+JSON.stringify(cleanHttpError(crossWrite)));
 assert.deepEqual(crossWrite.payload,[],"Foreign tenant could UPDATE approval!");
 result.checks.push({id:"POSTGREST_CROSS_TENANT",outcome:"DENIED",anon_visible:0,other_tenant_visible:0,other_tenant_updated:0});

 const ownRead=await request("/rest/v1/agent_approvals?select=id,status,tool_name&id=eq."+approvalId,{token:jwtAdministracionA});
 assert.equal(ownRead.status,200,"Own tenant role read status "+JSON.stringify(cleanHttpError(ownRead)));
 assert.equal(ownRead.payload?.length,1,"Same tenant could not read approval");
 assert.equal(ownRead.payload[0].tool_name,"send_email");
 const approve=await request("/rest/v1/agent_approvals?id=eq."+approvalId,{method:"PATCH",token:jwtAdministracionA,data:{status:"APPROVED",decided_by:administracionA,decided_at:new Date().toISOString()}});
 const afterApprove=await sql(c=>c.query("SELECT status,decided_by FROM public.agent_approvals WHERE id=$1",[approvalId]));
 const approved=afterApprove.rows[0].status==="APPROVED" && afterApprove.rows[0].decided_by===administracionA;
 result.checks.push({id:"POSTGREST_ROLE_RESTRICTED_APPROVAL",outcome:approved?"BYPASS_REPRODUCED":"DENIED_OR_INCOMPLETE",http_status:approve.status,affected_rows:Array.isArray(approve.payload)?approve.payload.length:null,persisted_approved:approved});
 const terminal=await request("/rest/v1/agent_approvals?id=eq."+approvalId,{method:"PATCH",token:jwtAdministracionA,data:{status:"EXECUTED"}});
 const afterTerminal=await sql(c=>c.query("SELECT status FROM public.agent_approvals WHERE id=$1",[approvalId]));
 const executed=afterTerminal.rows[0].status==="EXECUTED";
 result.checks.push({id:"POSTGREST_TERMINAL_STATE_FORGERY",outcome:executed?"BYPASS_REPRODUCED":"DENIED_OR_INCOMPLETE",http_status:terminal.status,persisted_executed:executed,tool_handler_invoked:false});
 assert.ok(approved && executed,"The expected HTTP bypasses were not both observed; inspect evidence and protective checks");

 const a=new Client({connectionString:DB_URL}),b=new Client({connectionString:DB_URL});
 await Promise.all([a.connect(),b.connect()]);
 try{
  await Promise.all([pgActor(a,adminA),pgActor(b,adminA)]);
  const [beforeA,beforeB]=await Promise.all([a.query("SELECT status FROM public.agent_tasks WHERE id=$1",[taskRace]),b.query("SELECT status FROM public.agent_tasks WHERE id=$1",[taskRace])]);
  assert.equal(beforeA.rows[0].status,"RUNNING");assert.equal(beforeB.rows[0].status,"RUNNING");
  const cancelled=await a.query("UPDATE public.agent_tasks SET status='CANCELLED' WHERE id=$1 AND empresa_id=$2 RETURNING status",[taskRace,companyA]);
  assert.equal(cancelled.rows[0].status,"CANCELLED");
  const completed=await b.query("UPDATE public.agent_tasks SET status='COMPLETED' WHERE id=$1 AND empresa_id=$2 RETURNING status",[taskRace,companyA]);
  const final=(await b.query("SELECT status FROM public.agent_tasks WHERE id=$1",[taskRace])).rows[0].status;
  assert.equal(final,"COMPLETED","Expected test to reproduce terminal-state overwrite");
  result.checks.push({id:"V3-013_REAL_POSTGRES_RACE",outcome:"INVALID_TERMINAL_OVERWRITE_REPRODUCED",connectionA_read:"RUNNING",connectionB_read:"RUNNING",connectionA_written:"CANCELLED",connectionB_written:"COMPLETED",final_status:final,mechanism:"two independent PostgreSQL sessions"});
 }finally{await Promise.allSettled([a.end(),b.end()]);}
 const schema=await sql(c=>c.query("SELECT to_regclass('public.agent_events')::text AS events_table,to_regprocedure('public.process_agent_event(uuid,uuid,uuid)')::text AS process_event"));
 result.checks.push({id:"V3-012_SCHEMA",event_table:schema.rows[0].events_table,process_event_rpc:schema.rows[0].process_event});
 console.log(JSON.stringify(result,null,2));
 writeFileSync("../evidence-v3/v3-http-postgres-results.json",JSON.stringify(result,null,2)+"\n");
}
main().catch(e=>{
 const msg=String(e);
 console.error(JSON.stringify({category:"V3_HTTP_PG_HARNESS_FAILURE",message:msg.slice(0,450),sqlstate:e.code??null}));
 process.exitCode=1;
});
