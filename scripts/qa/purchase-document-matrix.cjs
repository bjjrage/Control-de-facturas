/* Real UI document regression matrix. No mocked routes or business DB writes.
 * Expected values are fixed independently of the model output. FAIL is retained.
 * Reuses the authenticated browser recorder, not the golden run's artifacts.
 */
const { stage, main, fs, path, crypto, assert, expect, root, base, companyId, projectId, v, one, rows, pdf } = require('./purchase-live-run.cjs');
const sourceRun = path.join(root, 'integration-evidence/purchase-e2e/QA-E2E-20261015034520');
const cases = {
  'pdf-vat5': { number: '002-015-0000201', subtotal: 100000, vat: 5000, total: 105000, items: [{ description: 'Cal agricola QA', quantity: 2, unit: 'bolsa', unit_price: 50000, subtotal: 100000 }], detail: ['Item: Cal agricola QA | Cantidad: 2 bolsa | Precio unitario SIN IVA: 50.000 | Importe linea SIN IVA: 100.000', 'IVA 5%: 5.000 PYG'], save: true },
  'pdf-exempt': { number: '002-015-0000202', subtotal: 70000, vat: 0, total: 70000, items: [{ description: 'Servicio exento QA', quantity: 7, unit: 'unid', unit_price: 10000, subtotal: 70000 }], detail: ['Item: Servicio exento QA | Cantidad: 7 unid | Precio unitario: 10.000 | Importe linea: 70.000', 'Operacion EXENTA - IVA 0%: 0 PYG'], save: true },
  'pdf-mixed': { number: '002-015-0000203', subtotal: 300000, vat: 20000, total: 320000, items: [{ description: 'Cemento mezcla QA', quantity: 2, unit: 'bolsa', unit_price: 50000, subtotal: 100000 }, { description: 'Cal mezcla QA', quantity: 4, unit: 'bolsa', unit_price: 50000, subtotal: 200000 }], detail: ['Item 1: Cemento mezcla QA | Cantidad: 2 bolsa | Precio unitario SIN IVA: 50.000 | Importe linea SIN IVA: 100.000 | IVA 10%: 10.000', 'Item 2: Cal mezcla QA | Cantidad: 4 bolsa | Precio unitario SIN IVA: 50.000 | Importe linea SIN IVA: 200.000 | IVA 5%: 10.000', 'Total IVA mixto: 20.000 PYG'], save: true },
  'png-vat10': { number: '002-015-0000204', subtotal: 100000, vat: 10000, total: 110000, items: [{ description: 'Ladrillo imagen QA', quantity: 2, unit: 'unid', unit_price: 55000, subtotal: 110000 }], detail: ['Item: Ladrillo imagen QA', 'Cantidad: 2 unid', 'Precio unitario CON IVA: 55.000 PYG', 'Importe impreso linea CON IVA: 110.000 PYG', 'IVA 10%: 10.000 PYG'], image: true, save: true },
  'scanned-pdf': { number: '002-015-0000205', subtotal: 100000, vat: 10000, total: 110000, items: [{ description: 'Ladrillo escaneo QA', quantity: 2, unit: 'unid', unit_price: 55000, subtotal: 110000 }], detail: ['Item: Ladrillo escaneo QA', 'Cantidad: 2 unid', 'Precio unitario CON IVA: 55.000 PYG', 'Importe impreso linea CON IVA: 110.000 PYG', 'IVA 10%: 10.000 PYG'], image: true, scan: true },
  'jpeg-vat5': { number: '002-015-0000211', subtotal: 100000, vat: 5000, total: 105000, items: [{ description: 'Cal foto JPEG QA', quantity: 2, unit: 'bolsa', unit_price: 50000, subtotal: 100000 }], detail: ['Item: Cal foto JPEG QA', 'Cantidad: 2 bolsa', 'Precio unitario SIN IVA: 50.000 PYG', 'Importe linea SIN IVA: 100.000 PYG', 'IVA 5%: 5.000 PYG'], image: true, imageType: 'jpeg', save: true },
};
function money(n) { return new Intl.NumberFormat('es-PY').format(n); }
function linesFor(state, c) { return ['FACTURA QA - SINTETICA NO FISCAL', state.providerName, 'RUC: ' + state.taxId, 'Factura Nro: ' + c.number, 'Fecha de emision: 15/10/2026', 'Vencimiento: 25/10/2026', 'Timbrado: 87654321', 'Moneda: PYG', ...c.detail, 'Subtotal SIN IVA de cabecera: ' + money(c.subtotal) + ' PYG', 'IVA TOTAL: ' + money(c.vat) + ' PYG', 'TOTAL CON IVA: ' + money(c.total) + ' PYG']; }
async function evidence(file, obj) { await fs.writeFile(file, JSON.stringify(obj, null, 2)); }
async function openInvoice(page, fromOrder, state) {
  await page.goto(fromOrder ? `${base}/projects/${projectId}/orders/${state.order.id}` : `${base}/invoices`);
  await v(page.getByRole('button', { name: fromOrder ? 'Cargar factura' : /^(\+ )?Nueva factura$/, exact: true })).click();
  return page.getByRole('dialog');
}
async function upload(page, d, file, prefix) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.next/server/server-reference-manifest.json'), 'utf8'));
  const ids = Object.entries(manifest.node).filter(([, e]) => e.exportedName === 'extractInvoiceFromPhoto').map(([id]) => id);
  assert.equal(ids.length, 1);
  const pending = page.waitForResponse(r => r.request().headers()['next-action'] === ids[0], { timeout: 100000 });
  await d.locator('input[type=file]').setInputFiles(file);
  const response = await pending;
  // The UI can receive its action value while the RSC stream remains open.
  // Record that separately; wait for the actual UI result, not EOF of the stream.
  await expect(d.getByRole('button', { name: /Leyendo/ })).toHaveCount(0, { timeout: 100000 });
  await expect(d.getByText(/Factura leída|RUC del emisor no coincide|No se pudo leer|No se pudo abrir|no tiene texto|no se detectó el proveedor/i).last()).toBeVisible({ timeout: 100000 });
  let timer;
  const streamFinished = await Promise.race([response.finished().then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
  clearTimeout(timer);
  await evidence(prefix + '-extraction-transport.json', { httpStatus: response.status(), clientReadCompleted: true, streamFinished, note: streamFinished ? null : 'RSC stream remained open after the UI received extraction; not counted as extraction failure.' });
  if (streamFinished) await fs.writeFile(prefix + '-extraction-flight.txt', await response.text());
}
async function values(d) {
  return d.locator('form').evaluate(form => Object.fromEntries(Array.from(new FormData(form).entries()).filter(([key]) => key !== 'file')));
}
async function generate(page, state, out, name, c) {
  const lines = linesFor(state, c);
  let file = path.join(out, name + '.pdf');
  if (c.image) {
    const fixture = await page.context().newPage();
    await fixture.setViewportSize({ width: 1000, height: 1200 });
    await fixture.setContent('<html><body style="margin:0;background:white;color:black;padding:40px;font:24px Arial;line-height:1.6"><pre style="white-space:pre-wrap;font:inherit">' + lines.join('\n') + '</pre></body></html>');
    const png = path.join(out, name + (c.imageType === 'jpeg' ? '.jpg' : '.png'));
    await fixture.screenshot({ path: png, fullPage: true });
    if (c.scan) {
      const bytes = await fs.readFile(png);
      await fixture.setContent('<html><body style="margin:0"><img style="width:100%" src="data:image/png;base64,' + bytes.toString('base64') + '"></body></html>');
      await fixture.pdf({ path: file, format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    } else file = png;
    await fixture.close();
  } else await pdf(file, lines);
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  state.matrixDocs[name] = { file, sha256, expected: c };
  return file;
}
for (const [name, c] of Object.entries(cases)) stage(name, 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  const file = await generate(page, state, out, name, c);
  const d = await openInvoice(page, false, state);
  await upload(page, d, file, artifactPrefix);
  const observed = await values(d);
  await evidence(artifactPrefix + '-expected-observed.json', { expected: c, observed });
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(c.number, { timeout: 15000 });
  assert.equal(observed.provider_id, state.provider.id);
  assert.equal(observed.invoice_date, '2026-10-15'); assert.equal(observed.due_date, '2026-10-25');
  for (const k of ['subtotal', 'vat', 'total']) assert.equal(Number(observed[k]), c[k], k);
  const items = JSON.parse(observed.items_json); assert.equal(items.length, c.items.length);
  c.items.forEach((expected, i) => { for (const [key, val] of Object.entries(expected)) assert.equal(key === 'quantity' ? Number(items[i][key]) : items[i][key], val, `item ${i} ${key}`); });
  if (!c.save || process.env.QA_EXTRACT_ONLY === "1") return;
  await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
  await page.waitForURL(/\/invoices\/[a-f0-9-]+\?/);
  const saved = await one(db, 'invoices', { provider_id: state.provider.id, invoice_number: c.number });
  const savedItems = await rows(db, 'invoice_items', { invoice_id: saved.id });
  const attachment = await one(db, 'attachments', { id: saved.attachment_id });
  const stored = await db.storage.from(attachment.bucket).download(attachment.path); if (stored.error) throw stored.error;
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex'), state.matrixDocs[name].sha256);
  for (const k of ['subtotal', 'vat', 'total']) assert.equal(Number(saved[k]), c[k]);
  assert.equal(saved.due_date, '2026-10-25'); assert.equal(savedItems.length, c.items.length);
  c.items.forEach((expected, i) => {
    const item = savedItems.find(x => x.product_description === expected.description); assert.ok(item);
    for (const key of ['quantity', 'unit_price', 'subtotal']) assert.equal(Number(item[key]), expected[key]);
  });
  state.matrixSaved[name] = saved;
  await evidence(artifactPrefix + '-database.json', { saved, savedItems, attachment });
});

stage('supplier-mismatch', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  const c = { ...cases['pdf-exempt'], number: '002-015-0000206' };
  const file = path.join(out, 'supplier-mismatch.pdf');
  await pdf(file, linesFor({ ...state, providerName: 'EMISOR DISTINTO QA', taxId: '88888888-2' }, c));
  const d = await openInvoice(page, true, state); await upload(page, d, file, artifactPrefix);
  const observed = await values(d); await evidence(artifactPrefix + '-form.json', observed);
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(c.number);
  // Real ordinary submit: no DOM tampering, no fabricated action request.
  await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
  await Promise.race([page.waitForURL(/\/invoices\/[a-f0-9-]+\?/), d.getByText(/Proveedor.*no coincide|RUC.*no coincide|emisor.*no coincide/i).waitFor()]);
  const persisted = await rows(db, 'invoices', { provider_id: state.provider.id, invoice_number: c.number });
  await evidence(artifactPrefix + '-database.json', { persisted, observed, expected: 'RUC distinto del proveedor de la OC debe bloquear la vinculación y guardado silencioso' });
  assert.deepEqual(persisted, [], 'A mismatched document was saved under the order supplier');
});

stage('replacement-missing-fields', 'admin', async ({ page, state, out, artifactPrefix }) => {
  const d = await openInvoice(page, false, state);
  await upload(page, d, state.matrixDocs['pdf-vat5'].file, artifactPrefix + '-first');
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(cases['pdf-vat5'].number);
  const file = path.join(out, 'replacement-missing.pdf');
  await pdf(file, ['DOCUMENTO QA INCOMPLETO - NO FISCAL', state.providerName, 'RUC: ' + state.taxId, 'Este documento NO informa numero de factura, fecha, importes ni timbrado.', 'Producto: Ensayo sin importes ni numero.']);
  await d.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await upload(page, d, file, artifactPrefix + '-replacement');
  const observed = await values(d); await evidence(artifactPrefix + '-observed.json', observed);
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue('');
  await expect(d.getByLabel('Importe con IVA incluido', { exact: true })).toHaveValue('');
  await expect(d.getByLabel('Timbrado', { exact: true })).toHaveValue('');
});

stage('corrupt-pdf', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  const before = await rows(db, 'invoices', { provider_id: state.provider.id }, 'id');
  const file = path.join(out, 'corrupt.pdf'); await fs.writeFile(file, '%PDF-1.7\nTHIS IS NOT A VALID PDF DOCUMENT QA');
  state.matrixDocs['corrupt-pdf'] = { file };
  const d = await openInvoice(page, false, state); await upload(page, d, file, artifactPrefix);
  await expect(d.getByText(/No se pudo abrir el PDF/)).toBeVisible();
  await expect(d.getByRole('button', { name: 'Crear factura', exact: true })).toBeDisabled();
  assert.deepEqual(await rows(db, 'invoices', { provider_id: state.provider.id }, 'id'), before);
});

