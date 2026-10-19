// Live #19 regression: two independent PostgREST sessions emit full remissions at once.
// Runs only against the isolated preview and removes its own documents afterward.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const offset = line.indexOf('=');
    return [line.slice(0, offset), line.slice(offset + 1).replace(/^"|"$/g, '')];
  }));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
function assertIsolatedHost() {
  assert.equal(new URL(url).hostname, 'kyiihlkncatojvlasoag.supabase.co');
}
assertIsolatedHost();
const client = () => {
  assertIsolatedHost();
  return createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
};
const setup = client(), sessionA = client(), sessionB = client();
const must = result => { if (result.error) throw result.error; return result.data; };

async function main() {
  assertIsolatedHost();
  const acceptances = must(await setup.from('sales_quotation_acceptances')
    .select('sales_document_id,empresa_id,items_snapshot,total_snapshot')
    .order('accepted_at', { ascending: false }).limit(50));
  let quote, acceptance;
  for (const candidate of acceptances) {
    assertIsolatedHost();
    const children = must(await setup.from('sales_documents').select('id')
      .eq('source_document_id', candidate.sales_document_id).limit(1));
    if (children.length) continue;
    const found = must(await setup.from('sales_documents').select('*')
      .eq('id', candidate.sales_document_id).single());
    if (found.acceptance_status === 'ACCEPTED' && found.doc_type === 'PROFORMA') {
      quote = found; acceptance = candidate; break;
    }
  }
  assert.ok(quote, 'No unused accepted QA proforma in isolated preview');
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const tag = crypto.randomUUID().slice(0, 8);
  try {
    for (let i = 0; i < 2; i++) {
      assertIsolatedHost();
      must(await setup.from('sales_documents').insert({
        id: ids[i], empresa_id: quote.empresa_id, client_id: quote.client_id,
        code: `QA-CAP-${tag}-${i}`, doc_type: 'REMISION', source_document_id: quote.id,
        issue_date: quote.issue_date, currency: quote.currency, subtotal: quote.subtotal,
        vat_amount: quote.vat_amount, total: quote.total, status: 'BORRADOR',
        created_by: quote.created_by,
      }));
      assertIsolatedHost();
      must(await setup.from('sales_document_items').insert(acceptance.items_snapshot.map(item => ({
        empresa_id: quote.empresa_id, sales_document_id: ids[i],
        description: item.description, quantity: item.quantity, unit_price: item.unit_price,
        vat_rate: item.vat_rate, line_total: item.line_total,
      }))));
    }
    // Distinct clients make two concurrent HTTP requests / PostgreSQL transactions.
    assertIsolatedHost();
    const [a, b] = await Promise.all([
      sessionA.from('sales_documents').update({ status: 'EMITIDA' }).eq('id', ids[0]).select('id,status').single(),
      sessionB.from('sales_documents').update({ status: 'EMITIDA' }).eq('id', ids[1]).select('id,status').single(),
    ]);
    assertIsolatedHost();
    const states = must(await setup.from('sales_documents').select('id,status').in('id', ids));
    const emitted = states.filter(row => row.status === 'EMITIDA').length;
    console.log(JSON.stringify({ host: new URL(url).hostname, sessions: 2, emitted, outcomes: [a.error?.message ?? 'EMITIDA', b.error?.message ?? 'EMITIDA'] }));
    assert.equal(emitted, 1, 'Exactly one concurrent full remisión must emit');
    assert.equal([a, b].filter(result => !result.error).length, 1);
  } finally {
    for (const id of ids) {
      assertIsolatedHost();
      must(await setup.from('sales_document_items').delete().eq('sales_document_id', id).eq('empresa_id', quote.empresa_id));
      assertIsolatedHost();
      must(await setup.from('sales_documents').delete().eq('id', id).eq('empresa_id', quote.empresa_id));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
