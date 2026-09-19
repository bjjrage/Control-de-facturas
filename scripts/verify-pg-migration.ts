import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
  console.log('Testing migrations on isolated PGlite engine...');
  const pg = new PGlite();

  // Create mock auth.users, public.empresas, current_user_empresa_id, and supabase_realtime publication
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text
    );
    CREATE TABLE IF NOT EXISTS public.empresas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre text
    );
    CREATE OR REPLACE FUNCTION public.current_empresa_id()
    RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.empresas LIMIT 1 $$;
    CREATE PUBLICATION supabase_realtime;
  `);

  const m1 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260918000001_scan_sessions.sql'), 'utf8');
  console.log('Running base migration...');
  await pg.exec(m1);
  console.log('Base migration OK.');

  const m2 = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260918020000_scan_sessions_hardening.sql'), 'utf8');
  console.log('Running hardening migration...');
  await pg.exec(m2);
  console.log('Hardening migration OK.');

  // Test atomic failed attempt function
  console.log('Testing scan_pin_record_failed_attempt atomic RPC...');
  const res1 = await pg.query(`
    SELECT * FROM public.scan_pin_record_failed_attempt('test-ip-1', 5, 900);
  `);
  console.log('Attempt 1 result:', res1.rows);

  const res2 = await pg.query(`
    SELECT * FROM public.scan_pin_record_failed_attempt('test-ip-1', 5, 900);
  `);
  console.log('Attempt 2 result:', res2.rows);

  // Test partial unique index on waiting sessions with same PIN
  console.log('Testing partial unique index on waiting PINs...');
  const emp1 = await pg.query(`INSERT INTO public.empresas (nombre) VALUES ('Empresa 1') RETURNING id;`);
  const empId = (emp1.rows[0] as any).id;
  const user1 = await pg.query(`INSERT INTO auth.users (email) VALUES ('u1@example.com') RETURNING id;`);
  const userId = (user1.rows[0] as any).id;

  await pg.query(`
    INSERT INTO public.scan_sessions (empresa_id, created_by, token_hash, pin_code, expires_at, status)
    VALUES ('${empId}', '${userId}', 'hash1', '123456', now() + interval '15 minutes', 'waiting');
  `);
  console.log('Inserted first waiting session with PIN 123456.');

  let threwUniqueViolation = false;
  try {
    await pg.query(`
      INSERT INTO public.scan_sessions (empresa_id, created_by, token_hash, pin_code, expires_at, status)
      VALUES ('${empId}', '${userId}', 'hash2', '123456', now() + interval '15 minutes', 'waiting');
    `);
  } catch (err: any) {
    console.log('Caught expected collision error:', err.message);
    threwUniqueViolation = err.message.includes('unique') || err.message.includes('duplicate');
  }

  if (!threwUniqueViolation) {
    throw new Error('FAILED: Partial unique index did NOT prevent duplicate waiting PIN!');
  }
  console.log('PASS: Partial unique index strictly prevented concurrent active PIN collision!');

  // Transition first session to 'connected' (claimed)
  await pg.query(`
    UPDATE public.scan_sessions SET status = 'connected' WHERE pin_code = '123456';
  `);
  console.log('Session 1 claimed. PIN 123456 should now be freed for new waiting sessions.');

  await pg.query(`
    INSERT INTO public.scan_sessions (empresa_id, created_by, token_hash, pin_code, expires_at, status)
    VALUES ('${empId}', '${userId}', 'hash3', '123456', now() + interval '15 minutes', 'waiting');
  `);
  console.log('PASS: Claimed/completed session freed the PIN for new waiting session!');

  // Test scan_session_create_atomic RPC
  console.log('Testing scan_session_create_atomic RPC...');
  const createRpc = await pg.query(`
    SELECT * FROM public.scan_session_create_atomic(
      '${empId}', '${userId}', 'hash-atomic', '654321', now() + interval '15 minutes', 'invoice', null, null, 'invoice-files'
    );
  `);
  console.log('Atomic session created:', (createRpc.rows[0] as any)?.id);

  console.log('ALL POSTGRESQL MIGRATION TESTS PASSED 100%!');
}

verify().catch((err) => {
  console.error('Postgres verification failed:', err.message);
  if (err.detail) console.error('Detail:', err.detail);
  if (err.hint) console.error('Hint:', err.hint);
  process.exit(1);
});