stage('bulk-mixed-documents', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  const bulkStartedAt = new Date().toISOString();
  const file = path.join(out, 'bulk-new-vat5.pdf');
  const c = { ...cases['pdf-vat5'], number: '002-015-' + String(Date.now()).slice(-7) };
  await pdf(file, linesFor(state, c));
  await page.goto(base + '/invoices/bulk');
  await page.locator('main:visible input[type=file]').last().setInputFiles([file, state.matrixDocs['pdf-vat5'].file, state.matrixDocs['corrupt-pdf'].file]);
  await v(page.getByRole('button', { name: /^Subir 3 facturas$/ })).click();
  const query = async () => {
    const r = await db.from('invoice_jobs').select('*').eq('empresa_id', companyId).in('file_name', ['bulk-new-vat5.pdf', 'pdf-vat5.pdf', 'corrupt.pdf']).gte('created_at', bulkStartedAt);
    if (r.error) throw r.error; return r.data;
  };
  await expect.poll(async () => { const jobs = await query(); state.matrixBulkJobs = jobs; await evidence(artifactPrefix + '-jobs.json', jobs); return jobs.length === 3 && jobs.every(j => ['done', 'needs_review', 'failed'].includes(j.status)); }, { timeout: 90000, intervals: [1000, 4000] }).toBe(true);
  const jobs = state.matrixBulkJobs;
  assert.equal(jobs.find(j => j.file_name === 'pdf-vat5.pdf').outcome, 'duplicate');
  assert.ok(['needs_manual', 'error'].includes(jobs.find(j => j.file_name === 'corrupt.pdf').outcome));
  const newJob = jobs.find(j => j.file_name === 'bulk-new-vat5.pdf'); assert.ok(newJob.invoice_id);
  const saved = await one(db, 'invoices', { id: newJob.invoice_id }); assert.equal(saved.invoice_number, c.number); assert.equal(Number(saved.total), c.total);
  await evidence(artifactPrefix + '-database.json', { jobs, saved });
});

