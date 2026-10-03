const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('../batch-04-prebid-workspace/.env.preview-private.json','utf8'));
assert.equal(new URL(cfg.POSTGRES_URL_NON_POOLING).hostname,'db.xddlzgjwufskgasomval.supabase.co');
const connect=async()=>{const c=new Client({connectionString:cfg.POSTGRES_URL_NON_POOLING,ssl:{rejectUnauthorized:false}});await c.connect();return c;};
const claims=(c,actor,role)=>c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub:actor.id})]);
async function main(){const c=await connect();try{
await c.query('BEGIN');const actor=(await c.query("select p.id,p.empresa_id from public.profiles p join public.empresas e on e.id=p.empresa_id where p.active and p.role='admin' and e.active and e.plan in('pro','caterpillar') limit 1")).rows[0];assert.ok(actor);
await claims(c,actor,'authenticated');const tag='B06-'+crypto.randomUUID();const tender=(await c.query('insert into public.licitaciones(empresa_id,dncp_nro,ocid,titulo) values($1,$2,$2,$2) returning id',[actor.empresa_id,tag])).rows[0].id;
await c.query('insert into public.licitacion_ofertas(licitacion_id,empresa_id,created_by) values($1,$2,$3)',[tender,actor.empresa_id,actor.id]);
const budget=(await c.query("insert into public.budget_items(tender_id,code,description,unit,quantity) values($1,'1',$2,'un',10) returning id",[tender,tag])).rows[0].id;
await c.query('insert into public.budget_item_subcontracts(empresa_id,tender_id,budget_item_id,descripcion,precio_por_unidad) values($1,$2,$3,$4,10)',[actor.empresa_id,tender,budget,tag]);
const hash=(await c.query('select public.prebid_workspace($1) as w',[tender])).rows[0].w.hash;
await claims(c,actor,'service_role');await c.query('select public.prebid_commit_version($1,$2,$3,true,$4,100)',[tender,actor.id,actor.empresa_id,hash]);
await claims(c,actor,'authenticated');await c.query("select public.prebid_record_outcome($1,'GANADA',150)",[tender]);await c.query('COMMIT');
const handoff=async()=>{const d=await connect();try{await d.query('BEGIN');await claims(d,actor,'authenticated');await d.query('SET LOCAL ROLE authenticated');const r=(await d.query('select public.prebid_create_project($1,true) as r',[tender])).rows[0].r;await d.query('COMMIT');return r;}catch(e){await d.query('ROLLBACK');throw e;}finally{await d.end();}};
const [a,b]=await Promise.all([handoff(),handoff()]);assert.equal(a.project_id,b.project_id);assert.equal(Number((await c.query('select count(*) c from public.projects where source_tender_id=$1',[tender])).rows[0].c),1);
assert.equal(Number((await c.query('select count(*) c from public.project_contract_baselines where tender_id=$1',[tender])).rows[0].c),1);
console.log(JSON.stringify({concurrentHandoff:'PASS',projectsCreated:1,baselinesCreated:1,fixturePolicy:'isolated B06 synthetic fixture retained only in Preview'}));
} catch(e){await c.query('ROLLBACK');throw e;} finally{await c.end();}}
main().catch(e=>{console.error(e.message);process.exit(1);});
