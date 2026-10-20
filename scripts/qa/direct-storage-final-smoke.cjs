// Small real OCR smoke for the final build, after temporary-file lifecycle checks.
const { db, session, request, action, root, env, fs, path, assert, ref } = require('./phase6/context.cjs');
const { createClient } = require('@supabase/supabase-js');
const { createHash, randomUUID } = require('node:crypto');
(async () => {
  assert.equal(ref, 'kyiihlkncatojvlasoag');
  const s = await session();
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const bytes = fs.readFileSync(path.join(root, 'test/fixtures/invoices/c06-scan.pdf'));
  const unsigned = await anon.storage.from('direct-document-uploads').upload('unsigned-probe/' + randomUUID(), bytes, { contentType: 'application/pdf' });
  assert.ok(unsigned.error, 'unsigned upload must be rejected');
  const response = await request(s, '/api/document-uploads', { method: 'POST', headers: { origin: 'http://localhost:3018', 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { kind: 'internal' }, file: { name: 'c06-scan.pdf', type: 'application/pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }) });
  assert.equal(response.status, 200, 'final mint endpoint');
  const grant = await response.json();
  const upload = await anon.storage.from('direct-document-uploads').uploadToSignedUrl(grant.path, grant.token, bytes, { contentType: 'application/pdf' });
  assert.equal(upload.error, null, 'final signed upload');
  const form = new FormData(); form.set('file', grant.reference);
  const read = await action(s, '/invoices', 'extractInvoiceFromPhoto', [form]);
  assert.equal(read.data.error, null, 'final real scanned PDF OCR'); assert.equal(read.data.data.total, 110000);
  const remaining = await db.storage.from('direct-document-uploads').info(grant.path);
  assert.ok(remaining.error, 'temporary object must be consumed');
  const cancel = await request(s, '/api/document-uploads', { method: 'DELETE', headers: { origin: 'http://localhost:3018', 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { kind: 'internal' }, reference: grant.reference }) });
  assert.equal(cancel.status, 200, 'idempotent own-reference cleanup');
  const report = { project: ref, buildId: fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim(), checks: [
    'unsigned Storage upload rejected', 'final mint endpoint and Storage listing work', 'signed direct upload accepted',
    'real C06 scanned PDF read correctly', 'temporary object removed', 'cleanup by owned reference is idempotent',
  ], scannedPdfBytes: bytes.length, extractedTotal: read.data.data.total, status: 'PASS' };
  fs.writeFileSync(path.join(root, 'audit-evidence/direct-storage-20mib-2026-10-19/final-build-smoke.json'), JSON.stringify(report, null, 2));
  console.log('PASS final build: direct Storage, real scanned PDF OCR, private bucket and cleanup');
})().catch(error => { console.error('Final QA smoke failed: ' + String(error.message).slice(0, 400)); process.exitCode = 1; });
