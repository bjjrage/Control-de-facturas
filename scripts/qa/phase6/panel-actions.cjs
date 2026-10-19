const {db,must,session,action,save,assert,fs,path,out}=require('./context.cjs');
const control=body=>fetch('http://localhost:4018/rules',{method:'POST',body:JSON.stringify(body)});
(async()=>{
 const s=await session(),results=[];const route='/projects/86b8a8d7-0b15-4e30-b623-c1d3cfe260f8';
 for(const [name,match,args] of [['listApuTemplatesAction','^GET /rest/v1/apu_templates',[]],['listLaborPaymentsAction','^GET /rest/v1/labor_payments.*crew_name',['86b8a8d7-0b15-4e30-b623-c1d3cfe260f8']]]){
  await control([{match,kind:'fail',code:'23514'}]);const r=await action(s,route,name,args);assert.ok(r.data.error);results.push({name,response:r});
 }
 const template=JSON.parse(fs.readFileSync(path.join(out,'apu-fixture.json'),'utf8'));
 await control([{match:'^DELETE /rest/v1/apu_templates',kind:'fail',code:'23514'}]);
 const r=await action(s,route,'deleteApuTemplateAction',[template.id]);assert.ok(r.data.error);assert.equal(r.data.success,false);
 const retained=must(await db.from('apu_templates').select('id').eq('id',template.id).single());results.push({name:'deleteApuTemplateAction',response:r,retained});
 await control([]);save('panel-action-errors',results);console.log('PASS #35 real HTTP list/list/delete errors; rejected delete preserves template. UI screenshots cover both list error states.');
})().catch(e=>{console.error(e);process.exitCode=1});
