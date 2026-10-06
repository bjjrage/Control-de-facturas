// Actual ERP components with synthetic props. Server actions, Supabase and fetch are replaced locally.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { firefox } = require('playwright');
const root = process.cwd(), output = path.join(root, 'audit-artifacts/ui-recovery-01/correction-3');
const local = path.join(output, 'local');
const product = { id: 'product-a', nombre: 'Cemento fixture', unidad: 'bolsa', activo: true };
const item = { id: 'item-a', project_id: 'project-a', code: '01', description: 'Mamposteria fixture', unit: 'm2', quantity: 100, unit_price: 1000 };
const model = { id: 'model-a', name: 'Modelo fixture', file_name: 'fixture.ifc', status: 'PROCESSED', elements_count: 1 };
const group = { id: 'group-a', bim_model_id: 'model-a', ifc_class: 'IfcWall', name: 'Muro fixture', unit: 'm2', quantity: 10, element_count: 1 };
const fixtures = {
  getBimData: { models: [model], elements: [], budgetItems: [item], error: null },
  getBimGroupsData: { groups: [group], matches: [], error: null },
  getBimModelFileUrl: { error: 'Viewer disabled in synthetic fixture', url: null },
};

(async () => {
  fs.mkdirSync(local, { recursive: true });
  const jsx = `import React from 'react';import{createRoot}from'react-dom/client';
import{Select}from'@/components/ui/select';import{UbicacionesDialog}from'@/app/(internal)/inventario/ubicaciones-dialog';
import Stock from'@/app/(internal)/stock/nuevo/page';import{WarehousePortalClient}from'@/app/warehouse/[token]/warehouse-portal-client';
import{CompetidoresRadarClient}from'@/app/(internal)/licitaciones/competidores/competidores-radar-client';
import{RecepcionSection}from'@/app/(internal)/orders/[id]/recepcion-section';import{SifenButton}from'@/app/(internal)/ventas/[id]/sifen-button';
import{BimSection}from'@/app/(internal)/projects/[id]/bim-section';import{PanolObraSection}from'@/app/(internal)/projects/[id]/panol-obra-section';
import{CobrosFilter}from'@/app/(internal)/cobros/cobros-filter';
window.__calls=[];window.fetch=async(url,opts)=>{window.__calls.push({name:'fetch',args:[url,opts.body instanceof FormData?Object.fromEntries(opts.body):opts.body]});return{ok:false,json:async()=>({error:'Mutation blocked in fixture'})}};
const item=${JSON.stringify(item)},product=${JSON.stringify(product)};
const context={token:'fixture-token',locationId:'location-a',locationName:'Deposito fixture',projectId:'project-a',projectName:'Proyecto fixture',projectCode:'P-01',empresaId:'company-a',orders:[],stock:[{productId:product.id,productName:product.nombre,unit:product.unidad,quantity:100}],allProducts:[],budgetItems:[item]};
function App(){return <main style={{maxWidth:1200,margin:'auto',padding:20}}><h1>Global Select — synthetic local fixtures, mutations blocked</h1>
<section data-module='placeholder'><form><label>Proveedor obligatorio<Select name='provider_id' required><option value='' disabled>Elegi proveedor</option><option value='provider-a'>Proveedor A</option></Select></label><button type='submit'>Submit fixture</button></form></section>
<section data-module='inventory'><h2>Inventario</h2><UbicacionesDialog locations={[]} projects={[{id:'project-a',name:'Proyecto fixture',code:'P-01'}]}/></section>
<section data-module='stock'><Stock/></section>
<section data-module='warehouse'><WarehousePortalClient context={context}/></section>
<section data-module='competitors'><CompetidoresRadarClient competitors={[]} totalFiltered={0} totalHistorical={0} page={1} limit={20} totalPages={1} currentFilters={{q:'',period:24,evidence:'CON_EVIDENCIA',minBids:1,certainty:'TODAS',outcome:'TODOS',showExcluded:false}}/></section>
<section data-module='receipt'><RecepcionSection orderId='order-a' orderItems={[{id:'order-item-a',product:product.nombre,quantity:10,unit:'bolsa',producto_id:null}]} recepciones={[]} currentUserId='fixture-user'/></section>
<section data-module='sifen'><SifenButton docId='credit-note-a' docType='NOTA_CREDITO' status='EMITIDA' cdc={null} kudeUrl={null} xmlUrl={null} creditNoteItems={[{id:'credit-item-a',description:'Credito fixture'}]} sourceInvoiceItems={[{id:'source-item-a',description:'Origen fixture'}]}/></section>
<section data-module='bim'><BimSection projectId='project-a'/></section>
<section data-module='panol'><PanolObraSection projectId='project-a' locations={[{id:'location-a',name:'Deposito fixture'}]} portalLinks={[]} submissions={[{id:'submission-a',location_name:'Deposito fixture',period_start:'2026-09-01',period_end:'2026-09-07',status:'NEEDS_REVIEW',upload_incomplete:false,processing_error:null,evidence:[],lines:[{id:'line-a',raw_description:'Cemento fixture',producto_id:null,quantity:1,unit:'bolsa',budget_item_id:null,state:'PROPOSED',notes:null,uncertainty_reason:null,inventory_movement_id:null}]}]} products={[product]} budgetItems={[item]}/></section>
<section data-module='cobros'><h2>Cobros</h2><CobrosFilter clients={[{id:'client-a',name:'Cliente fixture'}]}/></section>
</main>};createRoot(document.getElementById('root')).render(<App/>);`;
  const plugin = { name: 'block-external-actions', setup(build) {
    build.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'next/link' ? `import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const useRouter=()=>({refresh(){},push(url){window.__calls.push({name:'router.push',args:[url]})}});`, loader: 'jsx', resolveDir: root }));
    build.onLoad({ filter: /\.tsx?$/ }, args => {
      const source = fs.readFileSync(args.path, 'utf8'), file = args.path.replaceAll('\\', '/');
      if (/^["']use server["']/.test(source)) {
        const names = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(match => match[1]);
        return { contents: names.map(name => `export const ${name}=${fixtures[name] ? `async()=>(${JSON.stringify(fixtures[name])})` : `async(...args)=>{window.__calls.push({name:'${name}',args:args.map(a=>a instanceof FormData?Object.fromEntries(a):a)});return{error:'Mutation blocked in fixture',data:null}}`};`).join('\n'), loader: 'js' };
      }
      if (file.endsWith('/lib/supabase/browser.ts')) return { contents: `export function createClient(){return{from(table){if(!['productos','categorias_producto'].includes(table))throw Error('Unexpected DB fixture read: '+table);const data=table==='productos'?[${JSON.stringify(product)}]:[{id:'category-a',nombre:'Categoria fixture'}];const q={select(){return q},eq(){return q},order(){return q},returns(){return q},then(fn){return Promise.resolve({data,error:null}).then(fn)}};return q}}}`, loader: 'js' };
      if (file.endsWith('/lib/bim/ifc-viewer.client.ts')) return { contents: `export function createIfcViewer(){return{dispose(){},fitSelection(){}}}`, loader: 'js' };
      if (file.endsWith('/lib/bim/ifc-parser.client.ts')) return { contents: `export async function parseIfcFile(){throw Error('IFC upload disabled')}`, loader: 'js' };
    });
  }};
  await require('esbuild').build({ absWorkingDir: root, stdin: { contents: jsx, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(local, 'ui.js'), jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), plugins: [plugin], define: { 'process.env.NODE_ENV': '"development"' } });
  fs.copyFileSync(path.join(root, 'audit-artifacts/ui-recovery-01/local/ui.css'), path.join(local, 'ui.css'));
  fs.writeFileSync(path.join(local, 'index.html'), '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script src="/ui.js"></script></html>');
  const server = http.createServer((req,res) => { const file = req.url === '/' ? 'index.html' : req.url.slice(1); if (!['index.html','ui.js','ui.css'].includes(file)) return res.writeHead(404).end(); res.setHeader('Content-Type', file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'); res.end(fs.readFileSync(path.join(local,file))); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await firefox.launch({ headless:true }), page = await browser.newPage({ viewport:{width:1440,height:1000} });
  const errors=[],tests=[];page.on('pageerror',error=>errors.push(error.message));
  const module = name => page.locator(`[data-module=${name}]`);
  const choose = async(control, option) => { await control.click();await page.getByRole('option',{name:option,exact:true}).click(); };
  const action = async name => { await page.waitForFunction(n=>window.__calls.some(c=>c.name===n),name);return page.evaluate(n=>window.__calls.filter(c=>c.name===n).at(-1).args,name); };
  const capture = name => page.screenshot({path:path.join(output,name+'.png'),fullPage:false});
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('combobox').first().waitFor();
    assert.equal(await page.locator('select').count(),0);
    const initial = await module('placeholder').locator('form').evaluate(form=>({value:new FormData(form).get('provider_id'),valid:form.checkValidity()}));
    assert.deepEqual(initial,{value:'',valid:false});
    await choose(module('placeholder').getByRole('combobox'),'Proveedor A');
    assert.equal(await module('placeholder').locator('form').evaluate(form=>form.checkValidity()),true);
    await module('placeholder').locator('form').evaluate(form=>form.reset());
    await page.waitForFunction(()=>document.querySelector('[data-module=placeholder] input').value==='');
    tests.push('Disabled empty first placeholder: empty FormData, invalid required, reset preserved');

    await module('inventory').getByRole('button',{name:'Ubicaciones',exact:true}).click();
    const dialog=page.getByRole('dialog');await choose(dialog.getByRole('combobox').first(),'Depósito de obra');
    await dialog.getByRole('combobox').nth(1).click();await page.getByRole('listbox').waitFor();await capture('inventory-dialog-open');await page.getByRole('option',{name:'P-01 · Proyecto fixture',exact:true}).click();
    await dialog.getByRole('button',{name:'Crear o reutilizar ubicación de obra'}).click();
    assert.equal((await action('createInventoryLocation'))[0].projectId,'project-a');assert.equal((await action('createInventoryLocation'))[0].locationType,'PROJECT');
    await page.keyboard.press('Escape');tests.push('Inventory actual create-location payload PROJECT/project-a');

    await module('stock').locator('#p-nombre').fill('Material fixture');
    await choose(module('stock').locator('#p-categoria'),'Categoria fixture');
    await choose(module('stock').locator('#p-unidad'),'bolsa');
    await module('stock').getByRole('button',{name:/Guardar|Crear/}).click();
    const stock=(await action('crearProducto'))[0];assert.equal(stock.unidad,'bolsa');assert.equal(stock.categoria_id,'category-a');tests.push('Stock actual product payload unit/category IDs');

    await module('warehouse').getByRole('button',{name:/Salida|Consumo/}).click();
    await choose(module('warehouse').getByRole('combobox').first(),/Cemento fixture/);
    await choose(module('warehouse').getByRole('combobox').nth(1),/01/);
    await module('warehouse').getByRole('spinbutton').fill('2');
    await module('warehouse').locator('input[type=text]').first().fill('Operador fixture');
    await module('warehouse').locator('form button[type=submit]').click();
    const warehouse=(await action('fetch'))[1];assert.equal(warehouse.producto_id,'product-a');assert.equal(warehouse.budget_item_id,'item-a');assert.equal(warehouse.quantity,'2');tests.push('Warehouse actual consumption FormData product/item/quantity');

    await choose(module('competitors').getByRole('combobox').first(),'12 meses');
    assert.match((await action('router.push'))[0],/period=12/);tests.push('Competitors actual navigation period enum');

    await module('receipt').getByRole('button',{name:/Registrar recepción/}).click();
    await choose(page.getByRole('dialog').getByRole('combobox').first(),'Cemento fixture');
    await page.getByRole('dialog').getByRole('spinbutton').fill('2');
    await page.getByRole('dialog').locator('input[type=text]').first().fill('Operador fixture');
    await page.getByRole('dialog').getByRole('button',{name:'Confirmar recepción',exact:true}).click();
    const receipt=await action('registrarRecepcion');assert.ok(JSON.stringify(receipt).includes('product-a'));assert.ok(JSON.stringify(receipt).includes('order-item-a'));await page.keyboard.press('Escape');tests.push('Receipt actual action order item/product IDs');

    await choose(module('sifen').getByRole('combobox').first(),'2 — Devolución');
    await choose(module('sifen').getByRole('combobox').nth(1),'Origen fixture');
    await module('sifen').getByRole('button',{name:'Emitir FE',exact:true}).click();
    assert.deepEqual((await action('emitirNC'))[1],{emissionMotive:2,sourceItemIds:['source-item-a']});tests.push('SIFEN actual NC motive/source ID payload');

    await module('bim').getByRole('button',{name:'Mostrar',exact:true}).click();
    await module('bim').getByRole('button',{name:'Cambiar rubro',exact:true}).click();
    await choose(module('bim').getByRole('combobox').first(),/01/);
    const bim=await action('confirmGroupMatch');assert.ok(bim.includes('project-a'));assert.ok(bim.includes('group-a'));assert.ok(bim.includes('item-a'));tests.push('BIM actual group/budget-item IDs');

    const panol=module('panol').locator('article');await choose(panol.getByRole('combobox').nth(0),'Cemento fixture · bolsa');await choose(panol.getByRole('combobox').nth(1),'01 · Mamposteria fixture');await choose(panol.getByRole('combobox').nth(2),'Confirmar para consumo');
    await panol.getByRole('button',{name:/Guardar/}).click();
    const line=(await action('updateWarehouseSubmissionLine'))[0];assert.equal(line.productoId,'product-a');assert.equal(line.budgetItemId,'item-a');assert.equal(line.state,'CONFIRMED');tests.push('Panol actual draft line product/item/state payload (blocked action)');

    await choose(module('cobros').getByRole('combobox'),'Cliente fixture');assert.equal((await action('router.push'))[0],'/cobros?client=client-a');tests.push('Cobros actual client-ID navigation');
    await module('sifen').getByRole('combobox').first().click();await page.getByRole('listbox').waitFor();await capture('sifen-dropdown-open');await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});await module('warehouse').getByRole('combobox').first().click();await capture('warehouse-mobile-dropdown-open');await page.keyboard.press('Escape');
    assert.equal(await page.locator('select').count(),0);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'global-browser-results.json'),JSON.stringify({browser:'Windows Firefox / Playwright',fixtureOnly:true,productionMutations:0,tests,errors},null,2));
    console.log(JSON.stringify({state:'PASS',tests:tests.length,screenshots:output}));
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1});
