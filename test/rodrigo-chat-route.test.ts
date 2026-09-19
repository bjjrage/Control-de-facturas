import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireProfile, mockCreateClient, mockGatewayExecuteSafe, mockOrchestratorRun } = vi.hoisted(() => ({
  mockRequireProfile: vi.fn(),
  mockCreateClient: vi.fn(),
  mockGatewayExecuteSafe: vi.fn(),
  mockOrchestratorRun: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: mockRequireProfile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/agent/gateway", () => ({ gatewayExecuteSafe: mockGatewayExecuteSafe }));
vi.mock("@/lib/agent/orchestrator", () => ({
  AgentOrchestrator: class {
    run(...args: unknown[]) {
      return (mockOrchestratorRun as (...a: unknown[]) => Promise<unknown>)(...args);
    }
  },
  DeepSeekConfigError: class DeepSeekConfigError extends Error {},
}));

import { POST } from "@/app/api/agent/chat/route";

type Row = Record<string, unknown>;

function fakeChatDb() {
  const tasks: Row[] = [];
  const runs: Row[] = [];
  let taskSeq = 0;
  let runSeq = 0;
  const store = (t: string) => (t === "agent_tasks" ? tasks : runs);
  return {
    tasks,
    runs,
    from: (table: string) => {
      const rows = store(table);
      const builder = {
        _filters: [] as Array<(r: Row) => boolean>,
        _payload: null as unknown,
        _isInsert: false,
        _isUpdate: false,
        select() {
          return builder;
        },
        insert(payload: unknown) {
          builder._payload = payload;
          builder._isInsert = true;
          return builder;
        },
        update(patch: unknown) {
          builder._payload = patch;
          builder._isUpdate = true;
          return builder;
        },
        eq(col: string, val: unknown) {
          builder._filters.push((r) => r[col] === val);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          const hit = rows.find((r) => builder._filters.every((f) => f(r))) ?? null;
          return Promise.resolve({ data: hit, error: null });
        },
        single() {
          if (builder._isInsert) {
            const row = {
              id: table === "agent_tasks" ? `task-${(taskSeq += 1)}` : `run-${(runSeq += 1)}`,
              ...(builder._payload as Row),
            };
            rows.push(row);
            return Promise.resolve({ data: row, error: null });
          }
          const filtered = rows.filter((r) => builder._filters.every((f) => f(r)));
          if (builder._isUpdate) {
            for (const r of filtered) Object.assign(r, builder._payload as Row);
          }
          const hit = filtered[0] ?? null;
          if (!hit) return Promise.resolve({ data: null, error: { code: "PGRST116", message: "none" } });
          return Promise.resolve({ data: hit, error: null });
        },
      };
      return builder;
    },
  };
}

function postMessage(message: unknown) {
  return POST(
    new Request("http://localhost/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
  );
}

const PROFILE = { id: "user-1", empresa_id: "emp-T" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RODRIGO_ALLOW_DETERMINISTIC_FALLBACK", "true");
  mockRequireProfile.mockResolvedValue(PROFILE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/agent/chat", () => {
  it("texto llega al Gateway con el tenant del perfil y responde el tool", async () => {
    const db = fakeChatDb();
    mockCreateClient.mockResolvedValue(db);
    mockGatewayExecuteSafe.mockResolvedValue({
      ok: true,
      tool: "get_stock_availability",
      output: { stock_actual: 5, reservado: 0, disponible: 5 },
    });

    const res = await postMessage(`¿stock del producto 00000000-0000-4000-a000-000000000001?`);
    const body = (await res.json()) as { answer: string; taskId: string; state: string };
    expect(res.status).toBe(200);
    expect(body.answer).toContain("5");
    // El gateway recibió el tenant del perfil, no del texto.
    expect(mockGatewayExecuteSafe).toHaveBeenCalledTimes(1);
    const call = mockGatewayExecuteSafe.mock.calls[0]?.[0] as { actor: { empresaId: string }; toolName: string };
    expect(call.actor.empresaId).toBe("emp-T");
    expect(call.toolName).toBe("get_stock_availability");
    // La task durable quedó COMPLETED.
    expect(db.tasks).toHaveLength(1);
    expect(db.tasks[0]?.empresa_id).toBe("emp-T");
    expect(db.tasks[0]?.status).toBe("COMPLETED");
  });

  it("tool con approval deja la task en WAITING_APPROVAL sin ejecutar", async () => {
    const db = fakeChatDb();
    mockCreateClient.mockResolvedValue(db);
    // El router manda el texto a get_stock_availability; el gateway frena
    // con approval: la task debe quedar en espera durable, sin ejecutar.
    mockGatewayExecuteSafe.mockResolvedValue({
      ok: false,
      requiresApproval: true,
      tool: "get_stock_availability",
      approvalId: "ap-9",
      riskLevel: 2,
      message: "approval",
    });

    const res = await postMessage(`stock del producto 00000000-0000-4000-a000-000000000001`);
    const body = (await res.json()) as {
      state: string;
      approval: { id: string } | null;
    };
    expect(body.state).toBe("approval");
    expect(body.approval?.id).toBe("ap-9");
    expect(db.tasks[0]?.status).toBe("WAITING_APPROVAL");
  });

  it("con DEEPSEEK_API_KEY el texto llega al Orchestrator real", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const db = fakeChatDb();
    mockCreateClient.mockResolvedValue(db);
    mockOrchestratorRun.mockResolvedValue({
      answer: "Respuesta del LLM.",
      turns: [],
      usage: null,
      iterations: 1,
      stoppedReason: "answered",
      approvalId: null,
    });

    const res = await postMessage("hola rodrigo");
    const body = (await res.json()) as { answer: string; state: string };
    expect(res.status).toBe(200);
    expect(body.answer).toBe("Respuesta del LLM.");
    expect(mockOrchestratorRun).toHaveBeenCalledTimes(1);
    const input = mockOrchestratorRun.mock.calls[0]?.[0] as { userIntent: string; taskId: string };
    expect(input.userIntent).toBe("hola rodrigo");
    expect(typeof input.taskId).toBe("string");
    expect(db.tasks[0]?.status).toBe("COMPLETED");
  });

  it("mensaje vacío es 400 sin crear task", async () => {
    const db = fakeChatDb();
    mockCreateClient.mockResolvedValue(db);
    const res = await postMessage("   ");
    expect(res.status).toBe(400);
    expect(db.tasks).toHaveLength(0);
  });
});
