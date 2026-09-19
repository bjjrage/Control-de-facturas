// lib/agent/gateway.ts
// Tool Gateway — security boundary entre LLM y Domain Services.
// Orden conceptual (fail-closed):
//   trusted actor context -> tenant -> allowlisted tool -> permission -> Zod -> state -> risk/approval -> idempotency -> execute -> audit -> structured result
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "./context";
import { assertActorHasTenant } from "./context";
import { getTool } from "./registry";
import {
  createApproval,
  getApproval,
  claimApprovalForExecution,
  markApprovalExecuted,
  markApprovalFailed,
  assertPayloadMatchesApproval,
} from "./approvals";
import { createStep } from "./runtime";

// ---------------------------------------------------------------------------
// Errors (fail-closed, tipados para que el orchestrator pueda ramificar)
// ---------------------------------------------------------------------------
export class GatewayError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GatewayError";
  }
}
export class TenantError extends GatewayError {
  constructor(msg: string) {
    super("TENANT_ERROR", msg);
    this.name = "TenantError";
  }
}
export class PermissionError extends GatewayError {
  constructor(msg: string) {
    super("PERMISSION_DENIED", msg);
    this.name = "PermissionError";
  }
}
export class ValidationError extends GatewayError {
  constructor(msg: string) {
    super("VALIDATION_ERROR", msg);
    this.name = "ValidationError";
  }
}
export class ApprovalRequiredError extends GatewayError {
  approvalId: string;
  constructor(msg: string, approvalId: string) {
    super("APPROVAL_REQUIRED", msg);
    this.name = "ApprovalRequiredError";
    this.approvalId = approvalId;
  }
}
export class IdempotencyHit extends GatewayError {
  cachedOutput: unknown;
  constructor(cachedOutput: unknown) {
    super("IDEMPOTENCY_HIT", "Idempotent hit — resultado cacheado");
    this.name = "IdempotencyHit";
    this.cachedOutput = cachedOutput;
  }
}

// ---------------------------------------------------------------------------
// Gateway execution
// ---------------------------------------------------------------------------
export interface GatewayExecuteParams {
  db: SupabaseClient;
  actor: AgentToolContext;
  toolName: string;
  rawInput: unknown;
  /** Solo si el caller quiere idempotencia tool-level (recomendado para mutations futuras). */
  idempotencyKey?: string | null;
  /** Para auditoria/traceability */
  taskId?: string | null;
  runId?: string | null;
}

export interface GatewaySuccess {
  ok: true;
  tool: string;
  output: unknown;
  // Para que el orchestrator persista el step si quiere (gateway ya creo step si task/run se pasaron)
  stepId?: string | null;
}

export interface GatewayApprovalPending {
  ok: false;
  requiresApproval: true;
  tool: string;
  approvalId: string;
  riskLevel: number;
  message: string;
}

export type GatewayResult = GatewaySuccess | GatewayApprovalPending;

const MAX_INPUT_JSON_BYTES = 16 * 1024;

function sanitizeInputForLog(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  const s = JSON.stringify(input);
  if (s.length > MAX_INPUT_JSON_BYTES) return { _truncated: true, _bytes: s.length };
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    const redacted = new Set(["api_key", "apikey", "token", "secret", "password", "authorization"]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = redacted.has(k.toLowerCase()) ? "[REDACTED]" : v;
    }
    return out;
  }
  return input;
}

/**
 * Ejecuta un tool a traves del gateway con todas las validaciones.
 * - Si riskLevel >= 2 => no ejecuta, crea approval REQUESTED y lanza ApprovalRequiredError.
 *   Llamadores que no quieren excepcion pueden capturar y convertir a GatewayApprovalPending.
 * - Si idempotencyKey hit => retorna cached output (via IdempotencyHit).
 */
