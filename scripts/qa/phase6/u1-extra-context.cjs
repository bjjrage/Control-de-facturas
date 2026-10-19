const {db,must,session,action,fs,path,root,assert}=require('./context.cjs');
const out=path.join(root,'audit-evidence/c06-u1-2026-10-19'),target=path.join(out,'u1-private-context.json');
(async()=>{
 const c=JSON.parse(fs.readFileSync(target,'utf8'));
 const empresa='f775a9e6-30a6-4156-98f7-bfed0e8d87da',project='32e0b221-47d3-45eb-9729-e6a1d97c3374';
 const s=await session();
 const tender=must(await db.from('licitaciones').select('id').eq('empresa_id',empresa).limit(1).single());
 const supplier=must(await db.from('procurement_suppliers').select('ruc_clean').not('ruc_clean','is',null).limit(1).single());
 const resident=must(await db.from('projects').select('execution_token').eq('id',project).eq('empresa_id',empresa).single());
 Object.assign(c,{tenderId:tender.id,competitorRuc:supplier.ruc_clean,resident:'/avance/'+resident.execution_token,planillaId:'5d30b59b-7570-4717-8b05-a42cc57c8664'});
 fs.writeFileSync(target,JSON.stringify(c,null,2));
 if(process.argv.includes('--read-only')){console.log(JSON.stringify({tenderId:c.tenderId,hasCompetitor:!!c.competitorRuc,hasResident:!!resident.execution_token}));return;}
 if(!c.auctionRoomId){
  const r=await action(s,'/licitaciones/auction-lab','createSandboxRoom',[{title:'QA U1 - revisión visual sin pujas',scope:'TOTAL',group_id:'QA-U1',opening_price_pyg:10000,normal_duration_seconds:60,random_min_seconds:0,random_max_seconds:0,minimum_decrement_pyg:100}]);
  assert.ok(!r.data.error,JSON.stringify(r.data));assert.ok(r.data.roomId);
  Object.assign(c,{auctionRoomId:r.data.roomId,join:'/auction-lab/join/'+r.data.competitorToken,watch:'/auction-lab/watch/'+r.data.observerToken});
  fs.writeFileSync(target,JSON.stringify(c,null,2));
 }
 let contract=must(await db.from('subcontractor_contracts').select('id,public_token').eq('project_id',project).eq('description','QA U1 - portal visual, no fiscal').limit(1).maybeSingle());
 if(!contract){
  const fd=new FormData();for(const[k,v]of Object.entries({new_subcontractor_name:'QA U1 subcontratista no fiscal',contracted_amount:'10000',retention_pct:'0',description:'QA U1 - portal visual, no fiscal'}))fd.set(k,v);
  const r=await action(s,'/projects/'+project+'?tab=subcontratistas','addSubcontractorContract',[project,fd]);assert.equal(r.data.error,null,JSON.stringify(r.data));
  contract=must(await db.from('subcontractor_contracts').select('id,public_token').eq('project_id',project).eq('description','QA U1 - portal visual, no fiscal').single());
 }
 c.publicCertificate='/certificados/'+contract.public_token;c.contractId=contract.id;
 fs.writeFileSync(target,JSON.stringify(c,null,2));
 console.log(JSON.stringify({tenderId:c.tenderId,auctionRoomId:c.auctionRoomId,contractId:c.contractId,validResident:!!resident.execution_token,prepared:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
