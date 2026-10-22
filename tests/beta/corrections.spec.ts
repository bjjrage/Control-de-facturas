import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { login, go } from './helpers';
const users=JSON.parse(readFileSync('.qa/users.json','utf8'));
const stamp=Date.now().toString(36).toUpperCase();
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
async function insert(table:string,row:Record<string,unknown>) {
  const r=await db.from(table).insert(row).select('id').single();if(r.error) throw Error(table+': '+r.error.message);return r.data!.id as string;
}
test('A4: normalized duplicate RUC rejected with a clear message',async({page})=>{
  await login(page,'admin_a');await go(page,'/providers');
  await page.getByRole('button',{name:'Nuevo proveedor'}).click();const dlg=page.getByRole('dialog');
  await dlg.getByLabel('Nombre',{exact:true}).fill('QA Beta duplicado '+stamp);
  await dlg.getByLabel('RUC',{exact:true}).fill('800.111.11-7');
  await dlg.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(dlg).toContainText('Ya existe un proveedor con ese RUC en esta empresa.');
  const r=await db.from('providers').select('id').eq('name','QA Beta duplicado '+stamp);expect(r.data).toHaveLength(0);
});
test('A5: opening stock clears the form, shows success and writes once on double click',async({page})=>{
  const id=await insert('productos',{empresa_id:users.admin_a.empresa_id,nombre:'QA Beta apertura '+stamp,unidad:'unidad',sku:'BETA-'+stamp});
  await login(page,'admin_a');await go(page,'/inventario');
  await page.getByRole('button',{name:'Carga inicial de stock',exact:true}).click();const dlg=page.getByRole('dialog');
  await dlg.getByRole('combobox').nth(0).click();await page.getByRole('option',{name:'QA Beta apertura '+stamp,exact:true}).click();
  await dlg.getByRole('combobox').nth(1).click();await page.getByRole('option').filter({hasText:/Depósito/}).first().click();
  await dlg.getByLabel(/^Cantidad/).fill('7');await dlg.getByLabel('Costo unitario',{exact:true}).fill('1000');
  const submit=dlg.getByRole('button',{name:'Registrar carga inicial',exact:true});
  await submit.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});
  const status=dlg.getByRole('status');await expect(status).toBeVisible();await expect(status).toHaveClass(/text-\[var\(--ok\)\]/);
  await expect(submit).toBeDisabled();await expect(dlg.getByLabel(/^Cantidad/)).toHaveValue('');
  const movements=await db.from('inventory_movements').select('quantity').eq('producto_id',id);expect(movements.error).toBeNull();expect(movements.data).toEqual([{quantity:7}]);
});
test('A6: desktop cancel retires PIN and revokes an already connected mobile',async({page,playwright,baseURL})=>{
  await login(page,'admin_a');await go(page,'/invoices');await page.getByRole('button',{name:/Nueva factura/}).first().click();
  const created=page.waitForResponse(r=>r.url().endsWith('/api/scanner/session')&&r.request().method()==='POST');
  await page.getByRole('dialog').getByRole('button',{name:'Escanear desde celular'}).click();
  const payload=await (await created).json();expect(payload.pinCode).toMatch(/^\d{6}$/);
  const stored=await db.from('scan_sessions').select('pin_code').eq('id',payload.sessionId).single();expect(stored.data?.pin_code).toMatch(/^hmac-v1:[a-f0-9]{64}$/);
  const mobile=await playwright.request.newContext({baseURL});
  const claim=await mobile.post('/api/scanner/claim',{data:{pin:payload.pinCode}});expect(claim.status()).toBe(200);const credential=await claim.json();
  await page.getByRole('dialog').last().getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect.poll(async()=>{const s=await db.from('scan_sessions').select('status,mobile_claim_token_hash,pin_code').eq('id',payload.sessionId).single();return s.data;}).toEqual({status:'canceled',mobile_claim_token_hash:null,pin_code:'RETIRED:'+payload.sessionId});
  expect((await mobile.post('/api/scanner/claim',{data:{pin:payload.pinCode,mobileClaimToken:credential.mobileClaimToken}})).status()).toBe(400);
  expect((await page.request.delete('/api/scanner/session',{data:{sessionId:payload.sessionId}})).status()).toBe(200);
  await mobile.dispose();
});
test('A2/A3: cap quantity, refresh totals, approve and open the sales draft',async({page})=>{
  const project=await insert('projects',{empresa_id:users.admin_a.empresa_id,name:'QA Beta certificado '+stamp,code:'BC-'+stamp,contract_amount:1000000});
  await insert('budget_items',{project_id:project,code:'BETA-01',description:'Partida QA beta',unit:'un',quantity:100,unit_price:10000});
  await login(page,'admin_a');await go(page,`/projects/${project}?tab=certificados`);
  await page.getByRole('button',{name:'Nuevo certificado',exact:true}).click();const dlg=page.getByRole('dialog');
  await dlg.locator('#cert_start').fill('2035-01-01');await dlg.locator('#cert_end').fill('2035-01-31');
  await dlg.getByRole('button',{name:'Generar certificado',exact:true}).click();await expect(dlg).toBeHidden();
  const row=page.getByRole('row').filter({hasText:'01/01/2035'}).first();await row.locator('td').nth(1).click();
  const qty=page.getByLabel('Cantidad presente: BETA-01',{exact:true});await expect(qty).toBeVisible();
  await qty.fill('105');await qty.blur();await expect(page.getByText(/El avance acumulado supera la cantidad contratada/)).toBeVisible();await expect(qty).toHaveValue('0');
  await qty.fill('10');await qty.blur();await expect(page.getByRole('row').filter({hasText:'BETA-01'}).last()).toContainText('100.000 PYG');
  await page.getByRole('button',{name:'Elaborar',exact:true}).click();await page.getByRole('button',{name:'Marcar verificado',exact:true}).click();await page.getByRole('button',{name:'Aprobar',exact:true}).click();
  const client=page.getByRole('combobox').filter({hasText:'Elegir cliente'});await client.click();await page.locator('[role="option"]:not([data-disabled])').filter({hasNotText:/Elegir/}).first().click();
  await page.getByRole('button',{name:'Crear borrador de factura',exact:true}).click();await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]+$/);await page.waitForLoadState('networkidle');await expect(page.locator('body')).not.toContainText('404');
});
