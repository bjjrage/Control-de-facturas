// Uses the final local build and the named isolated database only. No mock OCR.
const { db, must, session, action, root, fs, path, assert } = require('./context.cjs');
const { createHash } = require('node:crypto');
const out = path.join(root, 'audit-evidence/c06-u1-2026-10-19');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const s = await session();
  const bytes = fs.readFileSync(path.join(root, 'test/fixtures/invoices/c06-scan.pdf'));
  const fd = new FormData(); fd.set('file', new File([bytes], 'c06-scan.pdf', { type: 'application/pdf' }));
  const read = await action(s, '/invoices', 'extractInvoiceFromPhoto', [fd]);
  assert.equal(read.status, 200); assert.equal(read.data.error, null, JSON.stringify(read.data));
  const data = read.data.data;
  assert.equal(data.total, 110000); assert.equal(data.subtotal, 100000); assert.equal(data.vat, 10000);
  assert.equal(data.invoice_number, '009-006-0000001'); assert.equal(data.invoice_date, '2026-10-19');
  assert.equal(data.provider_tax_id.replace(/\D/g, ''), '800999991'); assert.equal(data.currency, 'PYG');
  assert.ok(data.extraction_proof);
  const empresa = 'f775a9e6-30a6-4156-98f7-bfed0e8d87da';
  let provider = must(await db.from('providers').select('id,tax_id').eq('empresa_id', empresa).eq('tax_id', '80099999-1').maybeSingle());
  if (!provider) provider = must(await db.from('providers').insert({ empresa_id: empresa, name: 'QA C06 escaneo - no fiscal', tax_id: '80099999-1' }).select('id,tax_id').single());
  const create = new FormData();
  for (const [k, v] of Object.entries({ provider_id: provider.id, invoice_number: data.invoice_number, invoice_date: data.invoice_date, currency: data.currency, subtotal: data.subtotal, vat: data.vat, total: data.total, extraction_proof: data.extraction_proof, items_json: JSON.stringify(data.items), arithmetic_confirmed: 'on' })) create.set(k, String(v));
  create.set('file', new File([Buffer.concat([bytes, Buffer.from('changed')])], 'c06-scan.pdf', { type: 'application/pdf' }));
  const tampered = await action(s, '/invoices', 'createInvoice', [create]);
  assert.match(tampered.data.error, /otro archivo|lectura/);
  create.set('file', new File([bytes], 'c06-scan.pdf', { type: 'application/pdf' }));
  let invoice = must(await db.from('invoices').select('id,attachment_id,status,total').eq('empresa_id', empresa).eq('provider_id', provider.id).eq('invoice_number', data.invoice_number).maybeSingle());
  let saved;
  if (!invoice) {
    saved = await action(s, '/invoices', 'createInvoice', [create]);
    assert.equal(saved.data.error, null, JSON.stringify(saved.data));
    invoice = must(await db.from('invoices').select('id,attachment_id,status,total').eq('id', saved.data.id).single());
  }
  const verified = await action(s, '/invoices/' + invoice.id, 'verifyInvoiceOriginal', [invoice.id]);
  assert.equal(verified.data.error, null, JSON.stringify(verified.data));
  const attachment = must(await db.from('attachments').select('bucket,path,mime_type').eq('id', invoice.attachment_id).single());
  const original = must(await db.storage.from(attachment.bucket).download(attachment.path));
  const downloaded = Buffer.from(await original.arrayBuffer());
  assert.deepEqual(downloaded, bytes);
  const identity = must(await db.from('invoice_identity_evidence').select('invoice_id,attachment_id,invoice_number,total,currency').eq('invoice_id', invoice.id).single());
  assert.equal(identity.attachment_id, invoice.attachment_id); assert.equal(Number(identity.total), 110000);
  const { extraction_proof, ...publicFields } = data;
  const evidence = { ref: 'kyiihlkncatojvlasoag', buildId: fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim(), extraction: publicFields, tamperedFileRejected: true, invoice, verified: verified.data, identity, originalSha256: createHash('sha256').update(downloaded).digest('hex'), originalBytesPreserved: true };
  fs.writeFileSync(path.join(out, 'c06-live.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS C06: actual scanned PDF → vision → invoice → original verification → identical Storage original', invoice.id);
})().catch(e => { console.error(e); process.exitCode = 1; });
