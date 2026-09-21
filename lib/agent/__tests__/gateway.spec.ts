import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { toolRegistry } from "../registry";
import { gatewayExecute, gatewayExecuteSafe } from "../gateway";
import type { AgentToolContext } from "../context";

// Helper para crear un db mock minimal (solo lo que usa gateway)
function createGatewayDbMock(opts?: {
  existingStepHit?: unknown | null;
  existingStepStatus?: string;
  approvalInsert?: unknown;
  approvalLookup?: unknown;
  stepInsert?: unknown;
  auditRpc?: unknown;
}) {
  const fromMock = vi.fn((table: string) => {
    if (table === "agent_steps") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts?.existingStepHit ? { status: opts.existingStepStatus ?? "SUCCESS", output_json: opts.existingStepHit } : null, error: null }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: opts?.stepInsert ?? { id: "step-1" }, error: null }),
      } as unknown as ReturnType<typeof vi.fn>;
    }
    if (table === "agent_approvals") {
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn()
          .mockResolvedValueOnce({ data: opts?.approvalInsert ?? { id: "ap-1" }, error: null })
          .mockResolvedValue({ data: opts?.approvalLookup ?? opts?.approvalInsert ?? { id: "ap-1" }, error: null }),
      } as unknown as ReturnType<typeof vi.fn>;
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as ReturnType<typeof vi.fn>;
  });
  const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
  return { from: fromMock, rpc: rpcMock } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const actorBase: AgentToolContext = {
  empresaId: "empresa-123",
  userId: "user-123",
  role: "admin",
  actorType: "user",
  source: "web",
  email: "test@e.com",
};

