/* Real extraction-only regression. Does not submit or persist an invoice. */
const {stage,main,fs,path,assert,expect,base,projectId,v,rows}=require('./purchase-live-run.cjs');
stage('invoice-read-decimals-only','admin',async({page,db,state,artifactPrefix})=>{
 const before=await rows(db,'invoices',{provider_id:state.provider.id});
 await page.goto(base+'/projects/'+projectId+'/orders/'+state.order.id);
 await v(page.getByRole('button',{name:'Cargar factura',exact:true})).click();
 const d=page.getByRole('dialog');await d.locator('input[type=file]').setInputFiles(state.docs.invoice);
 await expect(d.getByLabel('N° de factura',{exact:true})).toHaveValue(state.invoiceNumber,{timeout:100000});
 const values=await d.locator('form').evaluate(form=>Object.fromEntries(Array.from(new FormData(form)).filter(([k])=>k!=='file'&&k!=='extraction_proof')));
 assert.equal(Number(values.subtotal),454545.45);assert.equal(Number(values.vat),45454.55);assert.equal(Number(values.total),500000);
 await page.screenshot({path:artifactPrefix+'-decimals.png',fullPage:true});
 await d.getByRole('button',{name:'Cancelar',exact:true}).click();
 const after=await rows(db,'invoices',{provider_id:state.provider.id});assert.deepEqual(after,before);
 await fs.writeFile(artifactPrefix+'-readback.json',JSON.stringify({values,invoiceCountBefore:before.length,invoiceCountAfter:after.length,submitted:false},null,2));
});
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