stage('bulk-due-date', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  const c = { ...cases['pdf-vat5'], number: '002-015-0000210' };
  const file = path.join(out, 'bulk-due-date-' + state.runId + '.pdf'); await pdf(file, linesFor(state, c));
  await page.goto(base + '/invoices/bulk');
  await page.locator('main:visible input[type=file]').last().setInputFiles(file);
  await v(page.getByRole('button', { name: 'Subir 1 factura', exact: true })).click();
  let jobs;
  await expect.poll(async () => { jobs = await rows(db, 'invoice_jobs', { empresa_id: companyId, file_name: path.basename(file) }); await evidence(artifactPrefix + '-jobs.json', jobs); return jobs.length === 1 && ['done', 'needs_review', 'failed'].includes(jobs[0].status); }, { timeout: 90000, intervals: [1000, 4000] }).toBe(true);
  assert.ok(jobs[0].invoice_id);
  const saved = await one(db, 'invoices', { id: jobs[0].invoice_id });
  await evidence(artifactPrefix + '-database.json', { saved, jobs, expectedDueDate: '2026-10-25' });
  assert.equal(saved.due_date, '2026-10-25', 'Bulk must retain the printed due date, as single upload does');
});

stage('mismatch-open-order', 'admin', async ({ page, db, state, out, artifactPrefix }) => {
  assert.equal(state.order.status, 'AUTORIZADO');
  const number = '002-015-0000212'; const file = path.join(out, 'mismatch-open-order.pdf');
  await pdf(file, ['FACTURA QA - SINTETICA NO FISCAL', 'EMISOR DISTINTO QA', 'RUC: 88888888-2', 'Factura Nro: ' + number, 'Fecha de emision: 15/10/2026', 'Vencimiento: 25/10/2026', 'Timbrado: 87654321', 'Moneda: PYG', 'Producto: ' + state.productName, 'Cantidad: 10 bolsa', 'Precio unitario CON IVA: 50.000 PYG', 'Subtotal SIN IVA de cabecera: 454.545,45 PYG', 'IVA 10%: 45.454,55 PYG', 'TOTAL CON IVA: 500.000 PYG']);
  const d = await openInvoice(page, true, state); await upload(page, d, file, artifactPrefix);
  await expect(d.getByLabel('N° de factura', { exact: true })).toHaveValue(number);
  const observed = await values(d); await evidence(artifactPrefix + '-form.json', observed);
  const notices = []; page.on('dialog', async dialog => { notices.push(dialog.message()); await dialog.dismiss(); });
  await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
  await page.waitForURL(/\/invoices\/[a-f0-9-]+\?/);
  const persisted = await rows(db, 'invoices', { provider_id: state.provider.id, invoice_number: number });
  state.mismatchInvoice = persisted[0];
  const links = persisted.length ? await rows(db, 'invoice_order_matches', { invoice_id: persisted[0].id }) : [];
  const items = persisted.length ? await rows(db, 'invoice_items', { invoice_id: persisted[0].id }) : [];
  await evidence(artifactPrefix + '-database.json', { persisted, links, items, observed, notices });
  assert.deepEqual(persisted, [], 'The foreign issuer document must not become an invoice of this supplier/OC');
});

