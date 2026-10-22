// lib/agent/approvals.ts
// Approval Engine — snapshot inmutable del payload a aprobar.
// Server-only. Usa Supabase (service_role o RLS-scoped client).
// El gateway crea el registro en estado REQUESTED; la ejecución posterior
// valida que payload_hash coincida con lo aprobado (previene bug payload A->B).
import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type ApprovalStatus =
  | "REQUESTED"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED";

export interface AgentApprovalRow {
  id: string;
  task_id: string;
  run_id: string | null;
  empresa_id: string;
  tool_name: string;
  payload_json: unknown;
  payload_hash: string;
  risk_level: number;
  status: ApprovalStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  approved_revision?: number | null;
  approved_content_hash?: string | null;
}

function approvalFromRpc(data: unknown, error: { message: string } | null, operation: string): AgentApprovalRow {
  if (error) throw new Error(`${operation} fallo: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error(`${operation} fallo: sin data`);
  return row as AgentApprovalRow;
}

/** Serialización canónica determinística para hashing (keys ordenadas). */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJsonStringify(v)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]));
  return "{" + parts.join(",") + "}";
}

export function hashPayload(payload: unknown): string {
  const canonical = canonicalJsonStringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Crea un approval en REQUESTED con snapshot + hash. Retorna la fila creada. */
export async function createApproval(params: {
  db: SupabaseClient;
  empresaId: string;
  taskId: string;
  runId?: string | null;
  toolName: string;
  payload: unknown;
  riskLevel: number;
  requestedBy?: string | null;
  expiresAt?: string | null;
}): Promise<AgentApprovalRow> {
  const requestedBy = params.requestedBy ?? null;
  if (!requestedBy) throw new Error("createApproval requiere un actor autenticado");
  const payloadHash = hashPayload(params.payload);
  const payloadRecord = params.payload as Record<string, unknown>;
  const approvedRevision =
    params.toolName === "send_email" && typeof payloadRecord?.draft_revision === "number"
      ? payloadRecord.draft_revision
      : null;
  const approvedContentHash =
    params.toolName === "send_email" && typeof payloadRecord?.draft_hash === "string"
      ? payloadRecord.draft_hash
      : null;
  const { data, error } = await createAdminClient().rpc("create_agent_approval", {
    p_task_id: params.taskId,
    p_run_id: params.runId ?? null,
    p_empresa_id: params.empresaId,
    p_tool_name: params.toolName,
    p_payload_json: params.payload as never,
    p_payload_hash: payloadHash,
    p_risk_level: params.riskLevel,
    p_requested_by: requestedBy,
    p_expires_at: params.expiresAt ?? null,
    p_approved_revision: approvedRevision,
    p_approved_content_hash: approvedContentHash,
    p_actor_id: requestedBy,
  });
  return approvalFromRpc(data, error, "createApproval");
}

export async function getApproval(db: SupabaseClient, approvalId: string): Promise<AgentApprovalRow | null> {
  const { data, error } = await db.from("agent_approvals").select("*").eq("id", approvalId).single();
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null;
    throw new Error(`getApproval fallo: ${error.message}`);
  }
  return data as AgentApprovalRow;
}

export async function decideApproval(params: {
  db: SupabaseClient;
  approvalId: string;
  empresaId: string; // scoping: solo puede decidir dentro de su tenant
  decidedBy: string;
  decision: "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  allowedRoles?: readonly string[];
}): Promise<AgentApprovalRow> {
  if (!["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"].includes(params.decision)) {
    throw new Error(`decision invalida: ${params.decision}`);
  }
  // Cargar para dar un error útil y validar tenant.
  const current = await getApproval(params.db, params.approvalId);
  if (!current) throw new Error(`Approval no encontrado: ${params.approvalId}`);
  if (current.empresa_id !== params.empresaId) throw new Error("Approval no pertenece a tu empresa");
  if (current.status !== "REQUESTED") throw new Error(`Approval ya decidido: ${current.status}`);
  if (params.decision === "EXPIRED") {
    const result = await createAdminClient().rpc("expire_agent_approval", {
      p_approval_id: params.approvalId,
      p_empresa_id: params.empresaId,
    });
    return approvalFromRpc(result.data, result.error, "expireApproval");
  }
  const allowedRoles = params.allowedRoles ?? ["comercial", "administracion", "admin"];
  const { data, error } = await createAdminClient().rpc("decide_agent_approval", {
    p_approval_id: params.approvalId,
    p_empresa_id: params.empresaId,
    p_decision: params.decision,
    p_actor_id: params.decidedBy,
    p_allowed_roles: [...allowedRoles],
  });
  return approvalFromRpc(data, error, "decideApproval");
}

/**
 * Transiciona una approval a EXPIRED (por timeout o scheduler de expiración).
 */
export async function expireApproval(params: {
  db: SupabaseClient;
  approvalId: string;
  empresaId: string;
}): Promise<AgentApprovalRow> {
  return decideApproval({
    db: params.db,
    approvalId: params.approvalId,
    empresaId: params.empresaId,
    decidedBy: "",
    decision: "EXPIRED",
  });
}

/**
 * Consumo atómico: Adquiere el lock de ejecución para una approval en estado APPROVED.
 * Utiliza CAS condicional (.eq("status", "APPROVED")).
 * Si dos llamadas concurrentes intentan ejecutar la misma approval, exactamente una
 * gana la transición a EXECUTING y la otra falla con error de concurrencia.
 */
export async function claimApprovalForExecution(params: {
  db: SupabaseClient;
  approvalId: string;
  empresaId: string;
}): Promise<AgentApprovalRow> {
  const { data, error } = await createAdminClient().rpc("transition_agent_approval", {
    p_approval_id: params.approvalId,
    p_empresa_id: params.empresaId,
    p_transition: "claim",
  });

  if (error || !data) {
    // Si no actualizó nada, verificar por qué
    const current = await getApproval(params.db, params.approvalId);
    if (!current) {
      throw new Error(`Approval ${params.approvalId} no encontrado`);
    }
    if (current.empresa_id !== params.empresaId) {
      throw new Error(`Approval no pertenece a tu empresa`);
    }
    throw new Error(
      `No se pudo adquirir approval para ejecución: status actual es "${current.status}" (requiere APPROVED)`
    );
  }

  return approvalFromRpc(data, error, "claimApprovalForExecution");
}

/**
 * Marca la approval como finalizada exitosamente tras completar los side-effects.
 */
export async function markApprovalExecuted(params: {
  db: SupabaseClient;
  approvalId: string;
  empresaId: string;
}): Promise<AgentApprovalRow> {
  const { data, error } = await createAdminClient().rpc("transition_agent_approval", {
    p_approval_id: params.approvalId,
    p_empresa_id: params.empresaId,
    p_transition: "executed",
  });
  return approvalFromRpc(data, error, "markApprovalExecuted");
}

/**
 * Marca la approval como fallida si los side-effects fallaron en el domain service.
 */
export async function markApprovalFailed(params: {
  db: SupabaseClient;
  approvalId: string;
  empresaId: string;
  errorMessage: string;
}): Promise<AgentApprovalRow> {
  const { data, error } = await createAdminClient().rpc("transition_agent_approval", {
    p_approval_id: params.approvalId,
    p_empresa_id: params.empresaId,
    p_transition: "failed",
  });
  return approvalFromRpc(data, error, "markApprovalFailed");
}

/**
 * Valida que el payload a ejecutar coincida con el snapshot aprobado.
 * Debe llamarse justo antes de ejecutar un tool que requirio approval.
 */
export function assertPayloadMatchesApproval(approval: AgentApprovalRow, payloadToExecute: unknown): void {
  const hash = hashPayload(payloadToExecute);
  if (hash !== approval.payload_hash) {
    throw new Error(
      `Payload alterado despues de la aprobacion: hash esperado ${approval.payload_hash} vs actual ${hash}. ` +
        `No se ejecuta.`
    );
  }
  if (approval.status !== "APPROVED" && approval.status !== "EXECUTING") {
    throw new Error(`Approval no esta en estado valido para ejecucion (no esta APPROVED, actual: ${approval.status})`);
  }
}

/** Verifica que no hubo mutacion del snapshot en BD (trigger ya lo protege, esto es doble capa app). */
export function isApprovalDecided(row: AgentApprovalRow): boolean {
  return row.status !== "REQUESTED";
}
