const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { firefox } = require('playwright');
const dir = __dirname;
const outputs = path.join(dir, 'local');

const actionMocks = `
export async function createOtherWorkday(projectId, date, notes, classification, reasonCode) {
 if (window.fixtureFailDate === date) return { error: 'Error sintético de guardado' };
 const row = {id:date,work_date:date,classification,reason_code:reasonCode,source:'MANUAL',decision_status:'CONFIRMED',confirmed_by:'fixture-admin'};
 window.fixtureWorkdays.push(row); window.fixtureWrites.push({ action:'createOtherWorkday',date,...row }); return {error:null};
}
export async function overrideWeatherWorkday(projectId, id, input) {
 const row=window.fixtureWorkdays.find(day=>day.id===id);
 if(window.fixtureFailDate===row.work_date)return {error:'Error sintético de guardado'};
 Object.assign(row,{classification:input.classification,reason_code:input.reasonCode,source:'MANUAL',decision_status:'CONFIRMED',confirmed_by:'fixture-admin'});
 window.fixtureWrites.push({action:'overrideWeatherWorkday',date:row.work_date,...input}); return {error:null};
}
export async function confirmWeatherWorkday(projectId,id){const row=window.fixtureWorkdays.find(day=>day.id===id);row.decision_status='CONFIRMED';row.confirmed_by='fixture-admin';window.fixtureWrites.push({action:'confirmWeatherWorkday',id});return{error:null};}
export async function saveWeatherCalendarDraft(projectId,entries){
 window.fixtureBatchCalls=(window.fixtureBatchCalls??0)+1;
 const result={saved:[],failed:[]};
 for(const entry of entries){
  const existing=window.fixtureWorkdays.find(day=>day.work_date===entry.date);
  const classification=entry.code==='B'?'WORKABLE':entry.code==='LL'?'NON_WORKABLE_RAIN':'NON_WORKABLE_OTHER';
  const reasonCode=entry.code==='HH'?'TERRAIN_SATURATED':entry.code==='O'?'OTHER':null;
  const response=existing?await overrideWeatherWorkday(projectId,existing.id,{classification,reasonCode}):await createOtherWorkday(projectId,entry.date,'',classification,reasonCode);
  if(response.error)result.failed.push({date:entry.date,error:response.error});else result.saved.push(entry.date);
 }
 window.refreshFixture();return result;
}
export async function addClimateEvidence(){throw Error('Unexpected evidence mutation');}
export async function createRainEffectWorkday(){throw Error('Unexpected rain effect mutation');}
export async function evaluateProjectWeatherDayAction(){throw Error('Unexpected weather evaluation');}
export async function updateLocalPrecipitation(){throw Error('Unexpected local measurement mutation');}
`;