stage('mismatch-payment-guard', 'admin', async ({ page, db, state, artifactPrefix }) => {
  assert.ok(state.mismatchInvoice, 'Requires evidence from the intentionally rejected supplier mismatch test');
  const before = await rows(db, 'payment_order_invoices', { invoice_id: state.mismatchInvoice.id });
  await page.goto(base + '/invoices/' + state.mismatchInvoice.id);
  const action = v(page.getByRole('button', { name: 'Marcar apto para pago', exact: true }));
  if (await action.count()) { await action.click(); await page.waitForURL(/\/pagos\/[a-f0-9-]+$/); }
  const after = await rows(db, 'payment_order_invoices', { invoice_id: state.mismatchInvoice.id });
  if (after[0]) state.mismatchPaymentOrder = await one(db, 'payment_orders', { id: after[0].payment_order_id });
  await evidence(artifactPrefix + '-database.json', { before, after, paymentOrder: state.mismatchPaymentOrder, invoice: await one(db, 'invoices', { id: state.mismatchInvoice.id }) });
  assert.deepEqual(after, [], 'Wrong issuer invoice should not be approved into a payment order');
});

stage('concurrent-duplicate', 'admin', async ({ page, context, db, state, out, artifactPrefix }) => {
  const c = { ...cases['pdf-vat5'], number: '002-015-0000213' };
  const file = path.join(out, 'concurrent-duplicate.pdf'); await pdf(file, linesFor(state, c));
  const attachmentQuery = () => db.from('attachments').select('id,path').eq('empresa_id', companyId).eq('bucket', 'invoice-files').like('path', state.provider.id + '/%');
  const before = await attachmentQuery(); if (before.error) throw before.error;
  const storageBefore = await db.storage.from('invoice-files').list(state.provider.id, { limit: 1000 }); if (storageBefore.error) throw storageBefore.error;
  const other = await context.newPage(); other.setDefaultTimeout(20000);
  const d1 = await openInvoice(page, false, state); await upload(page, d1, file, artifactPrefix + '-tab1');
  const d2 = await openInvoice(other, false, state); await upload(other, d2, file, artifactPrefix + '-tab2');
  const outcomes = [];
  async function submit(p, d) {
    await d.getByRole('button', { name: 'Crear factura', exact: true }).click();
    return Promise.race([p.waitForURL(/\/invoices\/[a-f0-9-]+\?/).then(() => 'created'), d.getByText('Ya existe una factura con ese número para este proveedor.', { exact: true }).waitFor().then(() => 'duplicate')]);
  }
  outcomes.push(...await Promise.all([submit(page, d1), submit(other, d2)]));
  const persisted = await rows(db, 'invoices', { provider_id: state.provider.id, invoice_number: c.number });
  const after = await attachmentQuery(); if (after.error) throw after.error;
  const storageAfter = await db.storage.from('invoice-files').list(state.provider.id, { limit: 1000 }); if (storageAfter.error) throw storageAfter.error;
  await evidence(artifactPrefix + '-database.json', { outcomes, persisted, before: before.data, after: after.data, storageBefore: storageBefore.data, storageAfter: storageAfter.data });
  await other.screenshot({ path: artifactPrefix + '-tab2.png', fullPage: true });
  assert.deepEqual(outcomes.sort(), ['created', 'duplicate']); assert.equal(persisted.length, 1);
  assert.equal(after.data.length, before.data.length + 1); assert.equal(storageAfter.data.length, storageBefore.data.length + 1);
  await other.close();
});

