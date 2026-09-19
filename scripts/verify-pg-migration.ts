import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
  console.log('--- Testing migrations on isolated PostgreSQL (PGlite) engine ---');
  const pg = new PGlite();

  // Create ONLY pre-existing dependencies present before scanner migrations
  // NOTE: public.current_user_empresa_id() is NOT created here — it must come strictly
  // from the compatibility migration 20260917235959_scan_sessions_legacy_policy_helper_compat.sql.
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
    -- Canonical pre-existing helper in the project
    CREATE OR REPLACE FUNCTION public.current_empresa_id()
    RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.empresas LIMIT 1 $$;
    CREATE PUBLICATION supabase_realtime;
  `);

  // [1/4] Migration 20260917235959 (Legacy Policy Helper Compatibility Shim)
  const m0 = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260917235959_scan_sessions_legacy_policy_helper_compat.sql'),
    'utf8'
  );
  console.log('[1/4] Running compatibility shim migration (20260917235959)...');
  await pg.exec(m0);
  console.log('✓ Compatibility shim migration applied successfully.');

  // [2/4] Migration 20260918000001 (Base scan_sessions) - runs WITHOUT false manual mocks
  const m1 = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260918000001_scan_sessions.sql'),
    'utf8'
  );
  console.log('[2/4] Running base migration (20260918000001)...');
  await pg.exec(m1);
  console.log('✓ Base migration applied successfully (intact historical SQL executed cleanly).');

  // [3/4] Migration 20260918020000 (Hardening)
  const m2 = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260918020000_scan_sessions_hardening.sql'),
    'utf8'
  );
  console.log('[3/4] Running hardening migration (20260918020000)...');
  await pg.exec(m2);
  console.log('✓ Hardening migration applied successfully.');

  // [4/4] Migration 20260918030000 (Forward-only metadata, policy update & shim cleanup)
  const m3 = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20260918030000_scan_sessions_metadata_and_policy_fix.sql'),
    'utf8'
  );
  console.log('[4/4] Running forward-only fix & cleanup migration (20260918030000)...');
  await pg.exec(m3);
  console.log('✓ Forward-only fix & cleanup migration applied successfully.');

  // Idempotency check: re-run migrations to ensure CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS are resilient
  console.log('\n--- Checking Migration Idempotency ---');
  await pg.exec(m0);
  await pg.exec(m2);
  await pg.exec(m3);
  console.log('✓ Migrations are idempotent (re-applied without error).');

  // Assertion 1: current_user_empresa_id() DOES NOT EXIST, current_empresa_id() EXISTS
  console.log('\n--- Checking Final Database Function State ---');
  const legacyFn = await pg.query(`
    SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'current_user_empresa_id';
  `);
  if (legacyFn.rows.length !== 0) {
    throw new Error('FAILED: public.current_user_empresa_id() still exists in database! Expected clean removal.');
  }
  console.log('✓ public.current_user_empresa_id() DOES NOT EXIST (cleanly purged).');

  const canonicalFn = await pg.query(`
    SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'current_empresa_id';
  `);
  if (canonicalFn.rows.length === 0) {
    throw new Error('FAILED: public.current_empresa_id() does not exist!');
  }
  console.log('✓ public.current_empresa_id() EXISTS (canonical project helper).');

  // Assertion 2: All 3 final policies use current_empresa_id()
  console.log('\n--- Checking Final RLS Policies ---');
  const policies = await pg.query<{ policyname: string; qual: string; with_check: string }>(`
    SELECT policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scan_sessions';
  `);
  if (policies.rows.length !== 3) {
    throw new Error(`Expected exactly 3 policies on scan_sessions, found ${policies.rows.length}`);
  }
  for (const pol of policies.rows) {
    console.log(`Policy: ${pol.policyname}, qual: ${pol.qual}, with_check: ${pol.with_check}`);
    const expr = (pol.qual || '') + (pol.with_check || '');
    if (!expr.includes('current_empresa_id()')) {
      throw new Error(`FAILED: Policy ${pol.policyname} does not use current_empresa_id()!`);
    }
    if (expr.includes('current_user_empresa_id()')) {
      throw new Error(`FAILED: Policy ${pol.policyname} still references legacy current_user_empresa_id()!`);
    }
  }
  console.log('✓ All scan_sessions policies strictly use current_empresa_id().');

  // Assertion 3: Exactly 1 non-ambiguous signature for scan_session_create_atomic with p_metadata jsonb
  console.log('\n--- Checking scan_session_create_atomic Signature & Grants ---');
  const rpcFuncs = await pg.query<{ proname: string; args: string; acl: string }>(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args, array_to_string(p.proacl, '; ') as acl
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'scan_session_create_atomic';
  `);
  if (rpcFuncs.rows.length !== 1) {
    throw new Error(`Ambiguity error: Expected exactly 1 signature for scan_session_create_atomic, found ${rpcFuncs.rows.length}`);
  }
  const signature = rpcFuncs.rows[0];
  console.log('Canonical signature args:', signature.args);
  if (!signature.args.includes('p_metadata jsonb')) {
    throw new Error('FAILED: Canonical signature does not include p_metadata jsonb parameter!');
  }
  console.log('ACL:', signature.acl);
  if (!signature.acl.includes('service_role=X')) {
    throw new Error('FAILED: Execute grant on scan_session_create_atomic not granted to service_role!');
  }
  console.log('✓ scan_session_create_atomic has exactly 1 non-ambiguous signature with p_metadata and service_role grant.');

  // Assertion 4: Atomic Rate Limiter
  console.log('\n--- Checking Rate Limit Atomic RPC ---');
  const res1 = await pg.query(`
    SELECT * FROM public.scan_pin_record_failed_attempt('test-ip-actor-1', 5, 900);
  `);
  const res2 = await pg.query(`
    SELECT * FROM public.scan_pin_record_failed_attempt('test-ip-actor-1', 5, 900);
  `);
  const attCount = (res2.rows[0] as any).failed_attempts;
  if (attCount !== 2) {
    throw new Error(`Atomic counter failed: expected 2, got ${attCount}`);
  }
  console.log('✓ Atomic rate limiter incremented without lost updates (2 attempts recorded).');

  // Assertion 5: Partial Unique PIN Index
  console.log('\n--- Checking Partial Unique Index (idx_scan_sessions_unique_active_pin) ---');
  const emp1 = await pg.query<{ id: string }>(`INSERT INTO public.empresas (nombre) VALUES ('Empresa 1') RETURNING id;`);
  const empId = emp1.rows[0].id;
  const user1 = await pg.query<{ id: string }>(`INSERT INTO auth.users (email) VALUES ('u1@example.com') RETURNING id;`);
  const userId = user1.rows[0].id;

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
    threwUniqueViolation = err.message.includes('unique') || err.message.includes('duplicate');
  }

  if (!threwUniqueViolation) {
    throw new Error('FAILED: Partial unique index did NOT prevent duplicate waiting PIN!');
  }
  console.log('✓ Partial unique index strictly prevented concurrent active PIN collision.');

  // Transition first session to 'connected' (claimed)
  await pg.query(`
    UPDATE public.scan_sessions SET status = 'connected' WHERE pin_code = '123456';
  `);
  await pg.query(`
    INSERT INTO public.scan_sessions (empresa_id, created_by, token_hash, pin_code, expires_at, status)
    VALUES ('${empId}', '${userId}', 'hash3', '123456', now() + interval '15 minutes', 'waiting');
  `);
  console.log('✓ Claimed/connected session freed PIN 123456 for new waiting session.');

  // Assertion 6: scan_session_create_atomic persists metadata
  console.log('\n--- Checking scan_session_create_atomic with Metadata ---');
  const testMetadata = { source: 'invoice', foo: 'bar', timestamp: 12345 };
  const createRpc = await pg.query<{ id: string; metadata: any }>(`
    SELECT * FROM public.scan_session_create_atomic(
      '${empId}', '${userId}', 'hash-atomic-meta', '654321', now() + interval '15 minutes',
      'invoice', 'inv-001', 'target_doc', 'invoice-files', '${JSON.stringify(testMetadata)}'::jsonb
    );
  `);
  const createdSession = createRpc.rows[0];
  console.log('Created session ID:', createdSession.id);
  console.log('Persisted metadata in DB:', createdSession.metadata);

  if (!createdSession.metadata || createdSession.metadata.source !== 'invoice' || createdSession.metadata.foo !== 'bar') {
    throw new Error('FAILED: Metadata was not persisted correctly in scan_session_create_atomic!');
  }
  console.log('✓ Metadata successfully accepted and persisted in database.');

  console.log('\n======================================================');
  console.log('ALL ISOLATED POSTGRESQL MIGRATION TESTS PASSED 100%!');
  console.log('======================================================\n');
}

verify().catch((err) => {
  console.error('Postgres verification failed:', err.message);
  if (err.detail) console.error('Detail:', err.detail);
  if (err.hint) console.error('Hint:', err.hint);
  process.exit(1);
});
