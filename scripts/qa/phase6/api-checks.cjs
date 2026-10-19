const {db,must,session,request,action,save,assert,fs,path,out}=require('./context.cjs');
const {randomUUID}=require('node:crypto');
const XLSX=require('xlsx');
const results=[];
async function check(name,fn){try{const detail=await fn();results.push({name,status:'PASS',detail});console.log('PASS',name,detail)}catch(e){results.push({name,status:'FAIL',error:e.stack});console.log('FAIL',name,e.message)}save('api-checks',results)}
const controls=(route,body)=>fetch('http://localhost:4018'+route,{method:'POST',body:JSON.stringify(body)});
(async()=>{
 const s=await session();const empresaId='f775a9e6-30a6-4156-98f7-bfed0e8d87da';
 let fixture;
 const stateFile=path.join(out,'api-fixture.json');
 if(fs.existsSync(stateFile))fixture=JSON.parse(fs.readFileSync(stateFile,'utf8'));else{
  const existing=must(await s.auth.from('projects').select('id').like('code','QA-PHASE6-%').order('created_at',{ascending:false}).limit(1));
  const project=existing[0] || must(await s.auth.from('projects').insert({empresa_id:empresaId,code:'QA-PHASE6-'+Date.now(),name:'QA fase 6 - no fiscal',status:'ACTIVO',contract_regime:'PRIVATE_WORK'}).select('*').single());
  const budget=must(await s.auth.from('budget_items').insert({project_id:project.id,code:'QA1',description:'Unidad QA',unit:'un',quantity:10,unit_price:10000,sort_order:0}).select('id').single());
  fixture={projectId:project.id,budgetId:budget.id};save('api-fixture',fixture);
 }
 const route='/projects/'+fixture.projectId;
 await check('#32 APU invalid writes nothing',async()=>{
  const before=(await db.from('apu_templates').select('id',{count:'exact',head:true})).count;
  const r=await action(s,route,'importApuPlanillaAction',[{recipes:[{name:'APU QA INVALID',lines:[{tipo:'MATERIAL',descripcion:'Material inválido QA',cantidad:-1,precioUnitario:100,unidad:'un'}]}],createMissingProducts:true}]);
  assert.ok(r.data.error);assert.equal((await db.from('apu_templates').select('id',{count:'exact',head:true})).count,before);return r;
 });
 await check('#32 invalid certificate workbook writes nothing',async()=>{
  const before=(await db.from('project_certificates').select('id',{count:'exact',head:true})).count;
  const invalid=require('./certificate-fixture.cjs')();
  const fd=new FormData();fd.set('file',new File([invalid.bytes],'invalid-values.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));fd.set('plan_json',JSON.stringify(invalid.plan));fd.set('mappings_json',JSON.stringify([{sourceRow:4,budgetItemId:fixture.budgetId}]));
  const r=await action(s,route,'importCertificateWorkbook',[fixture.projectId,fd]);assert.match(r.data.error,/fila 4.*incompletos o ambiguos/i);assert.equal((await db.from('project_certificates').select('id',{count:'exact',head:true})).count,before);return r;
 });
 if(!fixture.certificateId){const fd=new FormData();fd.set('period_start','2026-10-01');fd.set('period_end','2026-10-19');const r=await action(s,route,'createCertificate',[fixture.projectId,fd]);assert.ok(r.data.id,JSON.stringify(r));fixture.certificateId=r.data.id;
  const unit=await action(s,route,'createProjectUnit',[fixture.projectId,'Unidad QA fase 6']);assert.ok(unit.data.id,JSON.stringify(unit));fixture.unitId=unit.data.id;save('api-fixture',fixture);
 }
 await check('#33 failed unit progress write is reported',async()=>{
  await controls('/rules',[{match:'^POST /rest/v1/project_certificate_unit_progress',kind:'fail',code:'23514'}]);
  const r=await action(s,route,'upsertCertificateUnitProgress',[fixture.certificateId,[{unit_id:fixture.unitId,pct_avance:25}]]);
  assert.ok(r.data.error,'Server returned success after the database rejected the write: '+JSON.stringify(r));return r;
 });
 await controls('/rules',[]);
 await check('#33 invalid unit group saves no partial progress',async()=>{
  const before=must(await db.from('project_certificate_unit_progress').select('unit_id,pct_avance').eq('certificate_id',fixture.certificateId));
  const r=await action(s,route,'upsertCertificateUnitProgress',[fixture.certificateId,[{unit_id:fixture.unitId,pct_avance:25},{unit_id:randomUUID(),pct_avance:50}]]);
  const after=must(await db.from('project_certificate_unit_progress').select('unit_id,pct_avance').eq('certificate_id',fixture.certificateId));
  assert.ok(r.data.error);assert.deepEqual(after,before);return{response:r,before,after};
 });
 await check('#27 midnight Paraguay boundaries and invalid days',async()=>{
  const data=[];
  try{for(const [at,query,expected,date]of[
   ['2026-10-20T02:59:59Z','',200,'2026-10-19'],['2026-10-20T03:00:00Z','',200,'2026-10-20'],
   ['2026-10-20T02:59:59Z','&date=2026-10-20',400,null],['2026-10-20T03:00:00Z','&date=2026-02-30',400,null],['2026-10-20T03:00:00Z','&date=invalid',400,null]]){
    await controls('/clock',{at});const r=await request(s,'/api/cron/climate-evaluation?project_id=00000000-0000-0000-0000-000000000000'+query,{headers:{authorization:'Bearer isolated-audit-clock-fixture'}});const body=await r.json();data.push({at,query,status:r.status,body});assert.equal(r.status,expected);if(date)assert.equal(body.date,date);
  }}finally{await controls('/clock',{})}return data;
 });
 await check('#34 create workbook import session',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Código','Descripción','Unidad','Cantidad','Precio'],['QA1','Rubro QA','un',10,10000]]),'Presupuesto');
  const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});const fd=new FormData();fd.set('file',new File([bytes],'qa-fase6.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const r=await request(s,'/api/import-sessions',{method:'POST',body:fd});const body=await r.json();save('session-create',{status:r.status,body});assert.ok(body.sessionId,JSON.stringify(body));fixture.importSessionId=body.sessionId;save('api-fixture',fixture);return {status:r.status,body};
 });
 if(fixture.importSessionId)await check('#34 failed discard keeps session, retry discards it',async()=>{
  await controls('/rules',[{match:'^PATCH /rest/v1/workbook_import_sessions',kind:'fail',once:false}]);
  const r=await action(s,'/projects','discardImportSession',[fixture.importSessionId]);assert.ok(r.data.error);
  const first=must(await db.from('workbook_import_sessions').select('status').eq('id',fixture.importSessionId).single());assert.notEqual(first.status,'DISCARDED');
  await controls('/rules',[]);const retry=await action(s,'/projects','discardImportSession',[fixture.importSessionId]);assert.equal(retry.data.error,null);const after=must(await db.from('workbook_import_sessions').select('status').eq('id',fixture.importSessionId).single());assert.equal(after.status,'DISCARDED');return {failure:r,first,retry,after};
 });
 await check('planilla uncertain result preserves session',async()=>{
  const r=await request(s,'/api/planillas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modulo:'computo_presupuesto',contexto:{projectId:fixture.projectId}})});const p=await r.json();assert.equal(r.status,201);fixture.planillaId=p.id;save('api-fixture',fixture);
  await controls('/rules',[{match:'^POST /rest/v1/rpc/planilla_confirmar_computo',kind:'lost'}]);
  const first=await request(s,'/api/planillas/'+p.id+'/confirmar',{method:'POST'});const body=await first.json();assert.equal(first.status,503,JSON.stringify(body));
  const persisted=must(await db.from('planillas').select('id,estado').eq('id',p.id).single());
  const retry=await request(s,'/api/planillas/'+p.id+'/confirmar',{method:'POST'});assert.equal(retry.status,200);return {status:first.status,body,persisted,retry:await retry.json()};
 });
 await controls('/rules',[]);process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});