stage('receipt-overdelivery', 'public', async ({ page, context, db, state, out, artifactPrefix }) => {
  assert.equal((await context.cookies()).length, 0);
  const before = await rows(db, 'oc_recepciones', { order_id: state.order.id });
  const stockBefore = await rows(db, 'inventory_stock_by_project', { project_id: projectId, producto_id: state.product.id });
  const file = path.join(out, 'remito-overdelivery.pdf'); await pdf(file, ['REMITO QA NO FISCAL', 'Remito: QA-OVER-11', state.productName, 'Cantidad entregada: 11 bolsa', 'Recibido por: Depositero QA']);
  await page.goto(state.receiptUrl4);
  await page.getByLabel('Fecha de recepción', { exact: true }).fill('2026-10-15');
  await page.getByLabel('Recibido por', { exact: true }).fill('Depositero QA exceso');
  await page.getByLabel('Cantidad recibida ahora', { exact: true }).fill('11');
  await page.getByLabel('N.º de remisión', { exact: true }).fill('QA-OVER-11');
  await page.locator('input[type=file]').setInputFiles(file);
  const responses = []; page.on('response', r => { if (r.request().method() === 'POST' && r.url().includes('/api/recepcion-portal/')) responses.push(r); });
  const button = page.getByRole('button', { name: 'Confirmar recepción e ingresar al stock', exact: true });
  if (await button.isEnabled()) await button.click();
  await expect(page.getByText(/supera|excede|pendiente|máximo/i).last()).toBeVisible();
  const after = await rows(db, 'oc_recepciones', { order_id: state.order.id });
  const stockAfter = await rows(db, 'inventory_stock_by_project', { project_id: projectId, producto_id: state.product.id });
  await evidence(artifactPrefix + '-database.json', { before, after, stockBefore, stockAfter, postResponses: responses.map(r => ({ status: r.status() })) });
  assert.deepEqual(after, before); assert.deepEqual(stockAfter, stockBefore);
  await expect(page.getByRole('heading', { name: 'Recepción confirmada', exact: true })).toHaveCount(0);
});

