import fs from 'node:fs';
import {setupPropagationChecks} from './workspace-propagation-checks.mjs';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {chromium} from '@playwright/test';
const mode='qa',env=parse(fs.readFileSync('.env.local'));
const origin=process.argv[2]??'https://control-de-facturas-git-main-marceloechauri-4623s-projects.vercel.app';
assert(['localhost','control-de-facturas-git-main-marceloechauri-4623s-projects.vercel.app'].includes(new URL(origin).hostname),'QA origin only');
const url=env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname,'kyiihlkncatojvlasoag.supabase.co','QA database only');
const fixture=JSON.parse(fs.readFileSync('audit-artifacts/workbook-linked-import/import-workspace-qa-fixture.json','utf8'));
const result=JSON.parse(fs.readFileSync('audit-artifacts/workbook-linked-import/import-workspace-qa-result.json','utf8'));
const projectId=result.projectId;
const jar=new Map(),db=createServerClient(url,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:values=>values.forEach(({name,value})=>jar.set(name,value))}});
const admin=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY);
const {data:link,error}=await admin.auth.admin.generateLink({type:'magiclink',email:fixture.email});if(error)throw error;
const {error:ae}=await db.auth.verifyOtp({type:'magiclink',token_hash:link.properties.hashed_token});if(ae)throw ae;
const {data:auth}=await db.auth.getUser();const {data:profile,error:pe}=await db.from('profiles').select('empresa_id,email').eq('id',auth.user.id).single();if(pe)throw pe;assert.equal(profile.empresa_id,fixture.empresaId);assert.equal(profile.email,fixture.email);
const {data:project,error:pre}=await db.from('projects').select('id,empresa_id').eq('id',projectId).single();if(pre)throw pre;assert.equal(project.empresa_id,fixture.empresaId);
async function api(path,method='GET',body){const r=await fetch(origin+path,{method,redirect:'manual',headers:{cookie:[...jar].map(([name,value])=>`${name}=${value}`).join('; '),Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};}
async function draft(){const r=await api('/api/planillas','POST',{modulo:'computo_presupuesto',contexto:{projectId}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body;}
const {data:material,error:me}=await db.from('budget_item_materials').select('id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada,desperdicio_pct,precio_unitario_origen,productos(nombre,unidad)').eq('empresa_id',fixture.empresaId).eq('project_id',projectId).in('cantidad_por_unidad_ejecutada',[1,2,0.5,0.25,0.125]).order('id').limit(1).single();if(me)throw me;
let current=await draft();const sourceRows=current.snapshot.rows, index=sourceRows.findIndex(row=>row._rowId===material.budget_item_id);assert(index>=0);
const original=structuredClone(sourceRows[index]), quantity=Number(original.quantity), nextQuantity=quantity+1, nextConsumption=material.cantidad_por_unidad_ejecutada+0.125;
assert(Number.isFinite(quantity));
const backup={mode,origin,companyId:fixture.empresaId,projectId,original,material,nextQuantity,nextConsumption};
fs.writeFileSync(`audit-artifacts/workbook-linked-import/${mode}-editing-backup.json`,JSON.stringify(backup,null,2));
let browser,page,propagation,quantityApplied=false,materialApplied=false;
const errors=[];
async function selectApu(){await page.getByRole('tab',{name:'APU',exact:true}).click();await page.getByLabel('Partida activa',{exact:true}).selectOption(material.budget_item_id);await page.getByRole('button',{name:'Editar APU',exact:true}).click();const form=page.locator(`form[data-apu-line="${material.id}"]`);await form.waitFor();return form;}
async function saveMaterial(value){const form=page.locator(`form[data-apu-line="${material.id}"]`);await form.getByRole('spinbutton',{name:/Consumo por unidad/}).fill(String(value));await form.getByRole('button',{name:'Guardar componente',exact:true}).click();await form.getByRole('status').filter({hasText:/^Guardado$/}).waitFor();const {data,error}=await db.from('budget_item_materials').select('cantidad_por_unidad_ejecutada,desperdicio_pct,precio_unitario_origen').eq('id',material.id).single();if(error)throw error;assert.equal(data.cantidad_por_unidad_ejecutada,value);assert.equal(data.desperdicio_pct,material.desperdicio_pct);assert.equal(data.precio_unitario_origen,material.precio_unitario_origen);}
async function editQuantity(value,formula){await page.getByRole('tab',{name:'Partidas',exact:true}).click();await page.getByLabel('Celda',{exact:true}).fill(`D${index+1}`);await page.getByLabel('Valor o fórmula',{exact:true}).fill(formula??String(value));await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/api/planillas/${current.id}`)&&r.request().method()==='PATCH'),page.getByRole('button',{name:'Aplicar celda',exact:true}).click()]);await page.getByText('Guardado',{exact:true}).first().waitFor();const saved=await api(`/api/planillas/${current.id}`);assert.equal(saved.body.snapshot.rows[index].quantity,value);return saved.body;}
async function confirmQuantity(value){const response=page.waitForResponse(r=>r.url().endsWith(`/api/planillas/${current.id}/confirmar`)&&r.request().method()==='POST');await page.getByRole('button',{name:'Confirmar',exact:true}).click();const r=await response;assert.equal(r.status(),200,JSON.stringify(await r.json()));const {data,error}=await db.from('budget_items').select('quantity,unit_price').eq('id',material.budget_item_id).single();if(error)throw error;assert.equal(data.quantity,value);assert.equal(data.unit_price,original.unit_price);}
try{
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1500,height:1000}});await ctx.addCookies([...jar].map(([name,value])=>({name,value,domain:new URL(origin).hostname,path:'/'})));page=await ctx.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+`/planillas/${current.id}?volver=${encodeURIComponent(`/projects/${projectId}?tab=presupuesto`)}`,{waitUntil:'networkidle',timeout:180000});
 await page.locator('[aria-label="Hoja de cómputo y presupuesto"] canvas').first().waitFor();
 propagation=await setupPropagationChecks({db,api,page,projectId,material,original,origin,errors,mode});
 await editQuantity(nextQuantity,`=${quantity}+1`);await page.reload({waitUntil:'networkidle',timeout:180000});assert.equal((await api(`/api/planillas/${current.id}`)).body.snapshot.rows[index].quantity,nextQuantity);
 quantityApplied=true;await confirmQuantity(nextQuantity);await propagation.verify(nextQuantity,material.cantidad_por_unidad_ejecutada);
 const parallel=await Promise.all([draft(),draft()]);assert.equal(parallel[0].id,parallel[1].id);current=parallel[0];assert.equal(current.snapshot.rows[index].quantity,nextQuantity);await page.goto(origin+`/planillas/${current.id}`,{waitUntil:'networkidle',timeout:180000});
 await selectApu();materialApplied=true;await saveMaterial(nextConsumption);await propagation.verify(nextQuantity,nextConsumption,{ui:true});
 const expected=nextQuantity*nextConsumption*(1+material.desperdicio_pct/100);
 const panel=page.getByRole('complementary',{name:'APU y materiales de la partida'});
 await panel.getByRole('row').filter({hasText:material.productos.nombre}).getByRole('cell').last().getByText(expected.toLocaleString('es-PY',{maximumFractionDigits:6}),{exact:true}).waitFor();
 await page.screenshot({path:`audit-artifacts/workbook-linked-import/${mode}-apu-editing.png`,fullPage:true});
 await page.reload({waitUntil:'networkidle',timeout:180000});await selectApu();assert.equal(await page.locator(`form[data-apu-line="${material.id}"]`).getByRole('spinbutton',{name:/Consumo por unidad/}).inputValue(),String(nextConsumption));
 await saveMaterial(material.cantidad_por_unidad_ejecutada);materialApplied=false;
 const literal=await editQuantity(quantity);assert.equal(literal.snapshot.rows[index]._formulas?.quantity,undefined,'A literal must clear the previous formula');
 await page.reload({waitUntil:'networkidle',timeout:180000});const reopenedLiteral=await api(`/api/planillas/${current.id}`);assert.equal(reopenedLiteral.body.snapshot.rows[index].quantity,quantity);assert.equal(reopenedLiteral.body.snapshot.rows[index]._formulas?.quantity,undefined);
 if(original._formulas?.quantity)await editQuantity(quantity,original._formulas.quantity);
 await confirmQuantity(quantity);quantityApplied=false;
 const restoredParallel=await Promise.all([draft(),draft()]);assert.equal(restoredParallel[0].id,restoredParallel[1].id);current=restoredParallel[0];assert.equal(current.snapshot.rows[index].quantity,quantity);await page.goto(origin+`/planillas/${current.id}`,{waitUntil:'networkidle',timeout:180000});
 await page.getByRole('tab',{name:'APU',exact:true}).click();await page.getByLabel('Partida activa',{exact:true}).selectOption(material.budget_item_id);
 await page.getByRole('button',{name:'Editar APU',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 const report={mode,origin,companyId:fixture.empresaId,authenticatedAccount:fixture.email,projectId,planillaId:current.id,partida:original.code,materialId:material.id,originalQuantity:quantity,testQuantity:nextQuantity,originalConsumption:material.cantidad_por_unidad_ejecutada,testConsumption:nextConsumption,restored:true,...(await propagation.restored()),browserErrors:errors,checks:['literal replaces formula and persists after reload','quantity formula saved/reopened','quantity applied to budget','native APU consumption saved/reopened','material need recalculated','source material price preserved','original quantity and APU restored']};
 fs.writeFileSync(`audit-artifacts/workbook-linked-import/${mode}-editing-result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page){await page.screenshot({path:`audit-artifacts/workbook-linked-import/${mode}-editing-failure.png`,fullPage:true}).catch(()=>{});console.log(JSON.stringify({url:page.url(),alerts:await page.getByRole('alert').allTextContents().catch(()=>[])}));}throw error;}
finally{
 if(materialApplied){const {error}=await db.from('budget_item_materials').update({cantidad_por_unidad_ejecutada:material.cantidad_por_unidad_ejecutada,desperdicio_pct:material.desperdicio_pct}).eq('id',material.id).eq('empresa_id',fixture.empresaId).eq('cantidad_por_unidad_ejecutada',nextConsumption);if(error)console.log(JSON.stringify({restoreApuError:error.message}));}
 if(quantityApplied){const restore=await draft();const rows=restore.snapshot.rows;const row=rows.find(row=>row._rowId===original._rowId);if(row&&row.quantity===nextQuantity){row.quantity=quantity;row._formulas=original._formulas??{};const saved=await api(`/api/planillas/${restore.id}`,'PATCH',{rows,expectedVersion:restore.updated_at});if(saved.status===200){const restored=await api(`/api/planillas/${restore.id}/confirmar`,'POST',{expectedVersion:saved.body.updated_at});console.log(JSON.stringify({quantityCleanupStatus:restored.status}));}}}
 if(browser)await browser.close();await db.auth.signOut({scope:'local'});
}


