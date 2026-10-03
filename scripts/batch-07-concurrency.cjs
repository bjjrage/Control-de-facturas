const fs=require('fs'),assert=require('node:assert/strict'),crypto=require('crypto'),{Client}=require('pg');
const cfg=JSON.parse(fs.readFileSync('../batch-04-prebid-workspace/.env.preview-private.json','utf8'));assert.equal(new URL(cfg.POSTGRES_URL_NON_POOLING).hostname,'db.xddlzgjwufskgasomval.supabase.co');
const connect=async()=>{const c=new Client({connectionString:cfg.POSTGRES_URL_NON_POOLING,ssl:{rejectUnauthorized:false}});await c.connect();return c;};
const claim=async(c,actor)=>{await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:actor})]);await c.query('SET LOCAL ROLE authenticated');};
async function main(){const c=await connect();try{
 await c.query('BEGIN');const company=crypto.randomUUID(),actor=crypto.randomUUID(),project=crypto.randomUUID(),model=crypto.randomUUID(),group=crypto.randomUUID();const tag='B07-'+crypto.randomUUID();
 await c.query("insert into public.empresas(id,nombre,plan) values($1,$2,'caterpillar')",[company,tag]);
 await c.query('insert into auth.users(id,email) values($1,$2)',[actor,tag+'@example.invalid']);
 await c.query("insert into public.profiles(id,email,full_name,role,empresa_id) values($1,$2,$3,'admin',$4) on conflict(id) do update set empresa_id=excluded.empresa_id,role='admin'",[actor,tag+'@example.invalid',tag,company]);
 await c.query('insert into public.projects(id,empresa_id,name,code,start_date) values($1,$2,$3,$3,current_date)',[project,company,tag]);
 await c.query("insert into public.bim_models(id,project_id,file_name,storage_path,status,element_count) values($1,$2,'concurrency.ifc',$3,'LISTO',1)",[model,project,project+'/concurrency.ifc']);
 await c.query("insert into public.bim_element_groups(id,bim_model_id,project_id,ifc_type,normalized_name,quantity_unit,total_quantity,element_count) values($1,$2,$3,'IfcWall','Concurrency wall','m2',999,1)",[group,model,project]);
 const el=(await c.query("insert into public.bim_elements(bim_model_id,project_id,group_id,ifc_guid,ifc_type,express_id,quantity_value,quantity_unit,quantity_source) values($1,$2,$3,'concurrency-wall','IfcWall',1,4,'m2','IFC_QTO') returning id",[model,project,group])).rows[0].id;
 await c.query('COMMIT');
 const call=async(fn,args)=>{const d=await connect();try{await d.query('BEGIN');await claim(d,actor);const r=(await d.query(fn,args)).rows;await d.query('COMMIT');return {ok:true,rows:r};}catch(e){await d.query('ROLLBACK');return {ok:false,code:e.code};}finally{await d.end();}};
 const args=[project,JSON.stringify([{id:group,code:'1'}])];const results=await Promise.all([call('select public.execution_create_bim_partidas($1,$2) n',args),call('select public.execution_create_bim_partidas($1,$2) n',args)]);
 assert.ok(results.every(x=>x.ok));assert.equal(results.reduce((sum,x)=>sum+x.rows[0].n,0),1);
 const budgets=(await c.query('select id,updated_at::text as updated_at,quantity from public.budget_items where project_id=$1',[project])).rows;assert.equal(budgets.length,1);assert.equal(Number(budgets[0].quantity),4);
 const casArgs=[JSON.stringify({kind:'PROJECT',id:project}),budgets[0].id,[el],budgets[0].updated_at,4];
 const cas=await Promise.all([call('select public.workspace_apply_bim_quantity($1,$2,$3,$4,$5)',casArgs),call('select public.workspace_apply_bim_quantity($1,$2,$3,$4,$5)',casArgs)]);
 assert.equal(cas.filter(x=>x.ok).length,1);assert.equal(cas.filter(x=>!x.ok&&x.code==='P0409').length,1);
 console.log(JSON.stringify({concurrentBimCreation:'PASS',budgetLinesCreated:1,factualQuantity:4,concurrentCAS:'PASS',staleWriteRejected:true,fixturePolicy:'isolated B07 synthetic fixture retained only in Preview'}));
 }finally{await c.query('ROLLBACK');await c.end();}}
main().catch(e=>{console.error(e.message);process.exit(1)});
