// Explicitly pinned Preview runner. Never accepts a production connection.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {Client} = require('pg');
async function main() {
  const config = JSON.parse(fs.readFileSync(path.resolve('../batch-04-prebid-workspace/.env.preview-private.json'), 'utf8'));
  const connectionString = config.POSTGRES_URL_NON_POOLING;
  const url = new URL(connectionString);
  assert.equal(url.hostname, 'db.xddlzgjwufskgasomval.supabase.co');
  assert.equal(config.SUPABASE_URL, 'https://xddlzgjwufskgasomval.supabase.co');
  const db = new Client({connectionString, ssl: {rejectUnauthorized:false}});
  await db.connect();
  try {
    if (process.argv[2] === 'migrate') {
      const file = process.argv[3];
      assert.match(file, /^supabase[\\/]migrations[\\/]\d{14}_[a-z_]+\.sql$/);
      const version = path.basename(file).slice(0,14);
      const name = path.basename(file).slice(15,-4);
      const sql = fs.readFileSync(file,'utf8');
      await db.query('BEGIN');
      const ledger = await db.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
      const expected=fs.readdirSync('supabase/migrations').filter(f=>/^\d{14}_/.test(f)&&f.slice(0,14)<version).map(f=>f.slice(0,14)).sort();
      assert.deepEqual(ledger.rows.map(r=>r.version),expected);
      await db.query(sql);
      await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES($1,$2,$3)',[version,name,[sql]]);
      await db.query('COMMIT');
      console.log('Preview migration PASS',version);
    } else {
      await db.query('BEGIN');
      const sql=fs.readFileSync(process.argv[3],'utf8');
      const result=await db.query(sql);
      console.log(JSON.stringify(Array.isArray(result)?result.map(r=>r.rows):result.rows));
      await db.query('ROLLBACK');
    }
  } catch(e) {await db.query('ROLLBACK');throw e;}
  finally {await db.end();}
}
main().catch(e=>{console.error(e.message);process.exit(1);});