export async function gatewayExecute(params: GatewayExecuteParams): Promise<GatewaySuccess> {
  const { db, actor, toolName, rawInput, idempotencyKey, taskId, runId } = params;

  // 1. Trusted actor context
  assertActorHasTenant(actor);
  if (!actor.empresaId) throw new TenantError("empresaId requerido en actor context");

  // 2. Allowlisted tool
  const tool = getTool(toolName);
  if (!tool) {
    throw new GatewayError("TOOL_NOT_FOUND", `Tool no allowlisteado: ${toolName}`);
  }

  // 3. Permission check (requiredRoles)
  if (tool.requiredRoles && tool.requiredRoles.length > 0) {
    const role = actor.role;
    if (!role || !(tool.requiredRoles as string[]).includes(role)) {
      throw new PermissionError(
        `Rol ${role ?? "sin rol"} no autorizado para ${toolName}. Requiere: ${tool.requiredRoles.join(",")}`
      );
    }
  }

  // 4. Zod validation (fail-closed: input invalido => error, no se ejecuta)
  let parsedInput: unknown;
  try {
    parsedInput = (tool.inputSchema as z.ZodTypeAny).parse(rawInput);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e);
    throw new ValidationError(`Input invalido para ${toolName}: ${msg}`);
  }

  // 5. Idempotency check (tool-level) — buscar step previo con misma key+tool+empresa
  if (idempotencyKey && toolName) {
    const { data: hit } = await db
      .from("agent_steps")
      .select("output_json")
      .eq("empresa_id", actor.empresaId)
      .eq("tool_name", toolName)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (hit) {
      // No re-ejecutar, devolver cached
      throw new IdempotencyHit((hit as { output_json: unknown }).output_json);
    }
  }

  // 6. Risk / approval policy
  // Tools con riskLevel >= 2 requieren aprobación humana explícita previa
  if (tool.riskLevel >= 2) {
    if (!taskId || !runId) {
      throw new GatewayError(
        "APPROVAL_CONTEXT_MISSING",
        `Tool ${toolName} (risk ${tool.riskLevel}) requiere taskId/runId para crear approval`
      );
    }
    const approval = await createApproval({
      db,
      empresaId: actor.empresaId,
      taskId,
      runId,
      toolName,
      payload: parsedInput,
      riskLevel: tool.riskLevel,
      requestedBy: actor.userId,
    });
    // Registrar step WAITING_APPROVAL para trazabilidad
    try {
      await createStep({
        db,
        taskId,
        runId,
        empresaId: actor.empresaId,
        toolName,
        input: sanitizeInputForLog(parsedInput),
        output: { approval_id: approval.id, status: "REQUESTED", risk_level: tool.riskLevel },
        status: "WAITING_APPROVAL",
        idempotencyKey: idempotencyKey ?? null,
      });
    } catch {
      // no bloquear el flujo si el step falla
    }
    throw new ApprovalRequiredError(`Tool ${toolName} requiere aprobacion (risk ${tool.riskLevel})`, approval.id);
  }

  // 7. Execute domain service via handler (handler recibe ctx ya scoped por empresaId)
  const toolCtx: AgentToolContext = { ...actor };
  const started = Date.now();
  let output: unknown;
  try {
    // El handler hace su propia query con empresa_id = ctx.empresaId (nunca confia en input.empresaId)
    output = await tool.handler(toolCtx, parsedInput as never, { db });
  } catch (e) {
    // 7b. Persistir step ERROR para observabilidad, luego re-throw como GatewayError
    const errMsg = e instanceof Error ? e.message : String(e);
    if (taskId && runId) {
      try {
        await createStep({
          db,
          taskId,
          runId,
          empresaId: actor.empresaId,
          toolName,
          input: sanitizeInputForLog(parsedInput),
          output: null,
          status: "ERROR",
          errorMessage: errMsg.slice(0, 2000),
          idempotencyKey: idempotencyKey ?? null,
          durationMs: Date.now() - started,
        });
      } catch {
        // ignore
      }
    }
    // Log de auditoria best-effort (no bloquear)
    try {
      await db.rpc("log_audit_event", {
        p_action: `agent.tool.error:${toolName}`,
        p_detail: { empresa_id: actor.empresaId, tool: toolName, error: errMsg.slice(0, 500) } as never,
        p_actor_type: "agent",
        p_actor_label: actor.email ?? actor.userId ?? "agent",
      } as never);
    } catch {
      // ignore
    }
    throw new GatewayError("TOOL_EXECUTION_FAILED", `Error ejecutando ${toolName}: ${errMsg}`);
  }

  const durationMs = Date.now() - started;

  // 8. Persistir step SUCCESS (solo si hay task/run; si no, es llamada suelta y no se persiste step)
  let stepId: string | null = null;
  if (taskId && runId) {
    try {
      const step = await createStep({
        db,
        taskId,
        runId,
        empresaId: actor.empresaId,
        toolName,
        input: sanitizeInputForLog(parsedInput),
        output,
        status: "SUCCESS",
        idempotencyKey: idempotencyKey ?? null,
        durationMs,
      });
      stepId = step.id;
    } catch {
      // no bloquear retorno si el step falla
    }
  }

  // 9. Audit log (best-effort, no bloquear si falla)
  try {
    await db.rpc("log_audit_event", {
      p_action: `agent.tool:${toolName}`,
      p_detail: {
        empresa_id: actor.empresaId,
        tool: toolName,
        risk_level: tool.riskLevel,
        task_id: taskId ?? null,
        run_id: runId ?? null,
      } as never,
      p_actor_type: "agent",
      p_actor_label: actor.email ?? actor.userId ?? "agent",
    } as never);
  } catch {
    // ignore audit failure — no debe romper la ejecución
  }

  return { ok: true, tool: toolName, output, stepId };
}