stage('consumed-receipt-link', 'public', async ({ page, db, state, artifactPrefix }) => {
  assert.ok(state.receiptUrl6, 'Need a recorded consumed receipt URL');
  const url = state.receiptUrl6;
  await page.goto(url);
  await expect(page.getByRole('button', { name: /Confirmar recepción/ })).toHaveCount(0);
  const current = await rows(db, 'inventory_stock_by_project', { producto_id: state.product.id, project_id: projectId });
  assert.equal(current.reduce((s, x) => s + Number(x.quantity), 0), 10);
  await evidence(artifactPrefix + '-stock.json', current);
});

stage('wrong-product-unlinked', 'admin', async ({ db, state, artifactPrefix }) => {
  const invoice = state.matrixSaved['pdf-vat5']; assert.ok(invoice);
  const links = await rows(db, 'invoice_order_matches', { invoice_id: invoice.id });
  const itemLinks = await rows(db, 'invoice_item_matches', { empresa_id: companyId });
  const items = await rows(db, 'invoice_items', { invoice_id: invoice.id });
  const payments = await rows(db, 'payment_order_invoices', { invoice_id: invoice.id });
  const persisted = await one(db, 'invoices', { id: invoice.id });
  const order = await one(db, 'authorized_orders', { id: state.order.id });
  await evidence(artifactPrefix + '-database.json', { invoice: persisted, order, links, items, itemLinks: itemLinks.filter(m => items.some(i => i.id === m.invoice_item_id)), payments });
  assert.deepEqual(links, []); assert.deepEqual(payments, []); assert.equal(persisted.status, 'PENDIENTE'); assert.equal(Number(order.facturado_amount), 0);
});
async function start() {
  const resume = process.env.QA_MATRIX_RUN_DIR;
  const requested = process.argv.slice(2);
  const state = JSON.parse(await fs.readFile(path.join(resume || sourceRun, 'state.json'), 'utf8'));
  if (!resume) {
    state.runId = 'QA-MATRIX-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    state.matrixStarted = new Date().toISOString(); state.matrixDocs = {}; state.matrixSaved = {};
  }
  const out = path.join(root, 'integration-evidence/purchase-e2e', state.runId);
  await fs.mkdir(out, { recursive: true }); await evidence(path.join(out, 'state.json'), state);
  await fs.copyFile(__filename, path.join(out, 'matrix-executed-' + Date.now() + '.cjs'));
  await fs.copyFile(path.join(__dirname, 'purchase-live-run.cjs'), path.join(out, 'recorder-executed-' + Date.now() + '.cjs'));
  process.env.QA_RUN_DIR = out; process.env.QA_CONTINUE_ON_FAILURE = '1';
  process.argv = [process.argv[0], __filename, ...(requested.length ? requested : [...Object.keys(cases), 'supplier-mismatch', 'replacement-missing-fields', 'corrupt-pdf', 'bulk-mixed-documents', 'consumed-receipt-link'])];
  console.log(JSON.stringify({ matrixRun: state.runId, out, cases: process.argv.slice(2) }));
  await main();
}
start().catch(e => { console.error(e.stack); process.exitCode = 1; });