async function main() {
  fs.mkdirSync(outputs,{recursive:true});
  await require('esbuild').build({ entryPoints:[path.join(dir,'fixture.jsx')], outfile:path.join(outputs,'ui.js'), bundle:true, platform:'browser', format:'iife', jsx:'automatic', alias:{'@':process.cwd()}, plugins:[{
    name:'fixture-only-boundaries', setup(build){
      build.onResolve({filter:/climate-actions$|certificado-anexos-actions$|historical-weather-actions$|edit-project-dialog$|next\/navigation$|supabase\/browser$/}, args=>({path:args.path,namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:
        args.path.endsWith('climate-actions')?actionMocks:
        args.path.endsWith('certificado-anexos-actions')?'export async function saveSchedulePlan(){throw Error("Unexpected plan mutation")} export async function activateSchedulePlan(){throw Error("Unexpected plan mutation")} export async function deleteSchedulePlan(){throw Error("Unexpected plan mutation")}':
        args.path.endsWith('historical-weather-actions')?'export async function getHistoricalWeatherAction(){return {error:null,data:{days:[],sources:[]}}}':
        args.path.endsWith('edit-project-dialog')?'export function EditProjectDialog({trigger}){return trigger}':
        args.path==='next/navigation'?'export function useRouter(){return{refresh(){window.refreshFixture()},push(){}}}':
        'export function createClient(){return{storage:{from(){return{async createSignedUrl(){return{data:{signedUrl:"/photo.svg"}}}}}}}}',loader:'jsx'}));
    }
  }]});
  const css = await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')});
  const moduleCss = fs.readFileSync(path.join(outputs,'ui.css'),'utf8');
  fs.writeFileSync(path.join(outputs,'ui.css'),css.css+'\n'+moduleCss);
  const server=http.createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><div id="root"></div><script src="/ui.js"></script></html>');}
    const file=path.join(outputs,req.url==='/ui.js'?'ui.js':'ui.css');res.setHeader('Content-Type',req.url==='/ui.js'?'text/javascript':'text/css');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await firefox.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const checks=[];
  const check=(name,fn)=>{fn();checks.push(name);};
  const day=date=>page.getByTestId('libro-day-'+date);
  const writes=()=>page.evaluate(()=>window.fixtureWrites);
  try {
    await page.goto('http://127.0.0.1:'+server.address().port);
    await day('2026-07-21').waitFor();
    await page.mouse.move(0,0);
    const appearance = locator => locator.evaluate(element => { const style = getComputedStyle(element); return { background:style.backgroundColor, border:style.borderColor, shadow:style.boxShadow }; });
    const idle = await appearance(day('2026-07-22'));
    assert.equal(idle.shadow,'none');assert.equal((await appearance(day('2026-08-08'))).shadow,'none');checks.push('idle cells have no permanent illumination');
    await day('2026-07-22').hover();await page.waitForTimeout(180);
    const hovered = await appearance(day('2026-07-22'));
    assert.notEqual(hovered.background,idle.background);assert.notEqual(hovered.border,idle.border);assert.notEqual(hovered.shadow,'none');
    assert.equal((await appearance(day('2026-08-08'))).shadow,'none');checks.push('hover illuminates only the pointed cell');
    await page.screenshot({path:path.join(dir,'calendar-hover-only.png'),fullPage:true});
    await page.mouse.move(0,0);await page.waitForTimeout(180);assert.deepEqual(await appearance(day('2026-07-22')),idle);checks.push('hover illumination disappears on leave');
    await day('2026-11-02').hover();await page.waitForTimeout(180);assert.equal((await appearance(day('2026-11-02'))).shadow,'none');checks.push('disabled dates do not illuminate');
    check('all calendar days render',()=>assert.ok(true));
    assert.equal(await page.locator('[data-testid^="libro-day-"]').count(),153);checks.push('153 dates over 5 months');
    assert.equal(await page.locator('select').count(),0);checks.push('zero native selects');
    assert.equal(await page.locator('details[open]').count(),0);checks.push('advanced and legacy initially collapsed');
    assert.ok(await page.getByRole('button',{name:'Link / QR para residente'}).isVisible());checks.push('resident QR action visible');
    assert.ok((await day('2026-09-03').innerText()).includes('Sugerencia LL'));assert.ok((await day('2026-09-03').innerText()).includes('23 mm'));checks.push('automatic proposal and resident evidence on date');
    await day('2026-07-22').click();assert.equal((await writes()).length,0);checks.push('selecting performs no mutation');
    const typeButtons=['B','LL','HH','O'].map(code=>page.getByRole('button',{name:`Aplicar ${code} a días seleccionados`,exact:true}));
    const typeStyles=await Promise.all(typeButtons.map(appearance));
    assert.equal(new Set(typeStyles.map(style=>style.border)).size,4);checks.push('four distinct type button accent colors');
    for(let i=0;i<typeButtons.length;i++){await typeButtons[i].hover();await page.waitForTimeout(180);assert.notDeepEqual(await appearance(typeButtons[i]),typeStyles[i]);}
    checks.push('each type has its own hover');
    await page.mouse.move(0,0);await page.waitForTimeout(180);
    assert.notEqual((await appearance(day('2026-07-22'))).background,idle.background);assert.ok((await day('2026-07-22').innerText()).includes('✓'));checks.push('selection remains visibly filled and checked after pointer leaves');
    await day('2026-08-08').click({modifiers:['Control']});assert.equal(await page.locator('[aria-pressed="true"][data-testid^="libro-day-"]').count(),2);checks.push('Ctrl adds across months');
    await day('2026-07-22').click({modifiers:['Control']});assert.equal(await page.locator('[aria-pressed="true"][data-testid^="libro-day-"]').count(),1);checks.push('Ctrl removes');
    await day('2026-07-22').click({modifiers:['Control']});
    await page.screenshot({path:path.join(dir,'calendar-multi-selection.png'),fullPage:true});
    await page.getByRole('button',{name:'Aplicar HH a días seleccionados',exact:true}).click();
    await page.getByText('2 cambios sin guardar',{exact:true}).waitFor();
    assert.equal((await writes()).length,0);assert.equal(await day('2026-07-22').getAttribute('data-draft'),'true');checks.push('assigning HH only stages local draft');
    await day('2026-07-21').click();await day('2026-08-07').click({modifiers:['Control']});
    await page.getByRole('button',{name:'Aplicar O a días seleccionados',exact:true}).click();await page.getByText('4 cambios sin guardar',{exact:true}).waitFor();
    await day('2026-07-22').click();await page.getByRole('button',{name:'Aplicar B a días seleccionados',exact:true}).click();
    assert.equal((await writes()).length,0);assert.equal(await page.evaluate(()=>window.fixtureBatchCalls??0),0);checks.push('mixed types and reassignment make zero action calls');
    await page.screenshot({path:path.join(dir,'calendar-mixed-draft.png'),fullPage:true});
    await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.getByText('4 días guardados · 0 días pendientes.',{exact:true}).waitFor();
    const first=await writes();assert.equal(first.length,4);assert.equal(await page.evaluate(()=>window.fixtureBatchCalls),1);checks.push('one explicit save sends all mixed dates once');
    assert.ok(first.some(row=>row.date==='2026-07-22'&&row.classification==='WORKABLE'&&row.source==='MANUAL'));
    assert.ok(first.some(row=>row.date==='2026-08-08'&&row.classification==='NON_WORKABLE_OTHER'&&row.reason_code==='TERRAIN_SATURATED'));
    assert.equal(first.filter(row=>row.action==='overrideWeatherWorkday'&&row.reasonCode==='OTHER').length,2);checks.push('mixed save preserves create and override mappings');
    await day('2026-09-04').click();await day('2026-09-05').click({modifiers:['Control']});await day('2026-09-06').click();assert.equal(await page.locator('[aria-pressed="true"][data-testid^="libro-day-"]').count(),1);checks.push('plain click replaces selection');
    await day('2026-09-04').click();await page.getByRole('button',{name:'Aplicar LL a días seleccionados',exact:true}).click();
    await day('2026-09-05').click();await page.getByRole('button',{name:'Aplicar HH a días seleccionados',exact:true}).click();await page.evaluate(()=>window.fixtureFailDate='2026-09-05');
    await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.getByText('1 día guardado · 1 día pendiente.',{exact:true}).waitFor();
    assert.equal(await day('2026-09-05').getAttribute('aria-pressed'),'true');assert.equal(await day('2026-09-04').getAttribute('aria-pressed'),'false');checks.push('partial failure retains only failed date');
    await page.screenshot({path:path.join(dir,'calendar-partial-result.png'),fullPage:true});
    assert.equal(await day('2026-09-05').getAttribute('data-draft'),'true');assert.equal(await day('2026-09-04').getAttribute('data-draft'),'false');checks.push('partial result preserves only failed draft codes');
    await page.evaluate(()=>window.fixtureFailDate=null);await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();await page.getByText('1 día guardado · 0 días pendientes.',{exact:true}).waitFor();checks.push('failed-date retry');
    const beforeDiscard=(await writes()).length;
    await day('2026-09-06').click();await page.getByRole('button',{name:'Aplicar B a días seleccionados',exact:true}).click();
    await page.getByRole('button',{name:'Descartar cambios',exact:true}).click();assert.equal((await writes()).length,beforeDiscard);assert.equal(await day('2026-09-06').getAttribute('data-draft'),'false');checks.push('discard restores stored view without writes');
    await day('2026-09-03').click();await page.getByText('2026-09-03 · Libro: sin decisión final · ver propuesta y evidencia',{exact:true}).click();
    await page.getByRole('button',{name:'Confirmar sugerencia LL',exact:true}).click();await page.waitForFunction(()=>window.fixtureWorkdays.find(row=>row.id==='proposal').decision_status==='CONFIRMED');
    assert.equal(await page.evaluate(()=>window.fixtureWorkdays.find(row=>row.id==='proposal').source),'AUTOMATIC');checks.push('plain confirmation preserves AUTOMATIC origin');
    await page.getByRole('button',{name:'Link / QR para residente',exact:true}).click();await page.getByAltText('QR del registro de avance').waitFor();checks.push('existing QR dialog renders');
    await page.screenshot({path:path.join(dir,'resident-qr.png')});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Limpiar selección',exact:true}).click();await page.getByRole('button',{name:'Selección múltiple',exact:true}).click();
    await day('2026-09-07').click();await day('2026-09-08').click();assert.equal(await day('2026-09-07').getAttribute('aria-pressed'),'true');assert.equal(await day('2026-09-08').getAttribute('aria-pressed'),'true');checks.push('touch selection toggle');
    const mode=page.getByRole('button',{name:'Selección múltiple',exact:true});
    const activeStyle=await appearance(mode);await page.mouse.move(0,0);await page.waitForTimeout(180);
    assert.equal(await mode.getAttribute('aria-pressed'),'true');assert.ok((await mode.innerText()).includes('ACTIVA'));
    await mode.click();await page.mouse.move(0,0);await page.waitForTimeout(180);
    assert.equal(await mode.getAttribute('aria-pressed'),'false');assert.ok((await mode.innerText()).includes('INACTIVA'));assert.notEqual((await appearance(mode)).background,activeStyle.background);
    await mode.click();await page.mouse.move(0,0);checks.push('multiple mode visibly persists after pointer leaves and toggles off');
    await page.screenshot({path:path.join(dir,'calendar-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);checks.push('no page errors');
    fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify({scope:'Local Firefox with actual AvanceFisicoPanel and synthetic action adapters; not authenticated deployed acceptance',passed:checks.length,checks,pageErrors:errors},null,2)+'\n');
    console.log(JSON.stringify({passed:checks.length,pageErrors:errors}));
  } finally {await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exit(1)});
