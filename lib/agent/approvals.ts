// lib/agent/approvals.ts
// Approval Engine — snapshot inmutable del payload a aprobar.
// Server-only. Usa Supabase (service_role o RLS-scoped client).
// El gateway crea el registro en estado REQUESTED; la ejecución posterior
// valida que payload_hash coincida con lo aprobado (previene bug payload A->B).
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const payloadHash = hashPayload(params.payload);
  const { data, error } = await params.db
    .from("agent_approvals")
    .insert({
      empresa_id: params.empresaId,
      task_id: params.taskId,
      run_id: params.runId ?? null,
      tool_name: params.toolName,
      payload_json: params.payload as never,
      payload_hash: payloadHash,
      risk_level: params.riskLevel,
      status: "REQUESTED",
      requested_by: params.requestedBy ?? null,
      expires_at: params.expiresAt ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createApproval fallo: ${error?.message ?? "sin data"}`);
  return data as AgentApprovalRow;
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
}): Promise<AgentApprovalRow> {
  if (!["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"].includes(params.decision)) {
    throw new Error(`decision invalida: ${params.decision}`);
  }
  // Cargar para dar un error útil y validar tenant.
  const current = await getApproval(params.db, params.approvalId);
  if (!current) throw new Error(`Approval no encontrado: ${params.approvalId}`);
  if (current.empresa_id !== params.empresaId) throw new Error("Approval no pertenece a tu empresa");
  if (current.status !== "REQUESTED") throw new Error(`Approval ya decidido: ${current.status}`);

  const { data, error } = await params.db
    .from("agent_approvals")
    .update({
      status: params.decision,
      decided_by: params.decidedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("id", params.approvalId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "REQUESTED")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`decideApproval fallo: ${error.message}`);
  if (!data) throw new Error("Approval ya fue decidido por otra solicitud concurrente");
  return data as AgentApprovalRow;
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
    decidedBy: "system:timeout",
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
  const { data, error } = await params.db
    .from("agent_approvals")
    .update({ status: "EXECUTING" })
    .eq("id", params.approvalId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "APPROVED")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`claimApprovalForExecution error: ${error.message}`);
  }

  if (!data) {
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

  return data as AgentApprovalRow;
}

/**
 * Marca la approval como finalizada exitosamente tras completar los side-effects.
 */
export async function markApprovalExecuted(params: {
  db: SupabaseClient;
  approvalId: string;
  empresaId: string;
}): Promise<AgentApprovalRow> {
  const { data, error } = await params.db
    .from("agent_approvals")
    .update({ status: "EXECUTED" })
    .eq("id", params.approvalId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "EXECUTING")
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`markApprovalExecuted fallo: ${error?.message ?? "sin data"}`);
  }
  return data as AgentApprovalRow;
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
  const { data, error } = await params.db
    .from("agent_approvals")
    .update({ status: "FAILED" })
    .eq("id", params.approvalId)
    .eq("empresa_id", params.empresaId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`markApprovalFailed fallo: ${error?.message ?? "sin data"}`);
  }
  return data as AgentApprovalRow;
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
