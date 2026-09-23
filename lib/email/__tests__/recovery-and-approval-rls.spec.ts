import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260923044321_rodrigo_email_claim_recovery_and_rls_hardening.sql"
);
const migrationSql = readFileSync(migrationPath, "utf8");

const tenantA = "20000000-0000-4000-8000-000000000001";
const tenantB = "20000000-0000-4000-8000-000000000002";
const owner = "20000000-0000-4000-8000-000000000011";
const teammate = "20000000-0000-4000-8000-000000000012";
const admin = "20000000-0000-4000-8000-000000000013";
const administration = "20000000-0000-4000-8000-000000000014";
const bystander = "20000000-0000-4000-8000-000000000015";

const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create type public.user_role as enum ('comercial', 'administracion', 'admin');

  create table public.profiles (
    id uuid primary key,
    role public.user_role not null
  );
  create function auth.uid() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.current_empresa_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.empresa_id', true), '')::uuid $$;
  create function public.is_internal_role(roles public.user_role[]) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(
      (select p.role = any(roles) from public.profiles p where p.id = (select auth.uid())),
      false
    )
  $$;

  create table public.agent_approvals (
    id uuid primary key,
    empresa_id uuid not null,
    tool_name text not null,
    payload_json jsonb not null default '{}'::jsonb,
    requested_by uuid,
    decided_by uuid,
    status text not null default 'REQUESTED'
  );
  create table public.email_drafts (
    id uuid primary key,
    empresa_id uuid not null,
    created_by uuid not null,
    status text not null,
    revision bigint not null default 1,
    content_hash text not null default repeat('a', 64),
    failure_reason text,
    delivery_retry_authorized boolean not null default false
  );
  create table public.email_send_attempts (
    id uuid primary key,
    empresa_id uuid not null,
    draft_id uuid not null,
    approval_id uuid not null,
    approved_revision bigint not null,
    content_hash text not null,
    delivery_fingerprint text not null,
    client_message_id text not null,
    status text not null,
    started_at timestamptz not null,
    completed_at timestamptz,
    error_code text
  );

  alter table public.agent_approvals enable row level security;
  alter table public.email_drafts enable row level security;
  create policy email_drafts_select on public.email_drafts
    for select to authenticated using (
      empresa_id = public.current_empresa_id()
      and (created_by = (select auth.uid())
        or public.is_internal_role(array['admin']::public.user_role[]))
    );
  -- Reproduce the already-applied tenant-wide policy; the migration must
  -- replace it, not leave a permissive OR policy beside the new restriction.
  create policy agent_approvals_select on public.agent_approvals
    for select using (empresa_id = public.current_empresa_id());

  grant select on public.agent_approvals, public.email_drafts, public.email_send_attempts to anon, authenticated, service_role;
  grant update on public.agent_approvals, public.email_drafts, public.email_send_attempts to service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant execute on function public.current_empresa_id() to authenticated, service_role;
  grant execute on function public.is_internal_role(public.user_role[]) to authenticated, service_role;
`;

let db: PGlite;

async function setIdentity(userId: string, empresaId: string) {
  await db.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1, false), pg_catalog.set_config('request.jwt.claim.empresa_id', $2, false)",
    [userId, empresaId]
  );
}

async function approvalIdsAs(userId: string, empresaId: string) {
  await setIdentity(userId, empresaId);
  await db.exec("set role authenticated");
  try {
    const result = await db.query<{ id: string }>("select id from public.agent_approvals order by id");
    return result.rows.map((row) => row.id);
  } finally {
    await db.exec("reset role");
  }
}

async function runAsServiceRole<T>(callback: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function insertApproval(params: {
  id: string;
  empresaId: string;
  toolName: string;
  draftId?: string;
  snapshotDraftId?: string;
  requestedBy?: string;
  decidedBy?: string;
  status?: string;
}) {
  await db.query(
    `insert into public.agent_approvals (id, empresa_id, tool_name, payload_json, requested_by, decided_by, status)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      params.id,
      params.empresaId,
      params.toolName,
      JSON.stringify(params.draftId ? {
        draft_id: params.draftId,
        draft_snapshot: { draftId: params.snapshotDraftId ?? params.draftId },
      } : {}),
      params.requestedBy ?? null,
      params.decidedBy ?? null,
      params.status ?? "REQUESTED",
    ]
  );
}

