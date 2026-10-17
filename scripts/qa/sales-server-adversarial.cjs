/* Crafted real Server Action request against isolated preview. No business
 * SDK/SQL writes. The authenticated cookie remains inside the browser context.
 */
const {stage,fs,path,root,base,companyId,v,one,rows,assert}=require('./purchase-live-run.cjs');
const {start}=require('./sales-live-run.cjs');
stage('sales-credit-server-guard','admin',async({page,db,state,artifactPrefix})=>{
 const before=await rows(db,'sales_receipts',{sales_document_id:state.salesCredit.id});
 const cashBefore=await one(db,'cuentas_financieras',{id:state.treasury.id});
 await page.goto(base+'/ventas/'+state.salesCredit.id);
 const manifest=JSON.parse(await fs.readFile(path.join(root,'.next/server/server-reference-manifest.json'),'utf8'));
 const ids=Object.entries(manifest.node).filter(([,e])=>e.exportedName==='addReceipt').map(([id])=>id);assert.equal(ids.length,1);
 const result=await page.evaluate(async({actionId,docId,accountId})=>{
   const body=new FormData();body.set('0',JSON.stringify([docId,'$K1']));
   body.set('1_amount','10000');body.set('1_cuenta_id',accountId);body.set('1_method','EFECTIVO');body.set('1_receipt_date','2026-10-17');body.set('1_reference','QA-NC-SERVER-REJECT');
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
   try{
     const response=await fetch(location.pathname,{method:'POST',headers:{'Next-Action':actionId},body,signal:controller.signal});
     const reader=response.body.getReader();const decoder=new TextDecoder();let text='';
     while(true){const chunk=await reader.read();if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});if(text.includes('no admite cobros positivos')){await reader.cancel();break;}}
     return {status:response.status,actionRejected:text.includes('no admite cobros positivos'),response:text.slice(0,8000)};
   }finally{clearTimeout(timer);}
 },{actionId:ids[0],docId:state.salesCredit.id,accountId:state.treasury.id});
 const after=await rows(db,'sales_receipts',{sales_document_id:state.salesCredit.id});const cashAfter=await one(db,'cuentas_financieras',{id:state.treasury.id});
 await fs.writeFile(artifactPrefix+'-database.json',JSON.stringify({result,before,after,cashBefore,cashAfter},null,2));
 assert.equal(result.status,200);assert.equal(result.actionRejected,true,'The actual server action must reject a crafted NC collection, independently of the hidden UI button');
 assert.deepEqual(after,before);assert.equal(Number(cashAfter.saldo),Number(cashBefore.saldo));
});
(async()=>{assert.ok(process.env.QA_SALES_RUN_DIR);await fs.copyFile(__filename,path.join(process.env.QA_SALES_RUN_DIR,'server-adversarial-executed-'+Date.now()+'.cjs'));process.argv=[process.argv[0],__filename,'sales-credit-server-guard'];await start();})().catch(e=>{console.error(e.stack);process.exitCode=1;});
