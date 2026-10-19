const {db,must,session,request,save}=require('./context.cjs');
(async()=>{
 const s=await session(); const data={};
 for(const table of ['projects','providers','authorized_orders','authorized_order_items','invoice_jobs','planillas','workbook_import_sessions','climate_events','project_workday_status','apu_templates','labor_payments','licitaciones']) {
  const r=await db.from(table).select('*').limit(3); data[table]=r.error?{error:r.error.message}:r.data;
 }
 data.buckets=must(await db.storage.listBuckets());
 save('inventory-private',data);
 console.log(JSON.stringify(Object.fromEntries(Object.entries(data).map(([k,v])=>[k,Array.isArray(v)?v.map(x=>({id:x.id,name:x.name||x.nombre||x.file_name,status:x.status||x.estado,project_id:x.project_id})):v])),null,2));
 for (const date of ['2026-10-20','2026-02-30','not-a-date','2026-10-19']) {
  const r=await fetch('http://localhost:4019/cron?date='+date+'&project_id=00000000-0000-0000-0000-000000000000');
  const b=await r.json(); console.log('CRON',r.status,b); (data.cron??=[]).push({date,status:r.status,body:b});
 }
 save('cron-http',data.cron);
 const r=await request(s,'/api/planillas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modulo:'computo_presupuesto',contexto:{projectId:'86b8a8d7-0b15-4e30-b623-c1d3cfe260f8'}})});
 console.log('PLANILLA',r.status,await r.json());
})().catch(e=>{console.error(e);process.exitCode=1});
