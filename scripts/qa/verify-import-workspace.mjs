import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from '@playwright/test';

const env = parse(fs.readFileSync('.env.local'));
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'kyiihlkncatojvlasoag.supabase.co', 'QA database only');
const origin = process.argv[2] ?? 'http://localhost:3011';
assert(['localhost', 'control-de-facturas-git-main-marceloechauri-4623s-projects.vercel.app'].includes(new URL(origin).hostname), 'QA origin only');
const filePath = process.env.WORKBOOK_REGRESSION_PATH ?? `${process.env.USERPROFILE}/Downloads/APU_Lote2_LPN02-2026_MEC_492833_ajustado.xlsx`;
const original = fs.readFileSync(filePath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(original), '6c481dd5f9aa1ce1b3df565ea6b6f2b996f4d26d5dddcf670e946098e3d0a33e');
const out = 'audit-artifacts/workbook-linked-import/import-workspace-qa';
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const jar = new Map();
const db = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) } });
const stamp = Date.now();
let fixture;
if (process.argv.includes('--reuse') && fs.existsSync(`${out}-fixture.json`)) fixture = JSON.parse(fs.readFileSync(`${out}-fixture.json`, 'utf8'));
else {
  const { data: company, error: ce } = await admin.from('empresas').insert({ nombre: `QA Import workspace ${stamp}`, slug: `qa-import-ws-${stamp}`, plan: 'caterpillar' }).select('id').single(); if (ce) throw ce;
  const email = `qa-import-ws-${stamp}@example.test`;
  const { data: user, error: ue } = await admin.auth.admin.createUser({ email, password: randomUUID() + randomUUID(), email_confirm: true }); if (ue) throw ue;
  const { error: pe } = await admin.from('profiles').upsert({ id: user.user.id, empresa_id: company.id, email, full_name: 'QA workspace import', role: 'admin', active: true }); if (pe) throw pe;
  fixture = { empresaId: company.id, email, userId: user.user.id };
  fs.writeFileSync(`${out}-fixture.json`, JSON.stringify(fixture));
}
const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: fixture.email }); if (le) throw le;
const { error: ae } = await db.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token }); if (ae) throw ae;
const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
async function api(path, method = 'GET', body) {
  const response = await fetch(origin + path, { method, headers: { cookie: cookie(), Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const json = await response.json().catch(() => null); return { status: response.status, body: json };
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, domain: new URL(origin).hostname, path: '/' })));
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/projects', { waitUntil: 'networkidle', timeout: 180000 });
  if (!fixture.sessionId) {
    await page.getByRole('button', { name: 'Nueva obra', exact: true }).click();
    await page.getByRole('button', { name: /Importar planilla de obra/ }).click();
    const response = page.waitForResponse(r => r.url().endsWith('/api/import-sessions') && r.request().method() === 'POST', { timeout: 180000 });
    await page.getByLabel('Elegir planilla', { exact: true }).setInputFiles(filePath);
    const uploaded = await response; assert.equal(uploaded.status(), 200, await uploaded.text());
    fixture.sessionId = (await uploaded.json()).sessionId;
    fs.writeFileSync(`${out}-fixture.json`, JSON.stringify(fixture));
    await page.waitForURL(`**/projects/import/${fixture.sessionId}`, { timeout: 180000 });
    await page.getByRole('main', { name: 'Workspace de importación' }).waitFor();
  }
  const path = `/api/import-sessions/${fixture.sessionId}/workspace`;
  let session = await api(path); assert.equal(session.status, 200, JSON.stringify(session));
  if (['UPLOADED', 'ANALYZING'].includes(session.body.status)) {
    console.log(JSON.stringify({ stage: 'Luna linking workbook', sessionId: fixture.sessionId }));
    const deadline = Date.now() + 300000;
    while (['UPLOADED', 'ANALYZING'].includes(session.body.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5000)); session = await api(path);
    }
  }
  assert.equal(session.body.status, 'ANALYZED', JSON.stringify({ status: session.body.status, error: session.body.analysisError }));
  assert.equal(session.body.candidate.budgetItems.length, 597);
  assert.equal(session.body.candidate.linkedRecipes.recipes.length, 597);
  assert.equal(session.body.candidate.linkedRecipes.relativeSchedule.length, 597);
  assert.equal(session.body.candidate.linkedRecipes.formulaCount, 55682);
  assert.deepEqual(session.body.candidate.linkedRecipes.issues, []);
  const materialRecipe = session.body.candidate.linkedRecipes.recipes.find(recipe => recipe.lines.some(line => line.kind === 'MATERIAL'));
  const editedIndex = session.body.candidate.budgetItems.findIndex(item => item.code === materialRecipe.budgetCode);
  assert(editedIndex >= 0);
  const resource = materialRecipe.lines.find(line => line.kind === 'MATERIAL');
  const resourceKey = JSON.stringify([resource.code, resource.description, resource.unit]);
  const expectedNeed = session.body.candidate.linkedRecipes.recipes.reduce((sum, recipe) => sum + recipe.lines.filter(line => line.kind === 'MATERIAL' && JSON.stringify([line.code, line.description, line.unit]) === resourceKey).reduce((n,line) => n + line.quantity * (recipe.budgetCode === materialRecipe.budgetCode ? 6 : 1), 0), 0);
  const curve = session.body.candidate.schedulePlans.find(plan => plan.label.includes('resumen de partidas'));
  assert(curve, 'The global curve must derive from the reconciled item amounts');
  assert(Math.abs(curve.months.reduce((sum, month) => sum + month.programadoPct, 0) - 100) < 1e-8);
  if (session.body.workspaceDraft?.rows) {
    const reset = structuredClone(session.body.workspaceDraft); for (const row of reset.rows) { row.quantity = 1; row._formulas = {}; }
    assert.equal((await api(path, 'PATCH', { expectedRevision: session.body.workingRevision, draft: reset })).status, 200);
    session = await api(path);
  }
  console.log(JSON.stringify({ stage: 'Luna analysis verified', budgetItems: 597, recipes: 597, relativeSchedule: 597 }));
  await page.goto(origin + '/projects', { waitUntil: 'networkidle', timeout: 180000 });
  const resume = page.getByRole('region', { name: 'Planillas en preparación' }).getByRole('link', { name: /APU_Lote2/ });
  await resume.click(); await page.waitForURL(`**/projects/import/${fixture.sessionId}`);
  await page.getByRole('heading', { name: 'Workspace de obra · Importación', exact: true }).waitFor();
  await page.locator('[aria-label="Hoja de cómputo y presupuesto"] canvas').first().waitFor();
  await page.getByLabel('Celda', { exact: true }).fill(`D${editedIndex+1}`); await page.getByLabel('Valor o fórmula', { exact: true }).fill('=3*2');
  await Promise.all([page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'PATCH'), page.getByRole('button', { name: 'Aplicar celda', exact: true }).click()]);
  await page.getByRole('status').filter({ hasText: /^Guardado$/ }).waitFor();
  const saved = await api(path); assert.equal(saved.body.workspaceDraft.rows[editedIndex].quantity, 6); assert.equal(saved.body.workspaceDraft.rows[editedIndex]._formulas.quantity, '=3*2');
  const stale = await api(path, 'PATCH', { expectedRevision: session.body.workingRevision, draft: saved.body.workspaceDraft }); assert.equal(stale.status, 409);
  await page.reload({ waitUntil: 'networkidle', timeout: 180000 });
  assert.equal((await api(path)).body.workspaceDraft.rows[editedIndex].quantity, 6);
  await page.getByLabel('Partida activa', { exact: true }).selectOption(saved.body.workspaceDraft.rows[editedIndex]._rowId);
  await page.getByRole('tab', { name: 'APU', exact: true }).click();
  await page.getByRole('region', { name: 'Receta APU vinculada' }).waitFor();
  await page.getByRole('tab', { name: 'Materiales', exact: true }).click();
  await page.getByRole('region', { name: 'Materiales vinculados' }).waitFor();
  assert(await page.locator('[data-material-need]').count() > 20);
  const visibleNeed = await page.locator('[data-material-need]').evaluateAll((elements, key) => elements.find(el => el.getAttribute('data-material-need') === key)?.textContent, resourceKey);
  assert.equal(visibleNeed, expectedNeed.toLocaleString('es-PY', {maximumFractionDigits:6}));
  await page.getByRole('tab', { name: 'Cronograma', exact: true }).click();
  await page.getByRole('heading', { name: 'Cronograma · 597 partidas vinculadas', exact: true }).waitFor();
  await page.screenshot({ path: `${out}-schedule.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Original', exact: true }).click();
  await page.getByRole('region', { name: 'Fuente Excel conservada', exact: true }).waitFor({timeout:120000});
  await page.getByText('Fuente conservada · valores del documento', {exact:true}).waitFor();
  const download = page.waitForEvent('download', {timeout:60000});
  await page.getByRole('button', {name:'Descargar Excel original',exact:true}).click();
  const downloaded = await download;
  assert.equal(hash(fs.readFileSync(await downloaded.path())), hash(original));
  await page.getByRole('tab', { name: 'Revisión', exact: true }).click();
  await page.getByLabel('Nombre de obra', { exact: true }).fill('QA Lote 2 workspace completo');
  await page.getByLabel('Código de obra', { exact: true }).fill(`QA-L2-${stamp}`);
  await page.getByLabel('Régimen contractual', { exact: true }).selectOption('PUBLIC_WORK');
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^Guardado$/ }).waitFor();
  await page.getByRole('button', { name: 'Confirmar y crear obra', exact: true }).click();
  await page.waitForURL('**/planillas/**', { timeout: 180000 });
  await page.getByText('Workspace de obra · Cómputo y presupuesto', { exact: true }).waitFor();
  const confirmed = await api(path); assert.equal(confirmed.body.status, 'CONFIRMED'); assert(confirmed.body.confirmedProjectId);
  const projectId = confirmed.body.confirmedProjectId; fixture.projectId = projectId;
  fs.writeFileSync(`${out}-fixture.json`, JSON.stringify(fixture));
  const { data: items, error: ie } = await db.from('budget_items').select('id,code,quantity,unit_price,workbook_schedule').eq('project_id', projectId).order('sort_order'); if (ie) throw ie;
  assert.equal(items.length, 597); assert.equal(items[editedIndex].quantity, 6); assert.equal(items.filter(item => item.workbook_schedule).length, 597);
  const counts = {};
  for (const table of ['budget_item_materials', 'budget_item_labor', 'budget_item_equipment', 'budget_item_subcontracts', 'project_schedule_plans']) {
    const { count, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('project_id', projectId); if (error) throw error; counts[table] = count;
  }
  assert.equal(counts.budget_item_materials, 2199); assert.equal(counts.budget_item_labor, 1200); assert.equal(counts.budget_item_equipment, 896); assert.equal(counts.budget_item_subcontracts, 346); assert.equal(counts.project_schedule_plans, 1);
  const late = await api(path, 'PATCH', { expectedRevision: confirmed.body.workingRevision, draft: saved.body.workspaceDraft }); assert.equal(late.status, 409);
  for (const name of ['APU', 'Materiales', 'Cronograma', 'Partidas']) {
    await page.getByRole('tab', { name, exact: true }).click();
    if (name === 'Materiales') assert(await page.locator('[data-material-need]').count() > 20);
    if (name === 'Cronograma') await page.getByRole('heading', { name: 'Cronograma · 597 partidas vinculadas' }).waitFor();
  }
  await page.screenshot({ path: `${out}-operational.png`, fullPage: true });
  const { data: stored } = await admin.from('workbook_import_sessions').select('original_storage_path').eq('id', fixture.sessionId).single();
  const { data: source, error: se } = await db.storage.from('certificate-workbooks').download(stored.original_storage_path); if (se) throw se;
  assert.equal(hash(new Uint8Array(await source.arrayBuffer())), hash(original));
  assert.equal(hash(fs.readFileSync(filePath)), hash(original));
  const anonymous = await fetch(origin + path, { redirect: 'manual' }); assert.notEqual(anonymous.status, 200);
  const otherJar = new Map();
  const other = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...otherJar].map(([name,value]) => ({name,value})), setAll: values => values.forEach(({name,value}) => otherJar.set(name,value)) } });
  const {data:otherLink,error:otherLinkError} = await admin.auth.admin.generateLink({type:'magiclink',email:'marceloechauri@gmail.com'}); if(otherLinkError) throw otherLinkError;
  const {error:otherAuthError} = await other.auth.verifyOtp({type:'magiclink',token_hash:otherLink.properties.hashed_token}); if(otherAuthError) throw otherAuthError;
  const forbidden = await fetch(origin + path, {headers:{cookie:[...otherJar].map(([name,value])=>`${name}=${value}`).join('; ')},redirect:'manual'});
  assert.equal(forbidden.status,404); await other.auth.signOut({scope:'local'});
  assert.deepEqual(errors, []);
  const report = { origin, sessionId: fixture.sessionId, projectId, tenant: fixture.empresaId, sourceHash: hash(original), counts, browserErrors: errors, checks: ['upload opens workspace', 'Luna links real workbook', 'resume from Projects', 'formula edit/save/reopen', 'stale revision rejected', 'material needs follow edited quantity', 'four linked views before and after creation', 'original viewer/download', 'atomic linked materialization', 'closed import immutable', 'source byte-identical', 'other company denied', 'anonymous denied'] };
  fs.writeFileSync(`${out}-result.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await browser.close(); await db.auth.signOut({ scope: 'local' }); }
