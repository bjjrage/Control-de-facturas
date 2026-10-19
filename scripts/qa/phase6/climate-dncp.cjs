const {db,must,session,action,save,assert,fs,path,out}=require('./context.cjs');
const control=(route,body)=>fetch('http://localhost:4018'+route,{method:'POST',body:JSON.stringify(body)});
(async()=>{
 const s=await session(),fixture=JSON.parse(fs.readFileSync(path.join(out,'api-fixture.json'),'utf8'));
 const results=[];
 async function check(name,fn){try{results.push({name,status:'PASS',detail:await fn()});console.log('PASS',name)}catch(e){results.push({name,status:'FAIL',error:e.stack});console.log('FAIL',name,e.message)}save('climate-dncp',results)}
 await check('#26 real concurrent confirmation after weather snapshot',async()=>{
  must(await s.auth.from('projects').update({latitude:-25.28,longitude:-57.64,start_date:'2026-10-01',weather_tracking_enabled:true,weather_source:'dmh-dinac'}).eq('id',fixture.projectId));
  const event=must(await db.from('climate_events').upsert({empresa_id:'f775a9e6-30a6-4156-98f7-bfed0e8d87da',project_id:fixture.projectId,event_date:'2026-10-19',source:'dmh-dinac',external_precipitation_mm:0,contract_threshold_mm:15,status:'PROPOSED'},{onConflict:'project_id,event_date'}).select('id,status').single());
  await control('/rules',[{match:'^GET /rest/v1/climate_events',kind:'hold'}]);
  const pending=action(s,'/projects/'+fixture.projectId,'evaluateProjectWeatherDayAction',[fixture.projectId,'2026-10-19']);
  let held=false;
  try{
   for(let i=0;i<90;i++){const c=await fetch('http://localhost:4018').then(r=>r.json());if(c.events.some(e=>e.kind==='hold'&&e.waiting)){held=true;break}await new Promise(r=>setTimeout(r,500))}
   assert.ok(held,'Weather action never reached the real event snapshot');
   must(await s.auth.from('climate_events').update({status:'CONFIRMED'}).eq('id',event.id));
  }finally{await control('/release',{});await control('/rules',[])}
  const response=await pending;const after=must(await db.from('climate_events').select('id,status,external_precipitation_mm').eq('id',event.id).single());assert.equal(response.data.error,null,JSON.stringify(response));assert.equal(after.status,'CONFIRMED');return{snapshot:event,concurrent:'authenticated UPDATE status=CONFIRMED while original GET response was held',response,after};
 });
 for(const[kind,match]of[['delete','^DELETE /rest/v1/licitacion_items'],['insert','^POST /rest/v1/licitacion_items']])await check('#39 DNCP '+kind+' failure reports incomplete import',async()=>{
  await control('/rules',[{match,kind:'fail',code:'23514'}]);
  const r=await action(s,'/licitaciones','importarLicitacion',['391731']);
  await control('/rules',[]);assert.match(r.data.error,/incompleta/);return r;
 });
 save('instrumentation-events',await fetch('http://localhost:4018').then(r=>r.json()));
 process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});
