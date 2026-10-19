/* Actual UI; synthetic stock receipts; read-only SDK oracle. */
const {stage,main,fs,path,assert,expect,base,projectId,v,rows}=require('./purchase-live-run.cjs');
stage('warehouse-create-link','admin',async({page,state})=>{
 await page.goto(base+'/projects/'+projectId+'?tab=panol');
 await v(page.getByRole('button',{name:'QR para Depositero',exact:true})).click();
 const link=v(page.locator('a[href*="/warehouse/"]'));await expect(link).toBeVisible({timeout:30000});
 state.warehouseUrl=await link.getAttribute('href');assert.equal(new URL(state.warehouseUrl).origin,base);
});
stage('warehouse-two-receipts','external',async({page,context,db,state,artifactPrefix})=>{
 assert.ok(state.warehouseUrl);assert.equal((await context.cookies()).length,0);
 const before=await rows(db,'inventory_stock_by_project',{project_id:projectId,producto_id:state.product.id});
 const previous=await rows(db,'oc_recepciones',{order_id:state.order.id});
 await page.goto(state.warehouseUrl);
 for(const qty of [1,2]){
  const form=page.locator('form').filter({has:page.getByRole('button',{name:'Confirmar Recepción de Mercadería',exact:true})});
  await expect(form).toBeVisible({timeout:30000});
  await form.getByRole('combobox').click();await page.getByRole('option').filter({hasText:state.order.code}).click();
  await form.locator('input[type=number]').fill(String(qty));
  await form.getByLabel('Recibido por (Nombre del depositero)').fill('Depositero QA externo');
  await form.locator('input[name=remision_number]').fill('REUSABLE-QA-'+state.runId+'-'+path.basename(artifactPrefix)+'-'+qty);
  await form.locator('input[name=files]').setInputFiles(state.docs.invoice);
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/warehouse-portal/'),{timeout:15000});
  await form.getByRole('button',{name:'Confirmar Recepción de Mercadería',exact:true}).click();
  const r=await response;const result=await r.json();await fs.writeFile(artifactPrefix+'-receipt-'+qty+'.json',JSON.stringify({http:r.status(),result},null,2));
  assert.equal(r.status(),200,JSON.stringify(result));assert.equal(result.uploadIncomplete,false);
  await expect(page.getByText(/Recepción registrada con éxito/)).toBeVisible();
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('warehouse-receipt:')).length),0);
  await page.screenshot({path:artifactPrefix+'-receipt-'+qty+'.png',fullPage:true});
 }
 const all=await rows(db,'oc_recepciones',{order_id:state.order.id});const created=all.filter(x=>!previous.some(p=>p.id===x.id));assert.equal(created.length,2);assert.ok(created.every(x=>x.status==='CONFIRMED'));
 const after=await rows(db,'inventory_stock_by_project',{project_id:projectId,producto_id:state.product.id});
 const sum=rs=>rs.reduce((a,x)=>a+Number(x.quantity??x.stock??0),0);assert.equal(sum(after)-sum(before),3);
 const evidence=[];for(const r of created)evidence.push(...await rows(db,'inventory_receipt_evidence',{receipt_id:r.id}));assert.equal(evidence.length,2);
 await fs.writeFile(artifactPrefix+'-database.json',JSON.stringify({before,after,created,evidence},null,2));
});
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
