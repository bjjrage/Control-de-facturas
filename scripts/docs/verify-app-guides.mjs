// Verifica únicamente archivos locales; no inicia la app ni contacta servicios.
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { MODULES, FLOWS, AREAS } from './app-guide-data.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const evidence=process.argv[2];
if(!evidence)throw new Error('Indicá una carpeta para la evidencia de navegador');
mkdirSync(evidence,{recursive:true});
const urls=Object.fromEntries(['manual-de-obra.html','flujo-de-obra.html'].map(n=>[n,pathToFileURL(resolve(root,'instructivos y roadmap',n)).href]));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();
const errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
const ok=(name)=>checks.push(name);
try {
  const inventories={};
  for(const [name,url] of Object.entries(urls)) {
    await page.goto(url);
    inventories[name]=await page.evaluate(()=>({ids:[...document.querySelectorAll('[id]')].map(x=>x.id),links:[...document.querySelectorAll('a[href]')].map(x=>x.getAttribute('href')),cards:document.querySelectorAll('[data-card]').length}));
    const {ids,cards}=inventories[name];
    assert.equal(ids.length,new Set(ids).size,`${name}: IDs duplicados`);
    assert.equal(cards,name.startsWith('manual')?MODULES.length:FLOWS.length);
    assert.equal(await page.locator('[data-card]:visible').count(),cards);
    assert.equal(await page.locator('html').getAttribute('lang'),'es');
    assert.match(await page.locator('body').innerText(),/Licitaciones/);
    await page.locator('#filter').selectOption(name.startsWith('manual')?'licitar':'licitar-obra');
    assert.equal(await page.locator('[data-card]:visible').count(),name.startsWith('manual')?MODULES.filter(m=>m.area==='licitar').length:1);
    await page.locator('#search').fill('zzzinexistente123');
    assert.equal(await page.locator('[data-card]:visible').count(),0);
    assert.equal(await page.locator('#empty').isVisible(),true);
    await page.locator('#reset').click();
    assert.equal(await page.locator('[data-card]:visible').count(),cards);
    ok(`${name}: inventario, filtros, sin coincidencias y restablecimiento`);
  }
  for(const [name,inventory] of Object.entries(inventories)) for(const link of inventory.links) {
    const [file,anchor]=link.split('#');
    const target=file||name;
    assert.ok(inventories[target],`Archivo inesperado en enlace ${name}: ${link}`);
    if(anchor)assert.ok(inventories[target].ids.includes(decodeURIComponent(anchor)),`Ancla inexistente ${name}: ${link}`);
  }
  ok('Todos los enlaces locales y cruzados resuelven a destinos existentes');

  await page.goto(urls['manual-de-obra.html']);
  for(const area of AREAS){await page.locator('#filter').selectOption(area.id);assert.equal(await page.locator('[data-card]:visible').count(),MODULES.filter(m=>m.area===area.id).length);}
  await page.locator('#reset').click();
  await page.locator('#search').fill('computo avanzado');
  assert.equal(await page.locator('#computo-avanzado').isVisible(),true);
  assert.equal(await page.locator('#computo-avanzado').getAttribute('open'),'');
  await page.locator('#filter').selectOption('comprar');
  await page.evaluate(()=>{location.hash='bim';});
  await page.waitForFunction(()=>document.getElementById('bim').open && !document.getElementById('bim').hidden);
  assert.equal(await page.locator('#filter').inputValue(),'');
  assert.equal(await page.locator('#search').inputValue(),'');
  await page.locator('#expand').click();
  assert.equal(await page.locator('.module[open]').count(),MODULES.length);
  await page.locator('#collapse').click();
  assert.equal(await page.locator('.module[open]').count(),0);
  await page.goto(urls['manual-de-obra.html']+'#crear-proyecto');
  await page.waitForFunction(()=>document.getElementById('proyectos').open);
  await page.goto(urls['manual-de-obra.html']+'#cobertura');
  await page.waitForFunction(()=>document.getElementById('cobertura').open);
  ok('Todas las áreas, búsqueda sin tildes, apertura de anclas, alias históricos y fichas');

  await page.goto(urls['flujo-de-obra.html']+'#licitar-obra');
  await page.locator('#licitar-obra a[href="manual-de-obra.html#prebid"]').first().click();
  await page.waitForFunction(()=>document.getElementById('prebid')?.open);
  assert.ok(page.url().endsWith('manual-de-obra.html#prebid'));
  ok('Navegación de un circuito a su ficha de manual');

  for(const [name,url] of Object.entries(urls)) {
    await page.goto(url);
    await page.screenshot({path:resolve(evidence,name.replace('.html','-desktop.png'))});
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    assert.equal(await page.locator('#nav').getAttribute('open'),null);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: desborde móvil inicial`);
    if(name.startsWith('manual')){
      await page.locator('#expand').click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: desborde móvil expandido`);
      await page.locator('#collapse').click();
    }
    await page.screenshot({path:resolve(evidence,name.replace('.html','-mobile.png'))});
    await page.setViewportSize({width:1440,height:1000});
    // Imprimir incluye todos los resultados aun si había un filtro activo.
    await page.locator('#filter').selectOption(name.startsWith('manual')?'comprar':'comprar-pagar');
    await page.emulateMedia({media:'print'});
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('[data-card]:visible').count(),name.startsWith('manual')?MODULES.length:FLOWS.length);
    if(name.startsWith('manual'))assert.equal(await page.locator('.module-body:visible').count(),MODULES.length);
    await page.pdf({path:resolve(evidence,name.replace('.html','.pdf')),printBackground:true,preferCSSPageSize:true});
    await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({media:'screen'});
    ok(`${name}: escritorio, móvil 390 px sin desbordes e impresión completa`);
  }
  const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  for(const url of Object.values(urls)){
    const p=await nojs.newPage();await p.goto(url);assert.ok(await p.locator('h1').isVisible());
    if(url.includes('manual-de-obra')){await p.locator('#bim > summary').click();assert.equal(await p.locator('#bim').getAttribute('open'),'');}
    await p.close();
  }
  await nojs.close();
  ok('Lectura básica y fichas nativas sin JavaScript');
  assert.deepEqual(errors,[],'Errores JavaScript');
  assert.deepEqual(requests,[],'Los documentos solicitaron recursos de red');
  writeFileSync(resolve(evidence,'browser-verification.json'),JSON.stringify({status:'PASS',checks,errors,requests,inventories:Object.fromEntries(Object.entries(inventories).map(([k,v])=>[k,{ids:v.ids.length,links:v.links.length,cards:v.cards}]))},null,2)+'\n','utf8');
  console.log(JSON.stringify({status:'PASS',checks,errors,networkRequests:requests.length},null,2));
} finally {await browser.close();}
