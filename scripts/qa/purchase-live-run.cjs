/* Real browser acceptance run. No route mocks, SQL writes or business API calls.
 * Supabase writes are limited to official authentication bootstrap. Business
 * records are created exclusively by clicks/forms/uploads in the application.
 * READ-ONLY service client is the independent persistence oracle.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const root = path.resolve(__dirname, '../..');
const base = 'http://localhost:3003';
const companyId = 'f775a9e6-30a6-4156-98f7-bfed0e8d87da';
const projectId = '86b8a8d7-0b15-4e30-b623-c1d3cfe260f8';
const v = locator => locator.filter({ visible: true });
const stages = {};
function stage(name, role, fn) { stages[name] = { role, fn }; }
async function one(db, table, filters, columns = '*') {
  let q = db.from(table).select(columns);
  for (const [k, val] of Object.entries(filters)) q = q.eq(k, val);
  const r = await q.single(); if (r.error) throw r.error; return r.data;
}
async function rows(db, table, filters, columns = '*') {
  let q = db.from(table).select(columns);
  for (const [k, val] of Object.entries(filters)) q = q.eq(k, val);
  const r = await q; if (r.error) throw r.error; return r.data;
}
async function pdf(file, lines) {
  // Keep every printed token inside the page: pdf.js clips text beyond its media box.
  const wrapped = lines.flatMap(line => { const out = []; let current = ''; for (const word of line.split(' ')) { if (current && current.length + word.length + 1 > 78) { out.push(current); current = word; } else current += (current ? ' ' : '') + word; } if (current) out.push(current); return out; });
  const text = 'BT\n/F1 11 Tf\n50 790 Td\n15 TL\n' + wrapped.map((s, i) => (i ? 'T*\n' : '') + '(' + s.replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&') + ') Tj').join('\n') + '\nET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`];
  let bytes = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(bytes)); bytes += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(bytes);
  bytes += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fs.writeFile(file, bytes); return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const env = require('dotenv').parse(await fs.readFile(path.join(root, '.env.local')));
  assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'kyiihlkncatojvlasoag.supabase.co', 'Refuse non-isolated database');
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const fresh = process.argv.includes('--fresh');
  const runId = 'QA-E2E-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const out = path.resolve(root, process.env.QA_RUN_DIR || (fresh ? `integration-evidence/purchase-e2e/${runId}` : 'integration-evidence/purchase-e2e/QA-E2E-20261015025348'));
  assert.ok(['purchase-e2e', 'sales-e2e'].some(folder => out.startsWith(path.join(root, 'integration-evidence', folder) + path.sep)));
  await fs.mkdir(out, { recursive: true });
  const stateFile = path.join(out, 'state.json');
  const state = fresh ? { runId, providerName: 'Proveedor ' + runId, productName: 'Cemento ' + runId, projectId, companyId, quantity: 10, unitPrice: 50000, total: 500000, taxId: '9999' + runId.slice(-4) + '-0', invoiceNumber: '001-001-0000101', treasuryName: 'Caja ' + runId, documentHashes: {} } : JSON.parse(await fs.readFile(stateFile, 'utf8'));
  if (fresh) {
    state.docs = { budget: path.join(out, 'presupuesto.pdf'), invoice: path.join(out, 'factura.pdf') };
    state.documentHashes.budget = await pdf(state.docs.budget, ['PRESUPUESTO QA - DOCUMENTO SINTETICO NO FISCAL', state.providerName, 'RUC: ' + state.taxId, 'Presupuesto: ' + runId, 'Fecha: 14/10/2026', 'Validez hasta: 30/11/2026', 'Moneda: PYG', 'Producto: ' + state.productName, 'Cantidad disponible: 10 bolsa', 'Precio unitario: 50.000 PYG - IVA 10% incluido', 'Subtotal sin IVA: 454.545,45 PYG', 'IVA 10%: 45.454,55 PYG', 'Total con IVA: 500.000 PYG', 'Flete: 0 PYG', 'Entrega: 2 dias', 'Forma de pago: Contado', 'Emite factura: Si']);
    state.documentHashes.invoice = await pdf(state.docs.invoice, ['FACTURA QA - DOCUMENTO SINTETICO NO FISCAL', state.providerName, 'RUC: ' + state.taxId, 'Factura Nro: ' + state.invoiceNumber, 'Fecha de emision: 14/10/2026', 'Vencimiento: 20/10/2026', 'Timbrado: 12345678', 'Moneda: PYG', 'Producto: ' + state.productName, 'Cantidad: 10 bolsa', 'Precio unitario con IVA: 50.000 PYG', 'Subtotal sin IVA: 454.545,45 PYG', 'IVA 10%: 45.454,55 PYG', 'TOTAL IVA INCLUIDO: 500.000 PYG', 'Condicion: Contado']);
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
  }
  assert.equal(state.companyId, companyId); assert.equal(state.projectId, projectId);
  const browser = await chromium.launch({ headless: true });
  const requested = process.argv.slice(2);
  const names = requested.includes('--all') ? ['provider', 'material', 'treasury', 'rfq', 'invite', 'supplier-quote', 'award', 'receipt-link-4', 'receipt-4', 'receipt-link-6', 'receipt-6', 'invoice-auto-read', 'payment-order', 'payment-treasury', 'negative-arithmetic', 'negative-duplicate', 'final-readback', 'dialog-stability'] : requested.filter(x => x !== '--fresh');
  assert.ok(names.length, 'Specify stage names or --all');
  try {
    for (const name of names) {
      const spec = stages[name]; assert.ok(spec, 'Unknown stage: ' + name);
      const attempt = Date.now();
      const artifactPrefix = path.join(out, `${name}-${attempt}`);
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, recordVideo: { dir: path.join(out, 'videos') }, acceptDownloads: true });
      if (spec.role === 'admin') {
        // Official OTP exchange for the existing isolated QA account. No role
        // change, fabricated JWT, database auth bypass or emailed invitation.
        let jar = [];
        const auth = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => jar, setAll: cs => { jar = cs; } } });
        const link = await db.auth.admin.generateLink({ type: 'magiclink', email: 'recovery-admin@example.test' });
        if (link.error) throw link.error;
        const login = await auth.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
        if (login.error) throw login.error;
        await context.addCookies(jar.map(c => ({ name: c.name, value: c.value, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' })));
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      }
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      const events = [];
      const safe = url => url.replace(/\/(cotizar|cotizacion|recepcion)\/[A-Za-z0-9_-]{32,}/g, '/$1/[token]');
      page.on('pageerror', e => events.push({ kind: 'pageerror', message: e.message }));
      page.on('requestfailed', r => events.push({ kind: 'requestfailed', url: safe(r.url()), failure: r.failure()?.errorText }));
      page.on('response', r => { if (r.request().method() !== 'GET' || r.status() >= 400) events.push({ kind: 'response', method: r.request().method(), url: safe(r.url()), status: r.status(), serverAction: !!r.request().headers()['next-action'] }); });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const result = { stage: name, role: spec.role, started: new Date().toISOString(), buildId: (await fs.readFile(path.join(root, '.next/BUILD_ID'), 'utf8')).trim() };
      try {
        await spec.fn({ page, context, db, state, out, artifactPrefix });
        result.status = 'PASS';
      } catch (e) {
        result.status = 'FAIL'; result.error = e.stack || String(e);
      } finally {
        result.finished = new Date().toISOString(); result.url = safe(page.url());
        await page.screenshot({ path: artifactPrefix + '.png', fullPage: true }).catch(() => {});
        await fs.writeFile(artifactPrefix + '.txt', await page.locator('body').innerText().catch(() => 'Body unavailable'));
        await fs.writeFile(artifactPrefix + '.network.json', JSON.stringify(events, null, 2));
        await context.tracing.stop({ path: artifactPrefix + '.zip' });
        await context.close();
        await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
        await fs.writeFile(artifactPrefix + '.result.json', JSON.stringify(result, null, 2));
        await fs.appendFile(path.join(out, 'results.jsonl'), JSON.stringify(result) + '\n');
      }
      console.log(JSON.stringify({ stage: name, status: result.status, artifacts: path.basename(artifactPrefix), error: result.status === 'FAIL' ? result.error : undefined }));
      if (result.status !== 'PASS') { process.exitCode = 1; if (process.env.QA_CONTINUE_ON_FAILURE !== '1') break; }
    }
  } finally { await browser.close(); }
}

// Stage definitions below are exercised against the live, prebuilt preview.

stage('provider', 'admin', async ({ page, db, state }) => {
  await page.goto(`${base}/providers`);
  await v(page.getByRole('button', { name: 'Nuevo proveedor', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Nombre', { exact: true }).fill(state.providerName);
  await d.getByLabel('Contacto', { exact: true }).fill('Responsable QA');
  await d.getByLabel('Email', { exact: true }).fill('compras-qa@example.test');
  await d.getByLabel('RUC', { exact: true }).fill(state.taxId);
  await d.getByLabel('Condiciones de pago', { exact: true }).fill('Contado - prueba aislada');
  await d.getByRole('button', { name: 'Guardar', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  await v(page.getByRole('link', { name: state.providerName, exact: true })).waitFor();
  state.provider = await one(db, 'providers', { name: state.providerName, empresa_id: companyId });
  assert.equal(state.provider.tax_id, state.taxId);
});

stage('material', 'admin', async ({ page, db, state }) => {
  await page.goto(`${base}/stock/nuevo`);
  await page.getByLabel('Nombre *', { exact: true }).fill(state.productName);
  await page.getByRole('combobox', { name: 'Unidad de compra *', exact: true }).click();
  await page.getByRole('option', { name: 'bolsa', exact: true }).click();
  await page.getByRole('button', { name: 'Crear material', exact: true }).click();
  await page.waitForURL(/\/stock\/[a-f0-9-]+$/);
  state.product = await one(db, 'productos', { nombre: state.productName, empresa_id: companyId });
  state.stockBefore = await rows(db, 'inventory_stock_by_project', { producto_id: state.product.id });
  assert.deepEqual(state.stockBefore, []);
});

stage('treasury', 'admin', async ({ page, db, state }) => {
  await page.goto(`${base}/tesoreria`);
  await v(page.getByRole('button', { name: '+ Cuenta', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Nombre *', { exact: true }).fill(state.treasuryName);
  await d.getByRole('combobox', { name: 'Tipo', exact: true }).click();
  await page.getByRole('option', { name: 'Caja', exact: true }).click();
  await d.getByLabel('Saldo inicial', { exact: true }).fill('1000000');
  await d.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  state.treasury = await one(db, 'cuentas_financieras', { nombre: state.treasuryName, empresa_id: companyId });
  assert.equal(Number(state.treasury.saldo), 1000000);
});

stage('rfq', 'admin', async ({ page, db, state }) => {
  await page.goto(`${base}/rfqs`);
  await v(page.getByRole('button', { name: 'Nueva solicitud', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Destino de la compra', exact: true }).click();
  await page.getByRole('option', { name: /RECOVERY-DEMO/ }).click();
  await d.getByRole('combobox', { name: 'Material del catálogo (opcional)', exact: true }).click();
  await page.getByRole('option', { name: state.productName + ' · bolsa', exact: true }).click();
  await d.getByLabel('Cantidad', { exact: true }).fill('10');
  await d.getByLabel('Fecha requerida', { exact: true }).fill('2026-10-20');
  await d.locator('summary').filter({ hasText: 'Más detalles' }).click();
  await d.getByLabel('Referencia interna', { exact: true }).fill(state.runId);
  await d.getByRole('button', { name: 'Crear RFQ', exact: true }).click();
  await page.waitForURL(/\/rfqs\/[a-f0-9-]+$/);
  state.rfqId = page.url().split('/').at(-1);
  state.rfq = await one(db, 'rfqs', { id: state.rfqId, empresa_id: companyId });
  assert.equal(state.rfq.project_id, projectId);
});

stage('invite', 'admin', async ({ page, state }) => {
  await page.goto(`${base}/rfqs/${state.rfqId}`);
  await v(page.getByRole('button', { name: 'Invitar proveedores', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.getByLabel(state.providerName, { exact: true }).check();
  await d.getByRole('button', { name: 'Invitar (1)', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  await v(page.getByRole('button', { name: 'Copiar enlace', exact: true })).click();
  state.quoteUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(state.quoteUrl, /^http:\/\/localhost:3003\/cotizar\/[a-f0-9]+$/);
});

stage('supplier-quote', 'supplier-no-login', async ({ page, context, state, artifactPrefix }) => {
  assert.equal((await context.cookies()).length, 0);
  await page.goto(state.quoteUrl);
  await page.locator('input[type=file]').setInputFiles(state.docs.budget);
  await page.getByLabel('Precio ' + state.productName, { exact: true }).fill('50000');
  await page.getByLabel('Disponibilidad ' + state.productName, { exact: true }).fill('10');
  await page.getByLabel('Impuesto ' + state.productName, { exact: true }).fill('10');
  await page.getByLabel('Entrega ' + state.productName, { exact: true }).fill('2');
  await page.getByLabel('Número de presupuesto', { exact: true }).fill(state.runId);
  await page.getByRole('combobox', { name: 'Moneda', exact: true }).click();
  await page.getByRole('option', { name: 'PYG', exact: true }).click();
  await page.getByLabel('Válida hasta', { exact: true }).fill('2026-11-30');
  await page.getByLabel('Flete fijo', { exact: true }).fill('0');
  await page.getByLabel('Los precios incluyen el impuesto indicado').check();
  await page.getByLabel('Emite factura', { exact: true }).check();
  await page.getByRole('combobox', { name: 'Forma de pago', exact: true }).selectOption('CONTADO');
  await page.screenshot({ path: artifactPrefix + '-before.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirmar y enviar', exact: true }).click();
  await page.getByText('Presupuesto registrado', { exact: true }).waitFor({ timeout: 90000 });
});

stage('quote-inspect', 'admin', async ({ page, state }) => {
  await page.goto(`${base}/rfqs/${state.rfqId}`);
  await v(page.getByRole('button', { name: new RegExp('Adjudicar') })).click();
  await page.getByRole('dialog').waitFor();
});

stage('award', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  await page.goto(`${base}/rfqs/${state.rfqId}`);
  await v(page.getByRole('button', { name: /Adjudicar/ })).click();
  const d = page.getByRole('dialog');
  // The digital PDF reader returns text but currently only extracts structured
  // spreadsheet facts. Do not pretend PDF reconciliation succeeded: verify
  // the stored original before exercising the explicit human-review path.
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: await fs.readFile(state.docs.budget) });
  let text; try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  for (const expected of [state.providerName, state.taxId, state.productName, '50.000', '500.000', '10 bolsa', '2 dias', '30/11/2026', 'Contado', 'IVA 10% incluido', 'Flete: 0']) assert.ok(text.includes(expected), 'Original missing ' + expected);
  await fs.writeFile(path.join(out, 'budget-original-read.txt'), text);
  const selects = d.locator('select[aria-label^="Resolución"]');
  state.quoteManualReviewCount = await selects.count();
  for (const select of await selects.all()) await select.selectOption('verified_original');
  await d.getByRole('radio', { name: 'Precio conveniente', exact: true }).check();
  await page.screenshot({ path: artifactPrefix + '-review.png', fullPage: true });
  await d.getByRole('button', { name: 'Adjudicar y revisar OC', exact: true }).click();
  await d.getByRole('button', { name: 'Emitir OC', exact: true }).waitFor({ timeout: 45000 });
  assert.ok((await d.innerText()).includes('500.000 PYG'));
  await page.screenshot({ path: artifactPrefix + '-oc-preview.png', fullPage: true });
  await d.getByRole('button', { name: 'Emitir OC', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  const order = await one(db, 'authorized_orders', { rfq_id: state.rfqId, empresa_id: companyId });
  assert.equal(order.project_id, projectId); assert.equal(Number(order.total_price), 500000);
  state.order = order;
});

for (const quantity of [4, 6]) {
  stage(`receipt-link-${quantity}`, 'admin', async ({ page, state }) => {
    await page.goto(`${base}/projects/${projectId}?tab=recepciones`);
    const row = v(page.getByRole('row').filter({ hasText: state.order.code }));
    await row.getByRole('button', { name: 'QR para recibir', exact: true }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Generar QR', exact: true }).click();
    await d.getByLabel('Enlace de recepción', { exact: true }).waitFor();
    state[`receiptUrl${quantity}`] = await d.getByLabel('Enlace de recepción', { exact: true }).inputValue();
    assert.match(state[`receiptUrl${quantity}`], /^http:\/\/localhost:3003\/recepcion\/[A-Za-z0-9_-]+$/);
  });
  stage(`receipt-${quantity}`, 'receiver-no-login', async ({ page, context, db, state, out, artifactPrefix }) => {
    assert.equal((await context.cookies()).length, 0, 'Receiver must not have internal session');
    const file = path.join(out, `remito-${quantity}.pdf`);
    const remito = `${state.runId}-REM-${quantity}`;
    state.documentHashes[`receipt${quantity}`] = await pdf(file, ['REMITO QA - NO FISCAL', state.providerName, 'OC: ' + state.order.code, 'Remito: ' + remito, 'Fecha: 15/10/2026', 'Recibido por: Depositero QA', 'Producto: ' + state.productName, `Cantidad entregada: ${quantity} bolsa`, 'Destino: Obra Recovery']);
    await page.goto(state[`receiptUrl${quantity}`]);
    await page.getByLabel('Fecha de recepción', { exact: true }).fill('2026-10-15');
    await page.getByLabel('Recibido por', { exact: true }).fill('Depositero QA ' + state.runId);
    await page.getByLabel('Cantidad recibida ahora', { exact: true }).fill(String(quantity));
    await page.getByLabel('N.º de remisión', { exact: true }).fill(remito);
    await page.locator('input[type=file]').setInputFiles(file);
    await page.screenshot({ path: artifactPrefix + '-before.png', fullPage: true });
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/recepcion-portal/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmar recepción e ingresar al stock', exact: true }).click();
    const response = await responsePromise;
    const body = await response.json();
    await fs.writeFile(artifactPrefix + '-response.json', JSON.stringify({ status: response.status(), body }, null, 2));
    assert.equal(response.status(), 201); assert.equal(body.status, 'CONFIRMED');
    await page.getByRole('heading', { name: 'Recepción confirmada', exact: true }).waitFor();
    state[`receiptId${quantity}`] = body.receiptId;
    const stock = await one(db, 'inventory_stock_by_project', { project_id: projectId, producto_id: state.product.id });
    const expected = quantity === 4 ? 4 : 10;
    assert.equal(Number(stock.quantity), expected);
    assert.equal(Number(stock.total_cost), expected * state.unitPrice);
    state[`stockAfter${quantity}`] = stock;
    // Fresh browser navigation to the consumed link must not offer a new submit.
    await page.screenshot({ path: artifactPrefix + '-confirmed.png', fullPage: true });
    const replay = await page.reload();
    assert.equal(replay.status(), 404, 'Consumed receipt link must be rejected by the server');
    assert.equal(await page.getByRole('button', { name: 'Confirmar recepción e ingresar al stock', exact: true }).count(), 0);
    const afterReload = await one(db, 'inventory_stock_by_project', { project_id: projectId, producto_id: state.product.id });
    assert.equal(Number(afterReload.quantity), expected);
  });
}

stage('invoice-auto-read', 'admin', async ({ page, db, state, artifactPrefix }) => {
  await page.goto(`${base}/projects/${projectId}/orders/${state.order.id}`);
  await v(page.getByRole('button', { name: 'Cargar factura', exact: true })).click();
  const d = page.getByRole('dialog');
  // The only invoice input action is selecting the actual PDF. No fill() of
  // number/date/provider/amount/IVA/items is allowed in this acceptance stage.
  await d.locator('input[type=file]').setInputFiles(state.docs.invoice);
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(state.invoiceNumber, { timeout: 90000 });
  await expect(d.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-14');
  await expect(d.getByLabel('Vencimiento', { exact: true })).toHaveValue('2026-10-20');
  await expect(d.getByLabel('Importe con IVA incluido', { exact: true })).toHaveValue('500000');
  await expect(d.getByLabel('Timbrado', { exact: true })).toHaveValue('12345678');
  const values = await d.locator('input').evaluateAll(es => Object.fromEntries(es.filter(e => e.name).map(e => [e.name, e.value])));
  assert.equal(values.provider_id, state.provider.id);
  assert.equal(Number(values.total), 500000);
  assert.ok(Math.abs(Number(values.subtotal) + Number(values.vat) - 500000) < 0.02);
  const items = JSON.parse(values.items_json);
  assert.equal(items.length, 1); assert.equal(Number(items[0].quantity), 10);
  assert.equal(items[0].description, state.productName);
  assert.equal(items[0].unit, 'bolsa'); assert.equal(Number(items[0].unit_price), 50000);
  assert.equal(items[0].subtotal, null, 'Do not invent a line amount from the invoice header');
  state.invoiceAutoValues = { ...values, items };
  await page.screenshot({ path: artifactPrefix + '-auto-filled.png', fullPage: true });
  assert.equal(await d.getByLabel('Verifiqué los importes contra el documento y asumo la discrepancia.').count(), 0, 'No arithmetic exception allowed');
  const warnings = [];
  page.on('dialog', async dialog => { warnings.push(dialog.message()); await dialog.dismiss(); });
  await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
  await page.waitForURL(/\/invoices\/[a-f0-9-]+\?/);
  state.invoice = await one(db, 'invoices', { provider_id: state.provider.id, invoice_number: state.invoiceNumber });
  assert.equal(state.invoice.status, 'MATCH');
  assert.equal(state.invoice.due_date, '2026-10-20');
  assert.equal(Number(state.invoice.total), 500000);
  assert.deepEqual(warnings, [], 'Invoice save emitted a warning');
  const links = await rows(db, 'invoice_order_matches', { invoice_id: state.invoice.id });
  assert.equal(links.length, 1); assert.equal(links[0].authorized_order_id, state.order.id);
  const savedItems = await rows(db, 'invoice_items', { invoice_id: state.invoice.id });
  assert.equal(savedItems.length, 1); assert.equal(Number(savedItems[0].quantity), 10);
  const matches = await rows(db, 'invoice_item_matches', { invoice_item_id: savedItems[0].id });
  assert.equal(matches.length, 1); assert.equal(Number(matches[0].quantity_matched), 10);
  state.invoiceLinks = links; state.invoiceItems = savedItems; state.invoiceItemMatches = matches;
});

stage('payment-order', 'admin', async ({ page, db, state }) => {
  await page.goto(`${base}/invoices/${state.invoice.id}`);
  await v(page.getByRole('button', { name: 'Marcar apto para pago', exact: true })).click();
  await page.waitForURL(/\/pagos\/[a-f0-9-]+$/);
  state.paymentOrder = await one(db, 'payment_orders', { id: page.url().split('/').at(-1) });
  assert.equal(state.paymentOrder.provider_id, state.provider.id);
  assert.equal(state.paymentOrder.status, 'EMITIDA');
  state.paymentInvoices = await rows(db, 'payment_order_invoices', { payment_order_id: state.paymentOrder.id });
  assert.equal(state.paymentInvoices.length, 1); assert.equal(state.paymentInvoices[0].invoice_id, state.invoice.id);
});

stage('payment-treasury', 'admin', async ({ page, db, state }) => {
  await page.goto(`${base}/pagos/${state.paymentOrder.id}`);
  await v(page.getByRole('button', { name: 'Registrar pago', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Sale de la cuenta', exact: true }).click();
  await page.getByRole('option', { name: state.treasuryName + ' (PYG)', exact: true }).click();
  await d.getByRole('button', { name: 'Confirmar pago', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
  state.paymentOrderAfter = await one(db, 'payment_orders', { id: state.paymentOrder.id });
  state.invoiceAfter = await one(db, 'invoices', { id: state.invoice.id });
  state.treasuryAfter = await one(db, 'cuentas_financieras', { id: state.treasury.id });
  assert.equal(state.paymentOrderAfter.status, 'EJECUTADA');
  assert.equal(state.paymentOrderAfter.cuenta_id, state.treasury.id);
  assert.equal(state.invoiceAfter.status, 'PAGADO');
  assert.equal(Number(state.treasuryAfter.saldo), 500000);
  state.treasuryMovements = await rows(db, 'movimientos_tesoreria', { payment_order_id: state.paymentOrder.id });
  assert.equal(state.treasuryMovements.length, 1);
  assert.equal(Number(state.treasuryMovements[0].monto), -500000);
  assert.equal(state.treasuryMovements[0].cuenta_id, state.treasury.id);
});

stage('negative-arithmetic', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  const number = '001-001-0000102';
  const file = path.join(out, 'factura-inconsistente.pdf');
  state.documentHashes.invalidInvoice = await pdf(file, ['FACTURA QA INCONSISTENTE - NO FISCAL', state.providerName, 'RUC: ' + state.taxId, 'Factura Nro: ' + number, 'Fecha: 14/10/2026', 'Moneda: PYG', 'Producto: ' + state.productName, 'Cantidad: 10 bolsa', 'Precio unitario con IVA: 50.000 PYG', 'Importe impreso de esta linea: 400.000 PYG', 'Subtotal sin IVA de cabecera: 363.636,36 PYG', 'IVA 10%: 36.363,64 PYG', 'TOTAL: 400.000 PYG']);
  await page.goto(`${base}/projects/${projectId}/orders/${state.order.id}`);
  await v(page.getByRole('button', { name: 'Cargar factura', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.locator('input[type=file]').setInputFiles(file);
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(number, { timeout: 90000 });
  const acknowledgement = d.getByLabel('Verifiqué los importes contra el documento y asumo la discrepancia.');
  await expect(acknowledgement).toBeVisible(); await expect(acknowledgement).not.toBeChecked();
  const inputs = JSON.parse(await d.locator('input[name=items_json]').inputValue());
  assert.equal(Number(inputs[0].unit_price), 50000); assert.equal(Number(inputs[0].subtotal), 400000);
  // Identify the actual createInvoice request, not unrelated background read
  // actions on the same URL. Observe its public action ID from this build.
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.next/server/server-reference-manifest.json'), 'utf8'));
  const actionIds = Object.entries(manifest.node).filter(([, entry]) => entry.exportedName === 'createInvoice').map(([id]) => id);
  assert.equal(actionIds.length, 1);
  const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && r.request().headers()['next-action'] === actionIds[0]);
  await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
  const response = await responsePromise; await response.finished();
  await fs.writeFile(artifactPrefix + '-server-response.txt', await response.text());
  // Assert the rendered Server Action error, not the encoded Flight wire text.
  // This wording is returned by createInvoice; the client preview uses a
  // different message and is already visible before submitting.
  await expect(d.getByText(/Corregí los importes o confirmá explícitamente/)).toBeVisible();
  await expect(d).toBeVisible();
  const invoices = await rows(db, 'invoices', { provider_id: state.provider.id, invoice_number: number });
  assert.deepEqual(invoices, []);
  await page.screenshot({ path: artifactPrefix + '-blocked.png', fullPage: true });
});

stage('negative-duplicate', 'admin', async ({ page, db, state, artifactPrefix }) => {
  const attachmentQuery = () => db.from('attachments').select('id,path').eq('empresa_id', companyId).eq('bucket', 'invoice-files').like('path', state.provider.id + '/%');
  const before = await attachmentQuery(); if (before.error) throw before.error;
  const storedBefore = await db.storage.from('invoice-files').list(state.provider.id, { limit: 1000 });
  if (storedBefore.error) throw storedBefore.error;
  const priorInvoices = await rows(db, 'invoices', { provider_id: state.provider.id });
  const existingOriginals = priorInvoices.map(i => i.attachment_id).filter(Boolean).sort();
  assert.deepEqual(before.data.map(a => a.id).sort(), existingOriginals, 'Every existing original must belong to a persisted invoice; matrix cases may add valid originals');
  await page.goto(`${base}/projects/${projectId}/orders/${state.order.id}`);
  await v(page.getByRole('button', { name: 'Cargar factura', exact: true })).click();
  const d = page.getByRole('dialog');
  await d.locator('input[type=file]').setInputFiles(state.docs.invoice);
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(state.invoiceNumber, { timeout: 90000 });
  await expect(d.getByLabel('Importe con IVA incluido', { exact: true })).toHaveValue('500000');
  await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
  await d.getByText('Ya existe una factura con ese número para este proveedor.', { exact: true }).waitFor();
  const invoices = await rows(db, 'invoices', { provider_id: state.provider.id, invoice_number: state.invoiceNumber });
  assert.equal(invoices.length, 1); assert.equal(invoices[0].status, 'PAGADO');
  const after = await attachmentQuery(); if (after.error) throw after.error;
  const storedAfter = await db.storage.from('invoice-files').list(state.provider.id, { limit: 1000 });
  if (storedAfter.error) throw storedAfter.error;
  assert.deepEqual(after.data.map(a => a.id).sort(), before.data.map(a => a.id).sort());
  assert.deepEqual(storedAfter.data.map(a => a.name).sort(), storedBefore.data.map(a => a.name).sort());
  state.duplicateArtifacts = { before: before.data, after: after.data, storedBefore: storedBefore.data.map(a => a.name), storedAfter: storedAfter.data.map(a => a.name) };
  await page.screenshot({ path: artifactPrefix + '-blocked.png', fullPage: true });
});

stage('final-readback', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  state.receipts = await rows(db, 'oc_recepciones', { order_id: state.order.id });
  assert.equal(state.receipts.length, 2);
  for (const receipt of state.receipts) {
    assert.equal(receipt.status, 'CONFIRMED'); assert.equal(receipt.confirmed_by, null);
    assert.equal(receipt.recibido_por, 'Depositero QA ' + state.runId);
  }
  state.receiptItems = [];
  state.receiptEvidence = [];
  for (const receipt of state.receipts) {
    state.receiptItems.push(...await rows(db, 'oc_recepcion_items', { recepcion_id: receipt.id }));
    const files = await rows(db, 'inventory_receipt_evidence', { receipt_id: receipt.id });
    assert.equal(files.length, 1);
    for (const file of files) {
      const download = await db.storage.from(file.storage_bucket).download(file.storage_path);
      if (download.error) throw download.error;
      const sha = crypto.createHash('sha256').update(Buffer.from(await download.data.arrayBuffer())).digest('hex');
      const quantity = file.file_name.includes('remito-4') ? 4 : 6;
      assert.equal(sha, state.documentHashes[`receipt${quantity}`]);
      state.receiptEvidence.push({ ...file, downloadedSha256: sha });
    }
  }
  assert.equal(state.receiptItems.length, 2);
  assert.equal(state.receiptItems.reduce((sum, item) => sum + Number(item.cantidad_recibida), 0), 10);
  for (const item of state.receiptItems) assert.equal(item.producto_id, state.product.id);
  const movementIds = state.receiptItems.map(i => i.inventory_movement_id);
  const movements = await db.from('inventory_movements').select('*').in('id', movementIds);
  if (movements.error) throw movements.error;
  assert.equal(movements.data.length, 2);
  for (const movement of movements.data) {
    assert.equal(movement.status, 'CONFIRMED');
    assert.equal(movement.metadata.confirmation_source, 'RECEIPT_PORTAL');
    assert.equal(movement.metadata.received_by, 'Depositero QA ' + state.runId);
  }
  state.inventoryMovements = movements.data;
  const ids = [state.invoice.attachment_id];
  const quote = await one(db, 'quote_versions', { id: state.order.quote_version_id });
  state.quoteVersion = quote; ids.push(quote.pdf_attachment_id);
  state.originals = [];
  for (const id of ids) {
    const attachment = await one(db, 'attachments', { id, empresa_id: companyId });
    const download = await db.storage.from(attachment.bucket).download(attachment.path);
    if (download.error) throw download.error;
    const sha = crypto.createHash('sha256').update(Buffer.from(await download.data.arrayBuffer())).digest('hex');
    const expected = id === state.invoice.attachment_id ? state.documentHashes.invoice : state.documentHashes.budget;
    assert.equal(sha, expected); state.originals.push({ id, bucket: attachment.bucket, path: attachment.path, downloadedSha256: sha });
  }
  state.stockFinal = await one(db, 'inventory_stock_by_project', { project_id: projectId, producto_id: state.product.id });
  state.orderFinal = await one(db, 'authorized_orders', { id: state.order.id });
  assert.equal(Number(state.stockFinal.quantity), 10); assert.equal(Number(state.stockFinal.total_cost), 500000);
  assert.equal(Number(state.orderFinal.facturado_amount), 500000);
  await page.goto(`${base}/projects/${projectId}?tab=inventario`);
  await v(page.getByRole('row').filter({ hasText: state.productName })).waitFor();
  await page.screenshot({ path: artifactPrefix + '-stock.png', fullPage: true });
  await page.goto(`${base}/pagos/${state.paymentOrder.id}`);
  await v(page.getByRole('heading', { name: state.paymentOrder.code, exact: true })).waitFor();
  assert.equal(await v(page.getByRole('button', { name: 'Registrar pago', exact: true })).count(), 0);
  await fs.writeFile(path.join(out, 'final-database-evidence.json'), JSON.stringify(state, (key, value) => /Url/.test(key) ? '[scoped token omitted]' : value, 2));
});

stage('dialog-stability', 'admin', async ({ page, state, artifactPrefix }) => {
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await page.goto(`${base}/projects/${projectId}/orders/${state.order.id}`);
    await v(page.getByRole('button', { name: 'Cargar factura', exact: true })).click();
    const d = page.getByRole('dialog');
    await expect(d).toBeVisible();
    // Intentional observation window: detect a modal being replaced while
    // real background Server Actions complete; this is not a readiness sleep.
    await page.waitForTimeout(3500);
    await expect(d).toBeVisible();
    assert.equal(await d.locator('input[type=file]').count(), 1);
    samples.push({ iteration: i + 1, remainedVisible: true });
    await d.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await d.waitFor({ state: 'hidden' });
  }
  await fs.writeFile(artifactPrefix + '-samples.json', JSON.stringify(samples, null, 2));
});

module.exports = { stage, main, fs, path, crypto, assert, expect, root, base, companyId, projectId, v, one, rows, pdf };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