/**
 * Wrapper que convierte ApprovalRequiredError / IdempotencyHit en resultados
 * estructurados sin excepcion (util para orchestrator que no quiere try/catch).
 */
export async function gatewayExecuteSafe(params: GatewayExecuteParams): Promise<GatewayResult> {
  try {
    return await gatewayExecute(params);
  } catch (e) {
    if (e instanceof ApprovalRequiredError) {
      const tool = getTool(params.toolName);
      return {
        ok: false,
        requiresApproval: true,
        tool: params.toolName,
        approvalId: e.approvalId,
        riskLevel: tool?.riskLevel ?? 99,
        message: e.message,
      };
    }
    if (e instanceof IdempotencyHit) {
      return { ok: true, tool: params.toolName, output: e.cachedOutput, stepId: null };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// BATCH 3: executeApprovedTool — Consumo y ejecución de approvals
// ---------------------------------------------------------------------------
export interface ExecuteApprovedToolParams {
  db: SupabaseClient;
  actor: AgentToolContext;
  approvalId: string;
  payloadToExecute: unknown;
  idempotencyKey?: string | null;
}

export interface ExecuteApprovedToolResult {
  ok: true;
  approvalId: string;
  tool: string;
  output: unknown;
  stepId?: string | null;
}

/**
 * Ejecuta un tool tras haber sido aprobado por un humano.
 * Flujo obligatorio y fail-closed:
 * 1. Cargar approval y validar tenant scoping.
 * 2. Revalidar permisos actuales del actor (no confiar en permiso pasado).
 * 3. Revalidar que payload coincida bit a bit con payload_hash.
 * 4. Adquirir lock atómico (APPROVED -> EXECUTING). Falla si ya fue consumido.
 * 5. Ejecutar tool handler del Domain Service.
 * 6. Transicionar approval a EXECUTED.
 * 7. Persistir step SUCCESS y auditoría.
 */
export async function executeApprovedTool(
  params: ExecuteApprovedToolParams
): Promise<ExecuteApprovedToolResult> {
  const { db, actor, approvalId, payloadToExecute, idempotencyKey } = params;

  // 1. Trusted actor context & tenant
  assertActorHasTenant(actor);
  if (!actor.empresaId) throw new TenantError("empresaId requerido en actor context");

  const approval = await getApproval(db, approvalId);
  if (!approval) {
    throw new GatewayError("APPROVAL_NOT_FOUND", `Approval no encontrado: ${approvalId}`);
  }
  if (approval.empresa_id !== actor.empresaId) {
    throw new TenantError("Approval no pertenece a tu empresa");
  }

  // 2. Allowlisted tool check
  const tool = getTool(approval.tool_name);
  if (!tool) {
    throw new GatewayError("TOOL_NOT_FOUND", `Tool no allowlisteado: ${approval.tool_name}`);
  }

  // 3. Permission revalidation: verificar permisos ACTUALES del actor al momento de la ejecución
  if (tool.requiredRoles && tool.requiredRoles.length > 0) {
    const role = actor.role;
    if (!role || !(tool.requiredRoles as string[]).includes(role)) {
      throw new PermissionError(
        `Rol actual ${role ?? "sin rol"} no autorizado para ejecutar ${approval.tool_name}. Requiere: ${tool.requiredRoles.join(",")}`
      );
    }
  }

  // 4. Payload integrity check (assertPayloadMatchesApproval)
  assertPayloadMatchesApproval(approval, payloadToExecute);

  // 5. Atomic claim: transicionar de APPROVED a EXECUTING (Optimistic CAS)
  // Si otra llamada concurrente o doble click intenta ejecutarlo, esta llamada falla acá.
  await claimApprovalForExecution({
    db,
    approvalId,
    empresaId: actor.empresaId,
  });

  // 6. Execute domain service via tool handler
  const toolCtx: AgentToolContext = {
    ...actor,
    taskId: approval.task_id,
    runId: approval.run_id,
    approvalId,
  };

  const started = Date.now();
  let output: unknown;
  try {
    output = await tool.handler(toolCtx, payloadToExecute as never, { db });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Marcar approval como FAILED si falló la ejecución
    try {
      await markApprovalFailed({
        db,
        approvalId,
        empresaId: actor.empresaId,
        errorMessage: errMsg,
      });
    } catch {
      // ignore
    }

    // Persistir step de error
    try {
      await createStep({
        db,
        taskId: approval.task_id,
        runId: approval.run_id ?? approval.task_id,
        empresaId: actor.empresaId,
        toolName: approval.tool_name,
        input: sanitizeInputForLog(payloadToExecute),
        output: null,
        status: "ERROR",
        errorMessage: errMsg.slice(0, 2000),
        idempotencyKey: idempotencyKey ?? null,
        durationMs: Date.now() - started,
      });
    } catch {
      // ignore
    }

    throw new GatewayError("TOOL_EXECUTION_FAILED", `Error ejecutando tool aprobado ${approval.tool_name}: ${errMsg}`);
  }

  const durationMs = Date.now() - started;

  // 7. Marcar approval como EXECUTED
  await markApprovalExecuted({
    db,
    approvalId,
    empresaId: actor.empresaId,
  });

  // 8. Persistir step SUCCESS
  let stepId: string | null = null;
  try {
    const step = await createStep({
      db,
      taskId: approval.task_id,
      runId: approval.run_id ?? approval.task_id,
      empresaId: actor.empresaId,
      toolName: approval.tool_name,
      input: sanitizeInputForLog(payloadToExecute),
      output,
      status: "SUCCESS",
      idempotencyKey: idempotencyKey ?? null,
      durationMs,
    });
    stepId = step.id;
  } catch {
    // no bloquear retorno si falla la persistencia de step
  }

  // 9. Audit log
  try {
    await db.rpc("log_audit_event", {
      p_action: `agent.tool.executed_approved:${approval.tool_name}`,
      p_detail: {
        empresa_id: actor.empresaId,
        tool: approval.tool_name,
        approval_id: approvalId,
        task_id: approval.task_id,
      } as never,
      p_actor_type: "agent",
      p_actor_label: actor.email ?? actor.userId ?? "agent",
    } as never);
  } catch {
    // ignore
  }

  return {
    ok: true,
    approvalId,
    tool: approval.tool_name,
    output,
    stepId,
  };
}
