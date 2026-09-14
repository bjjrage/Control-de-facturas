import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { toolRegistry } from "../registry";
import {
  gatewayExecute,
  executeApprovedTool,
  GatewayError,
  PermissionError,
  ApprovalRequiredError,
  TenantError,
} from "../gateway";
import {
  createApproval,
  decideApproval,
  claimApprovalForExecution,
  markApprovalExecuted,
  hashPayload,
} from "../approvals";
import type { AgentToolContext } from "../context";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("BATCH 3: Approval Execution, Concurrency & Security Gateways", () => {
  const actorAdmin: AgentToolContext = {
    empresaId: "empresa-1",
    userId: "user-admin",
    role: "admin",
    actorType: "user",
    source: "web",
  };

  const actorComercial: AgentToolContext = {
    empresaId: "empresa-1",
    userId: "user-comercial",
    role: "comercial",
    actorType: "user",
    source: "web",
  };

  const actorSinPermiso: AgentToolContext = {
    empresaId: "empresa-1",
    userId: "user-sin-rol",
    role: "administracion", // no es admin ni comercial
    actorType: "user",
    source: "web",
  };

  let mockApprovalStore: Map<string, any>;
  let mockStepStore: any[];

  function createMockDb() {
    mockApprovalStore = new Map();
    mockStepStore = [];

    const db = {
      from: vi.fn((table: string) => {
        if (table === "agent_approvals") {
          return {
            insert: vi.fn((row: any) => {
              const created = {
                id: row.id || `ap-${Date.now()}-${Math.random()}`,
                ...row,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              mockApprovalStore.set(created.id, created);
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: created, error: null }),
              };
            }),
            select: vi.fn(() => ({
              eq: vi.fn(function (this: any, col: string, val: string) {
                this.filters = this.filters || {};
                this.filters[col] = val;
                return this;
              }),
              single: vi.fn(async function (this: any) {
                const id = this.filters?.id;
                const found = mockApprovalStore.get(id);
                if (!found) return { data: null, error: { code: "PGRST116", message: "Not found" } };
                return { data: { ...found }, error: null };
              }),
              maybeSingle: vi.fn(async function (this: any) {
                const id = this.filters?.id;
                const found = mockApprovalStore.get(id);
                return { data: found ? { ...found } : null, error: null };
              }),
            })),
            update: vi.fn((patch: any) => ({
              eq: vi.fn(function (this: any, col: string, val: string) {
                this.filters = this.filters || {};
                this.filters[col] = val;
                return this;
              }),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn(async function (this: any) {
                const id = this.filters?.id;
                const target = mockApprovalStore.get(id);
                if (!target) return { data: null, error: null };
                // Validar filtros condicionales (ej. empresa_id y status = 'APPROVED')
                if (this.filters?.empresa_id && target.empresa_id !== this.filters.empresa_id) {
                  return { data: null, error: null };
                }
                if (this.filters?.status && target.status !== this.filters.status) {
                  // Fallo de CAS (concurrencia)
                  return { data: null, error: null };
                }
                const updated = { ...target, ...patch, updated_at: new Date().toISOString() };
                mockApprovalStore.set(id, updated);
                return { data: updated, error: null };
              }),
              single: vi.fn(async function (this: any) {
                const id = this.filters?.id;
                const target = mockApprovalStore.get(id);
                if (!target) return { data: null, error: new Error("Not found") };
                if (this.filters?.status && target.status !== this.filters.status) {
                  return { data: null, error: new Error("CAS status mismatch") };
                }
                const updated = { ...target, ...patch, updated_at: new Date().toISOString() };
                mockApprovalStore.set(id, updated);
                return { data: updated, error: null };
              }),
            })),
          };
        }

        if (table === "agent_steps") {
          return {
            insert: vi.fn((row: any) => {
              mockStepStore.push(row);
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: "step-1", ...row }, error: null }),
              };
            }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as SupabaseClient;

    return db;
  }

  beforeEach(() => {
    toolRegistry.clearForTests();
    // Registrar un mock tool con risk level 2
    toolRegistry.register({
      name: "test_send_action",
      description: "Test action tool",
      inputSchema: z.object({ destination: z.string(), amount: z.number() }),
      riskLevel: 2,
      requiredRoles: ["comercial", "admin"],
      handler: vi.fn().mockResolvedValue({ success: true, dispatched: true }),
    });

    // Registrar un mock tool con risk level 3
    toolRegistry.register({
      name: "test_financial_commitment",
      description: "Test financial tool",
      inputSchema: z.object({ po_id: z.string(), total: z.number() }),
      riskLevel: 3,
      requiredRoles: ["admin"],
      handler: vi.fn().mockResolvedValue({ success: true, committed: true }),
    });
  });

  it("1. Risk >= 2 genera approval en REQUESTED y no ejecuta el handler", async () => {
    const db = createMockDb();
    const tool = toolRegistry.get("test_send_action")!;
    const handlerSpy = vi.spyOn(tool, "handler");

    await expect(
      gatewayExecute({
        db,
        actor: actorAdmin,
        toolName: "test_send_action",
        rawInput: { destination: "Prov-A", amount: 500 },
        taskId: "task-100",
        runId: "run-100",
      })
    ).rejects.toThrow(ApprovalRequiredError);

    expect(handlerSpy).not.toHaveBeenCalled();

    // Verificamos que se guardó en agent_approvals
    expect(mockApprovalStore.size).toBe(1);
    const [approval] = Array.from(mockApprovalStore.values());
    expect(approval.status).toBe("REQUESTED");
    expect(approval.risk_level).toBe(2);
    expect(approval.tool_name).toBe("test_send_action");
  });

  it("2. Flujo completo: REQUESTED -> decide APPROVED -> executeApprovedTool -> EXECUTED", async () => {
    const db = createMockDb();
    const tool = toolRegistry.get("test_send_action")!;
    const handlerSpy = vi.spyOn(tool, "handler");

    // Paso 1: Pedir tool
    let approvalId = "";
    try {
      await gatewayExecute({
        db,
        actor: actorAdmin,
        toolName: "test_send_action",
        rawInput: { destination: "Prov-A", amount: 500 },
        taskId: "task-100",
        runId: "run-100",
      });
    } catch (e: any) {
      approvalId = e.approvalId;
    }

    expect(approvalId).toBeTruthy();

    // Paso 2: Decisión humana (APPROVED)
    const approvedRow = await decideApproval({
      db,
      approvalId,
      empresaId: "empresa-1",
      decidedBy: "user-admin",
      decision: "APPROVED",
    });
    expect(approvedRow.status).toBe("APPROVED");

    // Paso 3: Ejecución controlada por Gateway
    const execResult = await executeApprovedTool({
      db,
      actor: actorAdmin,
      approvalId,
      payloadToExecute: { destination: "Prov-A", amount: 500 },
    });

    expect(execResult.ok).toBe(true);
    expect(execResult.tool).toBe("test_send_action");
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // Estado final en BD debe ser EXECUTED
    const finalRow = mockApprovalStore.get(approvalId);
    expect(finalRow.status).toBe("EXECUTED");
  });

  it("3. Anti-Replay & Concurrencia: Doble click o requests concurrentes ejecutan EXACTAMENTE UNA VEZ", async () => {
    const db = createMockDb();
    const tool = toolRegistry.get("test_send_action")!;
    const handlerSpy = vi.spyOn(tool, "handler");

    // Crear approval directamente en APPROVED
    const payload = { destination: "Prov-A", amount: 500 };
    const hash = hashPayload(payload);
    const approvalId = "ap-concurrency-test";
    mockApprovalStore.set(approvalId, {
      id: approvalId,
      empresa_id: "empresa-1",
      task_id: "t-1",
      run_id: "r-1",
      tool_name: "test_send_action",
      payload_json: payload,
      payload_hash: hash,
      risk_level: 2,
      status: "APPROVED",
    });

    // Simular 2 llamadas concurrentes a executeApprovedTool
    const call1 = executeApprovedTool({
      db,
      actor: actorAdmin,
      approvalId,
      payloadToExecute: payload,
    });

    const call2 = executeApprovedTool({
      db,
      actor: actorAdmin,
      approvalId,
      payloadToExecute: payload,
    });

    const results = await Promise.allSettled([call1, call2]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactamente 1 triunfó y exactamente 1 fue rechazada
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // El handler sólo corrió 1 vez (sin doble side-effect)
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // El error de la segunda llamada debe indicar que ya no está en APPROVED
    const rejReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejReason.message).toMatch(/requiere APPROVED/i);
  });

  it("4. Integridad de Payload: Payload modificado después de la aprobación es DENEGADO", async () => {
    const db = createMockDb();
    const originalPayload = { destination: "Prov-A", amount: 500 };
    const alteredPayload = { destination: "Prov-Hacked", amount: 500 };

    const approvalId = "ap-tamper-test";
    mockApprovalStore.set(approvalId, {
      id: approvalId,
      empresa_id: "empresa-1",
      task_id: "t-1",
      run_id: "r-1",
      tool_name: "test_send_action",
      payload_json: originalPayload,
      payload_hash: hashPayload(originalPayload),
      risk_level: 2,
      status: "APPROVED",
    });

    await expect(
      executeApprovedTool({
        db,
        actor: actorAdmin,
        approvalId,
        payloadToExecute: alteredPayload,
      })
    ).rejects.toThrow(/Payload alterado/);
  });

  it("5. Permission Revalidation: Si el actor perdió el permiso al momento de ejecutar, es DENEGADO", async () => {
    const db = createMockDb();
    const payload = { po_id: "po-1", total: 1000 };

    const approvalId = "ap-perm-test";
    mockApprovalStore.set(approvalId, {
      id: approvalId,
      empresa_id: "empresa-1",
      task_id: "t-1",
      run_id: "r-1",
      tool_name: "test_financial_commitment",
      payload_json: payload,
      payload_hash: hashPayload(payload),
      risk_level: 3,
      status: "APPROVED",
    });

    // actorSinPermiso no tiene rol 'admin'
    await expect(
      executeApprovedTool({
        db,
        actor: actorSinPermiso,
        approvalId,
        payloadToExecute: payload,
      })
    ).rejects.toThrow(PermissionError);
  });

  it("6. Tenant Isolation: Intento de ejecutar un approval de otra empresa es DENEGADO", async () => {
    const db = createMockDb();
    const payload = { destination: "Prov-A", amount: 500 };

    const approvalId = "ap-cross-tenant";
    mockApprovalStore.set(approvalId, {
      id: approvalId,
      empresa_id: "empresa-OTRA", // otra empresa
      task_id: "t-1",
      run_id: "r-1",
      tool_name: "test_send_action",
      payload_json: payload,
      payload_hash: hashPayload(payload),
      risk_level: 2,
      status: "APPROVED",
    });

    await expect(
      executeApprovedTool({
        db,
        actor: actorAdmin, // empresa-1
        approvalId,
        payloadToExecute: payload,
      })
    ).rejects.toThrow(TenantError);
  });
});
