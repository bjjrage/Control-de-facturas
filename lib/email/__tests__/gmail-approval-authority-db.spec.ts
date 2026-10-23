import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const COMMERCIAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMINISTRATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONNECTION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LEGACY_DRAFT = "00000000-0000-4000-8000-000000000001";
const LEGACY_PENDING = "00000000-0000-4000-8000-000000000002";
const LEGACY_CONSUMED = "00000000-0000-4000-8000-000000000003";
const LEGACY_ATTEMPT = "00000000-0000-4000-8000-000000000004";
const LIVE_DRAFT = "00000000-0000-4000-8000-000000000005";
const SUSPENDED = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CONTENT_HASH = "a".repeat(64);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20261022231211_sec03_gmail_approval_authority.sql", import.meta.url),
  "utf8"
);

let db: PGlite;

async function setDbRole(role: "service_role" | "authenticated") {
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${role}', false)`);
}

async function asServiceRole<T>(query: string, params: unknown[] = []) {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE service_role");
  await setDbRole("service_role");
  try {
    return await db.query<T>(query, params);
  } finally {
    await db.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA vault;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claim.role', true)
    $$;
    CREATE TABLE public.empresas(id uuid PRIMARY KEY, active boolean NOT NULL);
    CREATE TABLE public.profiles(
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, active boolean NOT NULL, role text NOT NULL
    );
    CREATE TABLE public.agent_tasks(id uuid PRIMARY KEY, empresa_id uuid NOT NULL, user_id uuid);
    CREATE TABLE public.agent_runs(id uuid PRIMARY KEY, task_id uuid NOT NULL, empresa_id uuid NOT NULL);
    CREATE TABLE public.agent_approvals(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, run_id uuid,
      empresa_id uuid NOT NULL, tool_name text NOT NULL, payload_json jsonb NOT NULL,
      payload_hash text NOT NULL, risk_level integer NOT NULL, status text NOT NULL DEFAULT 'REQUESTED',
      requested_by uuid, decided_by uuid, decided_at timestamptz, expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      approved_revision bigint, approved_content_hash text
    );
    CREATE TABLE public.email_connections(
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, user_id uuid NOT NULL, provider text NOT NULL,
      status text NOT NULL, refresh_token_secret_id uuid
    );
    CREATE TABLE public.email_drafts(
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, created_by uuid NOT NULL,
      provider_connection_id uuid, status text NOT NULL, revision bigint NOT NULL,
      content_hash text NOT NULL, failure_reason text
    );
    CREATE TABLE public.email_send_attempts(
      id uuid PRIMARY KEY, empresa_id uuid NOT NULL, draft_id uuid NOT NULL,
      connection_id uuid NOT NULL, approval_id uuid NOT NULL, approved_revision bigint NOT NULL,
      content_hash text NOT NULL, delivery_fingerprint text NOT NULL,
      client_message_id text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE vault.decrypted_secrets(id uuid PRIMARY KEY, decrypted_secret text NOT NULL);

    INSERT INTO public.empresas VALUES ('${TENANT}', true);
    INSERT INTO public.profiles VALUES
      ('${COMMERCIAL}', '${TENANT}', true, 'comercial'),
      ('${ADMINISTRATION}', '${TENANT}', true, 'administracion'),
      ('${SUSPENDED}', '${TENANT}', false, 'comercial');
    INSERT INTO public.agent_tasks VALUES ('${TASK}', '${TENANT}', '${COMMERCIAL}');
    INSERT INTO public.agent_runs VALUES ('${RUN}', '${TASK}', '${TENANT}');
    INSERT INTO public.email_connections VALUES
      ('${CONNECTION}', '${TENANT}', '${COMMERCIAL}', 'GMAIL', 'CONNECTED', '99999999-9999-4999-8999-999999999999');
    INSERT INTO public.email_drafts VALUES
      ('${LEGACY_DRAFT}', '${TENANT}', '${COMMERCIAL}', '${CONNECTION}', 'WAITING_APPROVAL', 1, '${CONTENT_HASH}', null);
    INSERT INTO public.agent_approvals (
      id, task_id, run_id, empresa_id, tool_name, payload_json, payload_hash, risk_level,
      status, requested_by, approved_revision, approved_content_hash
    ) VALUES
      ('${LEGACY_PENDING}', '${TASK}', '${RUN}', '${TENANT}', 'send_email',
       jsonb_build_object('draft_id','${LEGACY_DRAFT}','draft_hash','${CONTENT_HASH}','draft_revision',1),
       '${CONTENT_HASH}', 2, 'REQUESTED', '${COMMERCIAL}', 1, '${CONTENT_HASH}'),
      ('${LEGACY_CONSUMED}', '${TASK}', '${RUN}', '${TENANT}', 'send_email',
       jsonb_build_object('draft_id','${LEGACY_DRAFT}','draft_hash','${CONTENT_HASH}','draft_revision',1),
       '${CONTENT_HASH}', 2, 'EXECUTING', '${COMMERCIAL}', 1, '${CONTENT_HASH}');
    INSERT INTO public.email_send_attempts VALUES
      ('${LEGACY_ATTEMPT}', '${TENANT}', '${LEGACY_DRAFT}', '${CONNECTION}', '${LEGACY_CONSUMED}',
       1, '${CONTENT_HASH}', 'legacy-fingerprint', 'legacy-message', 'CLAIMED', now());
    GRANT USAGE ON SCHEMA public, vault TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public, vault TO service_role;
  `);
  await db.exec(MIGRATION);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("SEC03 Gmail approval authority migration", () => {
  it("invalidates unverifiable legacy pending approvals but preserves consumed approval attempts", async () => {
    const rows = await db.query<{ pending_status: string; draft_status: string; consumed_status: string }>(`
      SELECT
        (SELECT status FROM public.agent_approvals WHERE id='${LEGACY_PENDING}') AS pending_status,
        (SELECT status FROM public.email_drafts WHERE id='${LEGACY_DRAFT}') AS draft_status,
        (SELECT status FROM public.agent_approvals WHERE id='${LEGACY_CONSUMED}') AS consumed_status
    `);
    expect(rows.rows[0]).toEqual({ pending_status: "CANCELLED", draft_status: "READY", consumed_status: "EXECUTING" });
  });

  it("denies Data API forged INSERT/UPDATE and authenticated decision RPC calls", async () => {
    await db.exec("SET ROLE authenticated");
    await setDbRole("authenticated");
    await expect(db.exec(`
      INSERT INTO public.agent_approvals (
        task_id, empresa_id, tool_name, payload_json, payload_hash, risk_level, status, requested_by
      ) VALUES ('${TASK}', '${TENANT}', 'send_email', '{}', '${CONTENT_HASH}', 2, 'APPROVED', '${COMMERCIAL}')
    `)).rejects.toThrow(/permission denied/i);
    await expect(db.exec(`UPDATE public.agent_approvals SET status='APPROVED' WHERE id='${LEGACY_PENDING}'`))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query(`SELECT public.decide_agent_approval('${LEGACY_PENDING}','${TENANT}','APPROVED','${COMMERCIAL}',ARRAY['comercial'])`))
      .rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE");
  });

  it("rechecks current active tenant role when deciding and claiming, then allows the current authorized happy path", async () => {
    await db.exec(`
      INSERT INTO public.email_drafts VALUES
        ('${LIVE_DRAFT}', '${TENANT}', '${COMMERCIAL}', '${CONNECTION}', 'WAITING_APPROVAL', 1, '${CONTENT_HASH}', null);
    `);
    await asServiceRole(`
      SELECT public.create_agent_approval(
        '${TASK}', '${RUN}', '${TENANT}', 'send_email',
        jsonb_build_object('draft_id','${LIVE_DRAFT}','draft_hash','${CONTENT_HASH}','draft_revision',1),
        '${CONTENT_HASH}', 2, '${COMMERCIAL}', null, 1, '${CONTENT_HASH}', '${COMMERCIAL}'
      )
    `);

    await db.exec(`UPDATE public.profiles SET role='administracion' WHERE id='${COMMERCIAL}'`);
    await expect(asServiceRole(`
      SELECT public.decide_agent_approval(
        (SELECT id FROM public.agent_approvals WHERE tool_name='send_email' AND payload_json->>'draft_id'='${LIVE_DRAFT}'),
        '${TENANT}', 'APPROVED', '${COMMERCIAL}', ARRAY['comercial','admin']
      )
    `)).rejects.toThrow(/not active or is not authorized/i);

    await db.exec(`UPDATE public.profiles SET role='comercial' WHERE id='${COMMERCIAL}'`);
    const decided = await asServiceRole<{ status: string; decided_by: string }>(`
      SELECT (r).status, (r).decided_by FROM (
        SELECT public.decide_agent_approval(
          (SELECT id FROM public.agent_approvals WHERE tool_name='send_email' AND payload_json->>'draft_id'='${LIVE_DRAFT}'),
          '${TENANT}', 'APPROVED', '${COMMERCIAL}', ARRAY['comercial','admin']
        ) AS r
      ) q
    `);
    expect(decided.rows[0]).toMatchObject({ status: "APPROVED", decided_by: COMMERCIAL });

    await db.exec(`
      INSERT INTO vault.decrypted_secrets VALUES ('99999999-9999-4999-8999-999999999999', 'opaque-test-token');
    `);
    const claimed = await asServiceRole<{ claim_email_send: { attempt_id: string; status: string } }>(`
      SELECT public.claim_email_send(
        '${TENANT}', '${COMMERCIAL}', '${LIVE_DRAFT}', '${CONNECTION}',
        (SELECT id FROM public.agent_approvals WHERE payload_json->>'draft_id'='${LIVE_DRAFT}'),
        1, '${CONTENT_HASH}', 'delivery-fingerprint-live', false
      )
    `);
    expect(claimed.rows[0].claim_email_send.status).toBe("CLAIMED");

    await db.exec(`UPDATE public.profiles SET role='administracion' WHERE id='${COMMERCIAL}'`);
    await expect(asServiceRole(`
      SELECT public.claim_email_send(
        '${TENANT}', '${COMMERCIAL}', '${LIVE_DRAFT}', '${CONNECTION}',
        (SELECT id FROM public.agent_approvals WHERE payload_json->>'draft_id'='${LIVE_DRAFT}'),
        1, '${CONTENT_HASH}', 'revoked-role-retry', false
      )
    `)).rejects.toThrow(/not an active comercial\/admin/i);

    await db.exec(`UPDATE public.profiles SET role='comercial' WHERE id='${COMMERCIAL}'`);
    await db.exec(`UPDATE public.profiles SET active=false WHERE id='${COMMERCIAL}'`);
    await expect(asServiceRole(`
      SELECT public.claim_email_send(
        '${TENANT}', '${COMMERCIAL}', '${LIVE_DRAFT}', '${CONNECTION}',
        (SELECT id FROM public.agent_approvals WHERE payload_json->>'draft_id'='${LIVE_DRAFT}'),
        1, '${CONTENT_HASH}', 'inactive-profile-retry', false
      )
    `)).rejects.toThrow(/not an active comercial\/admin/i);
    const secret = await asServiceRole<{ secret: string | null }>(`
      SELECT public.email_read_oauth_secret_for_send(
        (SELECT id FROM public.email_send_attempts WHERE delivery_fingerprint='delivery-fingerprint-live'),
        '${CONNECTION}', '${TENANT}', '${COMMERCIAL}'
      ) AS secret
    `);
    expect(secret.rows[0].secret).toBeNull();
  });

  it("rejects creation by a suspended or cross-company actor", async () => {
    await expect(asServiceRole(`
      SELECT public.create_agent_approval(
        '${TASK}', '${RUN}', '${TENANT}', 'send_email',
        jsonb_build_object('draft_id','${LIVE_DRAFT}','draft_hash','${CONTENT_HASH}','draft_revision',1),
        '${CONTENT_HASH}', 2, '${SUSPENDED}', null, 1, '${CONTENT_HASH}', '${SUSPENDED}'
      )
    `)).rejects.toThrow(/not an active member/i);
  });
});