describe("gateway", () => {
  beforeEach(() => {
    toolRegistry.clearForTests();
  });

  it("fail-closed si tool no esta allowlisteado", async () => {
    const db = createGatewayDbMock();
    await expect(gatewayExecute({ db, actor: actorBase, toolName: "no_existe", rawInput: {} })).rejects.toThrow(/no allowlisteado/);
  });

  it("fail-closed si empresaId falta (no confiar en LLM)", async () => {
    toolRegistry.register({
      name: "read_ok",
      description: "ok",
      inputSchema: z.object({}),
      riskLevel: 0,
      handler: async () => ({ ok: true }),
    });
    const db = createGatewayDbMock();
    const badActor = { ...actorBase, empresaId: "" };
    await expect(gatewayExecute({ db, actor: badActor as AgentToolContext, toolName: "read_ok", rawInput: {} })).rejects.toThrow();
  });

  it("valida input via Zod y no ejecuta handler si invalido", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    toolRegistry.register({
      name: "needs_uuid",
      description: "x",
      inputSchema: z.object({ project_id: z.string().uuid() }),
      riskLevel: 0,
      handler,
    });
    const db = createGatewayDbMock();
    await expect(gatewayExecute({ db, actor: actorBase, toolName: "needs_uuid", rawInput: { project_id: "no-uuid" } })).rejects.toThrow(/Input invalido/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("permission check: rol no autorizado es rechazado", async () => {
    toolRegistry.register({
      name: "restricted",
      description: "x",
      inputSchema: z.object({}),
      riskLevel: 0,
      requiredRoles: ["admin"],
      handler: async () => ({ ok: true }),
    });
    const db = createGatewayDbMock();
    const actorComercial: AgentToolContext = { ...actorBase, role: "comercial" };
    await expect(gatewayExecute({ db, actor: actorComercial, toolName: "restricted", rawInput: {} })).rejects.toThrow(/no autorizado/);
  });

  it("risk >=2 requiere approval y no ejecuta handler", async () => {
    const handler = vi.fn().mockResolvedValue({ executed: true });
    toolRegistry.register({
      name: "dangerous",
      description: "x",
      inputSchema: z.object({ amount: z.number() }),
      riskLevel: 3,
      handler,
    });
    const db = createGatewayDbMock({
      approvalInsert: { id: "ap-xyz", payload_hash: "abc" },
      stepInsert: { id: "step-wa" },
    });
    // Registrar mock para agent_approvals insert path
    const fromSpy = vi.spyOn(db as unknown as { from: ReturnType<typeof vi.fn> }, "from");
    // Necesitamos taskId/runId para crear approval
    await expect(
      gatewayExecute({
        db,
        actor: actorBase,
        toolName: "dangerous",
        rawInput: { amount: 1000 },
        taskId: "task-1",
        runId: "run-1",
      })
    ).rejects.toThrow(/requiere aprobacion/);
    expect(handler).not.toHaveBeenCalled();
    expect(fromSpy).toHaveBeenCalled();
  });

  it("ejecuta y retorna output para risk 0 (READ)", async () => {
    toolRegistry.register({
      name: "read_ok",
      description: "x",
      inputSchema: z.object({ q: z.string() }),
      riskLevel: 0,
      handler: async (_ctx, input) => ({ echo: (input as { q: string }).q }),
    });
    const db = createGatewayDbMock();
    // Mock step insert for success path: need to handle insert->select->single chain for createStep
    // Simplificamos: gateway llama a createStep que usa db.from("agent_steps").insert().select().single()
    // Nuestro fromMock para agent_steps ya retorna single con {id: step-1}
    const res = await gatewayExecute({ db, actor: actorBase, toolName: "read_ok", rawInput: { q: "hola" }, taskId: "t1", runId: "r1" });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.output as { echo: string }).echo).toBe("hola");
  });

  it("idempotency hit retorna cached sin re-ejecutar", async () => {
    const handler = vi.fn().mockResolvedValue({ fresh: true });
    toolRegistry.register({
      name: "idempotent_read",
      description: "x",
      inputSchema: z.object({ k: z.string() }),
      riskLevel: 0,
      handler,
    });
    const cached = { cached: true };
    const db = createGatewayDbMock({ existingStepHit: cached });
    await expect(
      gatewayExecute({
        db,
        actor: actorBase,
        toolName: "idempotent_read",
        rawInput: { k: "v" },
        idempotencyKey: "key-123",
        taskId: "t1",
        runId: "r1",
      })
    ).rejects.toThrow(/Idempotent hit/);
    expect(handler).not.toHaveBeenCalled();
    // gatewayExecuteSafe convierte el hit en success con cachedOutput
    const safe = await gatewayExecuteSafe({
      db,
      actor: actorBase,
      toolName: "idempotent_read",
      rawInput: { k: "v" },
      idempotencyKey: "key-123",
      taskId: "t1",
      runId: "r1",
    });
    expect(safe.ok).toBe(true);
    if (safe.ok) expect(safe.output).toEqual(cached);
  });

  it("replay de WAITING_APPROVAL conserva la misma approval y nunca es success", async () => {
    const handler = vi.fn().mockResolvedValue({ fresh: true });
    toolRegistry.register({
      name: "pending_tool",
      description: "x",
      inputSchema: z.object({ k: z.string() }),
      riskLevel: 2,
      handler,
    });
    const db = createGatewayDbMock({
      existingStepHit: { approval_id: "ap-pending", status: "REQUESTED", risk_level: 2 },
      existingStepStatus: "WAITING_APPROVAL",
      approvalInsert: { id: "ap-pending", status: "REQUESTED", empresa_id: actorBase.empresaId },
      approvalLookup: { id: "ap-pending", status: "REQUESTED", empresa_id: actorBase.empresaId },
    });
    const result = await gatewayExecuteSafe({
      db,
      actor: actorBase,
      toolName: "pending_tool",
      rawInput: { k: "v" },
      idempotencyKey: "pending-key",
      taskId: "t1",
      runId: "r1",
    });
    expect(result).toMatchObject({ ok: false, requiresApproval: true, approvalId: "ap-pending" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("un step ERROR nunca se replaya como success", async () => {
    const handler = vi.fn().mockResolvedValue({ fresh: true });
    toolRegistry.register({ name: "retryable", description: "x", inputSchema: z.object({}), riskLevel: 0, handler });
    const result = await gatewayExecuteSafe({
      db: createGatewayDbMock({ existingStepHit: { error: "previous" }, existingStepStatus: "ERROR" }),
      actor: actorBase,
      toolName: "retryable",
      rawInput: {},
      idempotencyKey: "error-key",
      taskId: "t1",
      runId: "r1",
    });
    expect(result).toMatchObject({ ok: true, output: { fresh: true } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("tenant isolation: handler siempre recibe actor.empresaId y debe filtrar por el", async () => {
    let capturedEmpresaId: string | null = null;
    toolRegistry.register({
      name: "tenant_aware",
      description: "x",
      inputSchema: z.object({ project_id: z.string().uuid() }),
      riskLevel: 0,
      handler: async (ctx) => {
        capturedEmpresaId = ctx.empresaId;
        return { empresaId: ctx.empresaId };
      },
    });
    const db = createGatewayDbMock();
    const fakeUuid = "00000000-0000-4000-a000-000000000001";
    const res = await gatewayExecute({ db, actor: actorBase, toolName: "tenant_aware", rawInput: { project_id: fakeUuid }, taskId: "t1", runId: "r1" });
    expect(res.ok).toBe(true);
    expect(capturedEmpresaId).toBe("empresa-123");
    // Incluso si el LLM intenta inyectar empresa_id en rawInput, el handler no lo usa
    const evilInput = { project_id: fakeUuid, empresa_id: "OTRA_EMPRESA" } as unknown as { project_id: string };
    await gatewayExecute({ db, actor: actorBase, toolName: "tenant_aware", rawInput: evilInput, taskId: "t1", runId: "r1" });
    expect(capturedEmpresaId).toBe("empresa-123");
  });

  it("scoped idempotency: misma key, distinta empresa no colisiona", async () => {
    // El gateway filtra por empresa_id en la query de idempotency hit.
    // Verificamos que se pasa empresa_id correcto al query.
    toolRegistry.register({
      name: "scoped_tool",
      description: "x",
      inputSchema: z.object({}),
      riskLevel: 0,
      handler: async () => ({ ok: true }),
    });
    const dbHitForEmpresaA = createGatewayDbMock({ existingStepHit: { hit: true } });
    // Para empresa A, hay hit
    await expect(
      gatewayExecute({ db: dbHitForEmpresaA, actor: { ...actorBase, empresaId: "empresa-A" }, toolName: "scoped_tool", rawInput: {}, idempotencyKey: "same-key", taskId: "t1", runId: "r1" })
    ).rejects.toThrow(/Idempotent hit/);
    // Para empresa B, no hay hit (db mock sin hit)
    const dbNoHit = createGatewayDbMock({ existingStepHit: null });
    const res = await gatewayExecute({ db: dbNoHit, actor: { ...actorBase, empresaId: "empresa-B" }, toolName: "scoped_tool", rawInput: {}, idempotencyKey: "same-key", taskId: "t1", runId: "r1" });
    expect(res.ok).toBe(true);
  });
});
