import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireProfile, mockCreateClient } = vi.hoisted(() => ({
  mockRequireProfile: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: mockRequireProfile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

import { GET } from "@/app/api/agent/status/route";

type Row = Record<string, unknown>;

function validEmailSnapshot(draftId: string, to = ["owner@example.com"]) {
  return {
    draftId,
    revision: 1,
    to,
    cc: [],
    bcc: [],
    subject: "Preview",
    bodyText: "Texto",
    attachments: [],
    contentHash: "a".repeat(64),
  };
}

function fakeDb(tables: Record<string, Row[]>, errorOn?: string) {
  return {
    from: (table: string) => {
      const builder = {
        _eq: [] as Array<[string, unknown]>,
        _in: [] as Array<[string, unknown[]]>,
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          builder._eq.push([col, val]);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          builder._in.push([col, vals]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          if (errorOn === table) {
            resolve({ data: null, error: { message: "boom" } });
            return;
          }
          let rows = tables[table] ?? [];
          for (const [col, val] of builder._eq) rows = rows.filter((r) => r[col] === val);
          for (const [col, vals] of builder._in) rows = rows.filter((r) => vals.includes(r[col]));
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agent/status", () => {
  it("sin tareas responde idle y no filtra cross-tenant", async () => {
    mockRequireProfile.mockResolvedValue({ id: "u1", empresa_id: "emp-B" });
    mockCreateClient.mockResolvedValue(
      fakeDb({
        agent_tasks: [{ status: "RUNNING", updated_at: "2026-01-01", completed_at: null, empresa_id: "emp-A" }],
        agent_approvals: [],
      })
    );
    const res = await GET();
    const body = (await res.json()) as { state: string; activeTaskCount: number; pendingApprovals: unknown[] };
    expect(res.status).toBe(200);
    // La fila de emp-A no debe aparecer: empresa del perfil es emp-B.
    expect(body.state).toBe("idle");
    expect(body.activeTaskCount).toBe(0);
    expect(body.pendingApprovals).toEqual([]);
  });

  it("WAITING_APPROVAL da approval y mapea pendientes", async () => {
    mockRequireProfile.mockResolvedValue({ id: "u1", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(
      fakeDb({
        agent_tasks: [{ status: "WAITING_APPROVAL", updated_at: "2026-01-01", completed_at: null, empresa_id: "emp-A" }],
        agent_approvals: [{ id: "ap-1", tool_name: "send_rfq", created_at: "2026-01-01", empresa_id: "emp-A", status: "REQUESTED" }],
      })
    );
    const res = await GET();
    const body = (await res.json()) as {
      state: string;
      pendingApprovals: Array<{ id: string; toolName: string }>;
    };
    expect(body.state).toBe("approval");
    expect(body.pendingApprovals).toEqual([{ id: "ap-1", toolName: "send_rfq", createdAt: "2026-01-01" }]);
  });

  it("no devuelve un snapshot send_email del mismo tenant si el borrador no es visible por RLS", async () => {
    const draftId = "10000000-0000-4000-8000-000000000001";
    mockRequireProfile.mockResolvedValue({ id: "u-other", role: "comercial", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(fakeDb({
      agent_tasks: [],
      // Simula un bug futuro que vuelva a exponer la fila de approval: la
      // segunda consulta session-bound de email_drafts debe seguir cerrando.
      agent_approvals: [{
        id: "ap-private",
        tool_name: "send_email",
        created_at: "2026-01-01",
        empresa_id: "emp-A",
        status: "REQUESTED",
        payload_json: {
          draft_id: draftId,
          draft_snapshot: {
            draftId,
            to: ["destinatario@example.com"],
            bcc: ["copia-oculta@example.com"],
            subject: "Privado",
            bodyText: "Contenido confidencial",
          },
        },
      }],
      email_drafts: [],
    }));

    const res = await GET();
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain("destinatario@example.com");
    expect(serialized).not.toContain("copia-oculta@example.com");
    expect(serialized).not.toContain("Contenido confidencial");
    expect(serialized).not.toContain("ap-private");
  });

  it("conserva el preview solo si la consulta session-bound de borradores lo autoriza", async () => {
    const draftId = "10000000-0000-4000-8000-000000000002";
    mockRequireProfile.mockResolvedValue({ id: "u-owner", role: "comercial", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(fakeDb({
      agent_tasks: [],
      agent_approvals: [{
        id: "ap-owned",
        tool_name: "send_email",
        created_at: "2026-01-01",
        empresa_id: "emp-A",
        status: "REQUESTED",
        payload_json: {
          draft_id: draftId,
          draft_snapshot: validEmailSnapshot(draftId),
        },
      }],
      email_drafts: [{ id: draftId, empresa_id: "emp-A" }],
    }));

    const res = await GET();
    const body = await res.json() as { pendingApprovals: Array<{ id: string; emailPreview?: { to: string[] } }> };
    expect(body.pendingApprovals).toHaveLength(1);
    expect(body.pendingApprovals[0]).toMatchObject({ id: "ap-owned", emailPreview: { to: ["owner@example.com"] } });
  });

  it("conserva el preview para admin porque la política actual de email_drafts lo autoriza", async () => {
    const draftId = "10000000-0000-4000-8000-000000000005";
    mockRequireProfile.mockResolvedValue({ id: "u-admin", role: "admin", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(fakeDb({
      agent_tasks: [],
      agent_approvals: [{
        id: "ap-admin",
        tool_name: "send_email",
        created_at: "2026-01-01",
        empresa_id: "emp-A",
        status: "REQUESTED",
        payload_json: { draft_id: draftId, draft_snapshot: validEmailSnapshot(draftId, ["admin-visible@example.com"]) },
      }],
      email_drafts: [{ id: draftId, empresa_id: "emp-A" }],
    }));

    const res = await GET();
    const body = await res.json() as { pendingApprovals: Array<{ emailPreview?: { to: string[] } }> };
    expect(body.pendingApprovals).toHaveLength(1);
    expect(body.pendingApprovals[0].emailPreview?.to).toEqual(["admin-visible@example.com"]);
  });

  it("falla cerrado ante draft_id ausente, inválido o inconsistente con el snapshot", async () => {
    mockRequireProfile.mockResolvedValue({ id: "u1", role: "admin", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(fakeDb({
      agent_tasks: [],
      agent_approvals: [
        { id: "ap-missing", tool_name: "send_email", created_at: "2026-01-01", empresa_id: "emp-A", payload_json: {} },
        { id: "ap-malformed", tool_name: "send_email", created_at: "2026-01-01", empresa_id: "emp-A", payload_json: { draft_id: "not-a-uuid" } },
        {
          id: "ap-mismatch",
          tool_name: "send_email",
          created_at: "2026-01-01",
          empresa_id: "emp-A",
          payload_json: {
            draft_id: "10000000-0000-4000-8000-000000000003",
            draft_snapshot: { draftId: "10000000-0000-4000-8000-000000000004", to: ["leak@example.com"] },
          },
        },
        {
          id: "ap-malformed-preview",
          tool_name: "send_email",
          created_at: "2026-01-01",
          empresa_id: "emp-A",
          payload_json: {
            draft_id: "10000000-0000-4000-8000-000000000005",
            draft_snapshot: { draftId: "10000000-0000-4000-8000-000000000005", to: "not-an-array" },
          },
        },
      ],
      // The root draft is visible. Rejection must come from the snapshot ID
      // consistency/schema checks, not only from the absence of a readable row.
      email_drafts: [
        { id: "10000000-0000-4000-8000-000000000003", empresa_id: "emp-A" },
        { id: "10000000-0000-4000-8000-000000000005", empresa_id: "emp-A" },
      ],
    }));

    const res = await GET();
    const body = await res.json() as { pendingApprovals: unknown[] };
    expect(body.pendingApprovals).toEqual([]);
  });

  it("falla cerrado si falla la consulta session-bound de visibilidad del borrador", async () => {
    const draftId = "10000000-0000-4000-8000-000000000006";
    mockRequireProfile.mockResolvedValue({ id: "u-owner", role: "comercial", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(fakeDb({
      agent_tasks: [],
      agent_approvals: [{
        id: "ap-query-error",
        tool_name: "send_email",
        created_at: "2026-01-01",
        empresa_id: "emp-A",
        status: "REQUESTED",
        payload_json: { draft_id: draftId, draft_snapshot: validEmailSnapshot(draftId, ["must-not-leak@example.com"]) },
      }],
      email_drafts: [{ id: draftId, empresa_id: "emp-A" }],
    }, "email_drafts"));

    const res = await GET();
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain("must-not-leak@example.com");
    expect(serialized).not.toContain("ap-query-error");
  });

  it("error de DB deja runtime disabled en vez de romper el shell", async () => {
    mockRequireProfile.mockResolvedValue({ id: "u1", empresa_id: "emp-A" });
    mockCreateClient.mockResolvedValue(fakeDb({ agent_tasks: [] }, "agent_tasks"));
    const res = await GET();
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("disabled");
  });

  it("sin perfil responde 401", async () => {
    mockRequireProfile.mockRejectedValue(new Error("no session"));
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