async function insertDraft(params: {
  id: string;
  empresaId?: string;
  createdBy?: string;
  status?: string;
  revision?: number;
  contentHash?: string;
  retryAuthorized?: boolean;
}) {
  await db.query(
    `insert into public.email_drafts (id, empresa_id, created_by, status, revision, content_hash, delivery_retry_authorized)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [params.id, params.empresaId ?? tenantA, params.createdBy ?? owner, params.status ?? "SENDING", params.revision ?? 1, params.contentHash ?? "a".repeat(64), params.retryAuthorized ?? false]
  );
}

async function insertAttempt(params: {
  id: string;
  draftId: string;
  approvalId: string;
  status: "CLAIMED" | "DISPATCHING" | "SENT" | "FAILED_SAFE" | "DELIVERY_UNKNOWN";
  startedAt: string;
}) {
  await db.query(
    `insert into public.email_send_attempts
      (id, empresa_id, draft_id, approval_id, approved_revision, content_hash, delivery_fingerprint, client_message_id, status, started_at)
     values ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9::timestamptz)`,
    [params.id, tenantA, params.draftId, params.approvalId, "a".repeat(64), "b".repeat(64), `<${params.id}@test>`, params.status, params.startedAt]
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(bootstrapSql);
  // Apply the complete new migration to a disposable embedded Postgres instance.
  await db.exec(migrationSql);
  await db.query("insert into public.profiles (id, role) values ($1, 'comercial'), ($2, 'comercial'), ($3, 'admin'), ($4, 'administracion'), ($5, 'comercial')", [owner, teammate, admin, administration, bystander]);
}, 30_000);

afterAll(async () => {
  await db.close();
});

describe("Rodrigo email recovery and approval snapshot RLS", () => {
  it("applies the forward migration and keeps email visibility on the existing draft boundary", async () => {
    const ownDraft = "30000000-0000-4000-8000-000000000001";
    const otherDraft = "30000000-0000-4000-8000-000000000002";
    const crossTenantDraft = "30000000-0000-4000-8000-000000000003";
    const ownerApproval = "30000000-0000-4000-8000-000000000011";
    const teammateApproval = "30000000-0000-4000-8000-000000000012";
    const crossTenantApproval = "30000000-0000-4000-8000-000000000013";
    const nonEmailApproval = "30000000-0000-4000-8000-000000000014";
    const malformedApproval = "30000000-0000-4000-8000-000000000015";
    const mismatchedApproval = "30000000-0000-4000-8000-000000000016";

    await insertDraft({ id: ownDraft, createdBy: owner });
    await insertDraft({ id: otherDraft, createdBy: teammate });
    await insertDraft({ id: crossTenantDraft, empresaId: tenantB, createdBy: owner });
    await insertApproval({ id: ownerApproval, empresaId: tenantA, toolName: "send_email", draftId: ownDraft, requestedBy: owner });
    // A forged requested_by cannot grant access to another person's draft.
    await insertApproval({ id: teammateApproval, empresaId: tenantA, toolName: "send_email", draftId: otherDraft, requestedBy: owner });
    await insertApproval({ id: crossTenantApproval, empresaId: tenantB, toolName: "send_email", draftId: crossTenantDraft, requestedBy: owner });
    await insertApproval({ id: nonEmailApproval, empresaId: tenantA, toolName: "send_rfq" });
    await insertApproval({ id: malformedApproval, empresaId: tenantA, toolName: "send_email" });
    await insertApproval({
      id: mismatchedApproval,
      empresaId: tenantA,
      toolName: "send_email",
      draftId: ownDraft,
      snapshotDraftId: otherDraft,
      requestedBy: owner,
    });

    const ownerVisible = await approvalIdsAs(owner, tenantA);
    expect(ownerVisible).toContain(ownerApproval);
    expect(ownerVisible).toContain(nonEmailApproval);
    expect(ownerVisible).not.toContain(teammateApproval);
    expect(ownerVisible).not.toContain(crossTenantApproval);
    expect(ownerVisible).not.toContain(malformedApproval);
    expect(ownerVisible).not.toContain(mismatchedApproval);

    const teammateVisible = await approvalIdsAs(teammate, tenantA);
    expect(teammateVisible).toContain(nonEmailApproval);
    expect(teammateVisible).toContain(teammateApproval);
    expect(teammateVisible).not.toContain(ownerApproval);

    const bystanderVisible = await approvalIdsAs(bystander, tenantA);
    expect(bystanderVisible).toContain(nonEmailApproval);
    expect(bystanderVisible).not.toContain(ownerApproval);
    expect(bystanderVisible).not.toContain(teammateApproval);

    const administrationVisible = await approvalIdsAs(administration, tenantA);
    expect(administrationVisible).toContain(nonEmailApproval);
    expect(administrationVisible).not.toContain(ownerApproval);

    const adminVisible = await approvalIdsAs(admin, tenantA);
    expect(adminVisible).toContain(ownerApproval);
    expect(adminVisible).toContain(teammateApproval);
    expect(adminVisible).not.toContain(crossTenantApproval);
    expect(adminVisible).not.toContain(malformedApproval);
    expect(adminVisible).not.toContain(mismatchedApproval);

    const serviceVisible = await runAsServiceRole(async () => {
      const result = await db.query<{ id: string }>("select id from public.agent_approvals order by id");
      return result.rows.map((row) => row.id);
    });
    expect(serviceVisible).toEqual(expect.arrayContaining([ownerApproval, teammateApproval, crossTenantApproval]));

    const selectPolicies = await db.query<{ policyname: string; qual: string }>(
      "select policyname, qual from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'agent_approvals' and cmd = 'SELECT'"
    );
    expect(selectPolicies.rows).toHaveLength(1);
    expect(selectPolicies.rows[0].qual).toContain("email_drafts");
  });

  it("recovers only stale CLAIMED rows atomically, invalidates the old approval, and is idempotent", async () => {
    const staleDraft = "40000000-0000-4000-8000-000000000001";
    const recentDraft = "40000000-0000-4000-8000-000000000002";
    const dispatchingDraft = "40000000-0000-4000-8000-000000000003";
    const terminalDraft = "40000000-0000-4000-8000-000000000004";
    const staleApproval = "40000000-0000-4000-8000-000000000011";
    const recentApproval = "40000000-0000-4000-8000-000000000012";
    const dispatchingApproval = "40000000-0000-4000-8000-000000000013";
    const terminalApproval = "40000000-0000-4000-8000-000000000014";
    const cutoff = "2026-01-02T00:00:00Z";

    await insertDraft({ id: staleDraft, retryAuthorized: true });
    await insertDraft({ id: recentDraft });
    await insertDraft({ id: dispatchingDraft });
    await insertDraft({ id: terminalDraft, status: "SENT" });
    await insertApproval({ id: staleApproval, empresaId: tenantA, toolName: "send_email", draftId: staleDraft, status: "EXECUTING" });
    await insertApproval({ id: recentApproval, empresaId: tenantA, toolName: "send_email", draftId: recentDraft, status: "APPROVED" });
    await insertApproval({ id: dispatchingApproval, empresaId: tenantA, toolName: "send_email", draftId: dispatchingDraft, status: "EXECUTING" });
    await insertApproval({ id: terminalApproval, empresaId: tenantA, toolName: "send_email", draftId: terminalDraft, status: "FAILED" });
    await insertAttempt({ id: "40000000-0000-4000-8000-000000000021", draftId: staleDraft, approvalId: staleApproval, status: "CLAIMED", startedAt: "2026-01-01T00:00:00Z" });
    await insertAttempt({ id: "40000000-0000-4000-8000-000000000022", draftId: recentDraft, approvalId: recentApproval, status: "CLAIMED", startedAt: cutoff });
    await insertAttempt({ id: "40000000-0000-4000-8000-000000000023", draftId: dispatchingDraft, approvalId: dispatchingApproval, status: "DISPATCHING", startedAt: "2026-01-01T00:00:00Z" });
    await insertAttempt({ id: "40000000-0000-4000-8000-000000000024", draftId: terminalDraft, approvalId: terminalApproval, status: "SENT", startedAt: "2026-01-01T00:00:00Z" });

    const firstRecovery = await runAsServiceRole(async () =>
      db.query<{ recover_stale_email_send_attempts: number }>(
        "select public.recover_stale_email_send_attempts($1::timestamptz)", [cutoff]
      )
    );
    expect(firstRecovery.rows[0].recover_stale_email_send_attempts).toBe(2);

    const states = await db.query<{ id: string; status: string; error_code: string | null }>(
      "select id, status, error_code from public.email_send_attempts order by id"
    );
    expect(states.rows.find((row) => row.id.endsWith("0021"))).toMatchObject({ status: "FAILED_SAFE", error_code: "STALE_CLAIMED" });
    expect(states.rows.find((row) => row.id.endsWith("0022"))?.status).toBe("CLAIMED");
    expect(states.rows.find((row) => row.id.endsWith("0023"))).toMatchObject({ status: "DELIVERY_UNKNOWN", error_code: "STALE_DISPATCHING" });
    expect(states.rows.find((row) => row.id.endsWith("0024"))?.status).toBe("SENT");

    const draftStates = await db.query<{ id: string; status: string; delivery_retry_authorized: boolean }>(
      "select id, status, delivery_retry_authorized from public.email_drafts order by id"
    );
    expect(draftStates.rows.find((row) => row.id === staleDraft)).toMatchObject({ status: "FAILED", delivery_retry_authorized: false });
    expect(draftStates.rows.find((row) => row.id === recentDraft)?.status).toBe("SENDING");
    expect(draftStates.rows.find((row) => row.id === dispatchingDraft)?.status).toBe("DELIVERY_UNKNOWN");

    const approvalState = await db.query<{ status: string }>("select status from public.agent_approvals where id = $1", [staleApproval]);
    expect(approvalState.rows[0].status).toBe("FAILED");
    const dispatchingApprovalState = await db.query<{ status: string }>("select status from public.agent_approvals where id = $1", [dispatchingApproval]);
    expect(dispatchingApprovalState.rows[0].status).toBe("FAILED");

    const retryRecovery = await runAsServiceRole(async () =>
      db.query<{ recover_stale_email_send_attempts: number }>(
        "select public.recover_stale_email_send_attempts($1::timestamptz)", [cutoff]
      )
    );
    expect(retryRecovery.rows[0].recover_stale_email_send_attempts).toBe(0);
  });

  it("rejects dispatch after recovery and preserves DISPATCHING as ambiguous rather than safely failed", async () => {
    const draftId = "50000000-0000-4000-8000-000000000001";
    const approvalId = "50000000-0000-4000-8000-000000000002";
    const attemptId = "50000000-0000-4000-8000-000000000003";
    await insertDraft({ id: draftId });
    await insertApproval({ id: approvalId, empresaId: tenantA, toolName: "send_email", draftId, status: "EXECUTING" });
    await insertAttempt({ id: attemptId, draftId, approvalId, status: "CLAIMED", startedAt: "2026-01-01T00:00:00Z" });

    await runAsServiceRole(async () => {
      const recovered = await db.query<{ recover_stale_email_send_attempts: number }>(
        "select public.recover_stale_email_send_attempts('2026-01-02T00:00:00Z'::timestamptz)"
      );
      expect(recovered.rows[0].recover_stale_email_send_attempts).toBe(1);
      await expect(db.query(
        "select public.mark_email_send_attempt_dispatching($1::uuid, $2::uuid, $3::uuid)",
        [attemptId, tenantA, owner]
      )).rejects.toThrow(/not claimable for dispatch/i);
    });

    const finalAttempt = await db.query<{ status: string }>("select status from public.email_send_attempts where id = $1", [attemptId]);
    const finalDraft = await db.query<{ status: string }>("select status from public.email_drafts where id = $1", [draftId]);
    expect(finalAttempt.rows[0].status).toBe("FAILED_SAFE");
    expect(finalDraft.rows[0].status).toBe("FAILED");
  });

  it("when dispatch wins first, recovery does not classify the attempt as FAILED_SAFE", async () => {
    const draftId = "55000000-0000-4000-8000-000000000001";
    const approvalId = "55000000-0000-4000-8000-000000000002";
    const attemptId = "55000000-0000-4000-8000-000000000003";
    await insertDraft({ id: draftId });
    await insertApproval({ id: approvalId, empresaId: tenantA, toolName: "send_email", draftId, status: "EXECUTING" });
    await insertAttempt({ id: attemptId, draftId, approvalId, status: "CLAIMED", startedAt: "2026-01-01T00:00:00Z" });

    await runAsServiceRole(async () => {
      await db.query(
        "select public.mark_email_send_attempt_dispatching($1::uuid, $2::uuid, $3::uuid)",
        [attemptId, tenantA, owner]
      );
      const recovered = await db.query<{ recover_stale_email_send_attempts: number }>(
        "select public.recover_stale_email_send_attempts('2026-01-02T00:00:00Z'::timestamptz)"
      );
      expect(recovered.rows[0].recover_stale_email_send_attempts).toBe(0);
    });

    const finalAttempt = await db.query<{ status: string; started_at: string }>("select status, started_at from public.email_send_attempts where id = $1", [attemptId]);
    const finalDraft = await db.query<{ status: string }>("select status from public.email_drafts where id = $1", [draftId]);
    expect(finalAttempt.rows[0].status).toBe("DISPATCHING");
    expect(new Date(finalAttempt.rows[0].started_at).getTime()).toBeGreaterThan(new Date("2026-01-02T00:00:00Z").getTime());
    expect(finalDraft.rows[0].status).toBe("SENDING");
  });

  it("parallel recovery submissions result in one transition; SQL uses row locks and expected-state predicates", async () => {
    const draftId = "60000000-0000-4000-8000-000000000001";
    const approvalId = "60000000-0000-4000-8000-000000000002";
    const attemptId = "60000000-0000-4000-8000-000000000003";
    await insertDraft({ id: draftId });
    await insertApproval({ id: approvalId, empresaId: tenantA, toolName: "send_email", draftId, status: "APPROVED" });
    await insertAttempt({ id: attemptId, draftId, approvalId, status: "CLAIMED", startedAt: "2026-01-01T00:00:00Z" });

    await db.exec("set role service_role");
    let counts;
    try {
      counts = await Promise.all([
        db.query<{ recover_stale_email_send_attempts: number }>(
          "select public.recover_stale_email_send_attempts('2026-01-02T00:00:00Z'::timestamptz)"
        ),
        db.query<{ recover_stale_email_send_attempts: number }>(
          "select public.recover_stale_email_send_attempts('2026-01-02T00:00:00Z'::timestamptz)"
        ),
      ]);
    } finally {
      await db.exec("reset role");
    }
    expect(counts.map((result) => result.rows[0].recover_stale_email_send_attempts).sort()).toEqual([0, 1]);

    expect(migrationSql).toMatch(/for update skip locked/i);
    expect(migrationSql).toMatch(/status = 'CLAIMED'[\s\S]*?started_at < p_cutoff/i);
    const finalAttempt = await db.query<{ status: string }>("select status from public.email_send_attempts where id = $1", [attemptId]);
    expect(finalAttempt.rows[0].status).toBe("FAILED_SAFE");
  });
});
