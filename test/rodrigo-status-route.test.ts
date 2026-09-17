import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireProfile, mockCreateClient } = vi.hoisted(() => ({
  mockRequireProfile: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: mockRequireProfile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

import { GET } from "@/app/api/agent/status/route";

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, errorOn?: string) {
  return {
    from: (table: string) => {
      const builder = {
        _eq: [] as Array<[string, unknown]>,
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          builder._eq.push([col, val]);
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
