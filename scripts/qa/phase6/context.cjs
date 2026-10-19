const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const root = path.resolve(__dirname, '../../..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env.local')));
const ref = 'kyiihlkncatojvlasoag';
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, ref + '.supabase.co');
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const out = path.join(root, 'audit-evidence/phase6-2026-10-19');
fs.mkdirSync(out, { recursive: true });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
async function session() {
 let jar = [];
 const auth = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => jar, setAll: c => { jar = c; } } });
 const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: 'recovery-admin@example.test' }));
 must(await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }));
 return { auth, jar, cookie: jar.map(c => c.name + '=' + c.value).join('; ') };
}
async function request(s, route, options = {}) {
 const base = process.env.QA_BASE || 'http://localhost:3018';
 assert.match(base, /^http:\/\/localhost:301[89]$/);
 return fetch(base + route, { ...options, headers: { cookie: s.cookie, ...options.headers }, signal: AbortSignal.timeout(120000) });
}
async function action(s, route, name, args) {
 const manifest = JSON.parse(fs.readFileSync(path.join(root, '.next/server/server-reference-manifest.json'), 'utf8'));
 const ids = Object.entries(manifest.node).filter(([, v]) => v.exportedName === name).map(([id]) => id);
 assert.equal(ids.length, 1, 'unique server action ' + name);
 let body, headers = { 'Next-Action': ids[0], origin: process.env.QA_BASE || 'http://localhost:3018' };
 if (args.some(a => a instanceof FormData)) {
  body = new FormData(); let n = 0;
  const values = args.map(a => { if (!(a instanceof FormData)) return a; const key = String(++n); for (const [k, v] of a) body.append('_' + key + '_' + k, v); return '$K' + key; });
  body.set('0', JSON.stringify(values));
 } else { body = JSON.stringify(args); headers['Content-Type'] = 'text/plain;charset=UTF-8'; }
 const r = await request(s, route, { method: 'POST', headers, body });
 const text = await r.text();
 const line = text.split('\n').find(l => /^1:/.test(l));
 let data; try { data = JSON.parse(line.slice(2)); } catch { data = { raw: text.slice(0, 1500) }; }
 return { status: r.status, data };
}
function save(name, value) { fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2)); }
module.exports = { root, out, ref, env, db, must, session, request, action, save, assert, fs, path };
