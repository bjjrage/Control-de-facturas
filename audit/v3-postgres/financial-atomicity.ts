import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
const url=process.env.TEST_DATABASE_URL;
if(!url || !["127.0.0.1","localhost","::1"].includes(new URL(url).hostname)) throw Error("Nonlocal database refused");
const open=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query("SET statement_timeout='15s';SET lock_timeout='8s'");return c};
const session=async(fn)=>{const c=await open();try{return await fn(c)}finally{await c.end()}};
const actor=async(c,user,fn)=>{await c.query("SET ROLE authenticated");await c.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[user]);try{return await fn()}finally{await c.query("RESET ROLE");await c.query("RESET request.jwt.claim.sub");await c.query("RESET request.jwt.claim.role")}};
const service=async(c,fn)=>{await c.query("SET ROLE service_role");await c.query("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");try{return await fn()}finally{await c.query("RESET ROLE");await c.query("RESET request.jwt.claim.sub");await c.query("RESET request.jwt.claim.role")}};
async function expectSqlFailure(fn,codes){try{await fn()}catch(e){assert.ok(codes.includes(e.code),"Expected SQLSTATE "+codes+" but received "+String(e));return e.code}throw Error("Expected database rejection, but operation succeeded")}
async function main(){
const pg=await session(async c=>(await c.query("SELECT current_setting('server_version_num') AS v")).rows[0].v);
assert.ok(+pg>=170000 && +pg<180000,"PostgreSQL 17 required");
const id=randomUUID,company=id(),user=id(),provider=id();
const opOrder=id(),existingOrder=id(),deleteOrder=id();
const payInvoice=id(),createInvoice=id(),deleteInvoice=id(),auditRow=id();
await session(async c=>{
await c.query("BEGIN");
try{
await c.query("INSERT INTO public.empresas(id,nombre,slug) VALUES($1,'V3 audit',$2)",[company,"v3-"+company]);
await c.query("INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,'{}'::jsonb)",[user,user+"@v3.test"]);
await c.query("INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES($1,$2,'V3 admin','admin',$3)",[user,user+"@v3.test",company]);
await c.query("INSERT INTO public.providers(id,empresa_id,name) VALUES($1,$2,'V3 supplier')",[provider,company]);
for(const [o,code,product] of [[opOrder,"V3-PAY","Arena"],[existingOrder,"V3-EXIST","Acero"],[deleteOrder,"V3-DEL","Cemento"]]){
await c.query("INSERT INTO public.authorized_orders(id,provider_id,code,provider_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,empresa_id,created_from) VALUES($1,$2,$3,'V3 supplier',$4,10,'un',100,1000,'PYG',false,$5,false,$6,'invoice')",[o,provider,code,product,user,company])
}
await c.query("INSERT INTO public.invoices(id,provider_id,invoice_number,invoice_date,currency,total,created_by,empresa_id,status) VALUES($1,$4,'V3-PAID',CURRENT_DATE,'PYG',1000,$5,$6,'MATCH'),($2,$4,'V3-CREATE',CURRENT_DATE,'PYG',1000,$5,$6,'PENDIENTE'),($3,$4,'V3-DEL',CURRENT_DATE,'PYG',1000,$5,$6,'PENDIENTE')",[payInvoice,createInvoice,deleteInvoice,provider,user,company]);
await c.query("INSERT INTO public.invoice_order_matches(invoice_id,authorized_order_id,empresa_id) VALUES($1,$2,$3)",[payInvoice,opOrder,company]);
await c.query("INSERT INTO public.audit_logs(id,action,authorized_order_id,actor_id,empresa_id) VALUES($1,'order.created_from_invoice',$2,$3,$4)",[auditRow,deleteOrder,user,company]);
await c.query("COMMIT")}catch(e){await c.query("ROLLBACK");throw e}
});
const checks=[];
// V3-001: first RPC commits; separate payment-order insert fails.
await session(c=>actor(c,user,()=>c.query("SELECT public.mark_invoice_apto_para_pago($1)",[payInvoice])));
const rejectOp=await session(c=>actor(c,user,()=>expectSqlFailure(()=>c.query("INSERT INTO public.payment_orders(empresa_id,code,provider_id,status,created_by) VALUES($1,'V3-FAIL',$2,'EMITIDA',$3)",[company,id(),user]),["23503","42501","23502"])));
const pay=await session(c=>c.query("SELECT status,(SELECT count(*)::int FROM public.payment_order_invoices WHERE invoice_id=$1) AS op_count FROM public.invoices WHERE id=$1",[payInvoice]));
assert.equal(pay.rows[0].status,"APTO_PARA_PAGO");assert.equal(pay.rows[0].op_count,0);
checks.push({finding:"V3-001",outcome:"REPRODUCED",sqlstate:rejectOp,invoice_status:pay.rows[0].status,linked_op:0});
// V3-004: two client sessions interleave after prior no-link check.
const a=await open(),b=await open();const orphan=id();let linkError;
try{
const before=await actor(a,user,()=>a.query("SELECT count(*)::int AS n FROM public.invoice_order_matches WHERE invoice_id=$1",[createInvoice]));assert.equal(before.rows[0].n,0);
await actor(b,user,()=>b.query("INSERT INTO public.invoice_order_matches(invoice_id,authorized_order_id,empresa_id) VALUES($1,$2,$3)",[createInvoice,existingOrder,company]));
await actor(a,user,()=>a.query("INSERT INTO public.authorized_orders(id,provider_id,code,provider_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,empresa_id,created_from) VALUES($1,$2,'V3-ORPHAN','V3 supplier','Hierro',10,'un',100,1000,'PYG',false,$3,false,$4,'invoice')",[orphan,provider,user,company]));
linkError=await actor(a,user,()=>expectSqlFailure(()=>a.query("INSERT INTO public.invoice_order_matches(invoice_id,authorized_order_id,empresa_id) VALUES($1,$2,$3)",[createInvoice,orphan,company]),["23505"]));
}finally{await Promise.allSettled([a.end(),b.end()])}
const orphanCheck=await session(c=>c.query("SELECT (SELECT count(*)::int FROM public.authorized_orders WHERE id=$1) AS orders,(SELECT count(*)::int FROM public.invoice_order_matches WHERE authorized_order_id=$1) AS links",[orphan]));
assert.equal(orphanCheck.rows[0].orders,1);assert.equal(orphanCheck.rows[0].links,0);
checks.push({finding:"V3-004",outcome:"REPRODUCED",sqlstate:linkError,orphan_orders:1});
// V3-005: concurrent link added after check makes second delete fail, but audit first deleted.
const d1=await open(),d2=await open();let deleteError;
try{
const prior=await service(d1,()=>d1.query("SELECT count(*)::int AS n FROM public.invoice_order_matches WHERE authorized_order_id=$1",[deleteOrder]));assert.equal(prior.rows[0].n,0);
await actor(d2,user,()=>d2.query("INSERT INTO public.invoice_order_matches(invoice_id,authorized_order_id,empresa_id) VALUES($1,$2,$3)",[deleteInvoice,deleteOrder,company]));
const wiped=await service(d1,()=>d1.query("DELETE FROM public.audit_logs WHERE authorized_order_id=$1 AND empresa_id=$2",[deleteOrder,company]));assert.equal(wiped.rowCount,1);
deleteError=await service(d1,()=>expectSqlFailure(()=>d1.query("DELETE FROM public.authorized_orders WHERE id=$1 AND empresa_id=$2",[deleteOrder,company]),["23503"]));
}finally{await Promise.allSettled([d1.end(),d2.end()])}
const remaining=await session(c=>c.query("SELECT (SELECT count(*)::int FROM public.authorized_orders WHERE id=$1) AS orders,(SELECT count(*)::int FROM public.audit_logs WHERE id=$2) AS audit_rows",[deleteOrder,auditRow]));
assert.deepEqual(remaining.rows[0],{orders:1,audit_rows:0});
checks.push({finding:"V3-005",outcome:"REPRODUCED",sqlstate:deleteError,order_exists:true,audit_rows_remaining:0});
console.log(JSON.stringify({test_kind:"DISPOSABLE_REAL_POSTGRESQL_INTERLEAVING",source_sha:"953ebba505b38313bd3e18e6cb9fbf31b7e1eb89",pg_version:pg,checks},null,2));
}
main().catch(e=>{console.error(JSON.stringify({error:String(e),code:e.code??null}));process.exitCode=1});
