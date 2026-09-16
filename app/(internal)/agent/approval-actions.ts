// app/(internal)/agent/approval-actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile } from "@/lib/agent/context";
import { decideApproval, getApproval } from "@/lib/agent/approvals";
import { executeApprovedTool } from "@/lib/agent/gateway";
import { emitAgentEvent, processAgentEvent } from "@/lib/agent/events";
import "@/lib/tools"; // auto-registro de todos los tools

export async function decideApprovalAction(params: {
  approvalId: string;
  decision: "APPROVED" | "REJECTED" | "CANCELLED";
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();

  const approval = await decideApproval({
    db: supabase,
    approvalId: params.approvalId,
    empresaId: profile.empresa_id,
    decidedBy: profile.id,
    decision: params.decision,
  });

  // Emitir evento APPROVAL_DECIDED para que el agente pueda reanudar
  await emitAgentEvent({
    db: supabase,
    empresaId: profile.empresa_id,
    eventType: "APPROVAL_DECIDED",
    sourceType: "user",
    sourceId: profile.id,
    correlationKey: `APPROVAL:${params.approvalId}`,
    dedupKey: `APPROVAL_DECIDED:${params.approvalId}:${params.decision}`,
    payloadJson: {
      approval_id: params.approvalId,
      decision: params.decision,
      decided_by: profile.id,
      decided_at: new Date().toISOString(),
    },
  });

  return { error: null, approval };
}

export async function executeApprovalAction(params: {
  approvalId: string;
  payloadToExecute: unknown;
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();

  const actor = actorFromProfile(profile);

  try {
    const result = await executeApprovedTool({
      db: supabase,
      actor,
      approvalId: params.approvalId,
      payloadToExecute: params.payloadToExecute,
    });

    // Si la ejecución fue exitosa, el agente reanudará automáticamente
    // El orchestrator continuará el flujo

    return { error: null, result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { error: errMsg, result: null };
  }
}

/**
 * Procesa un evento de aprobación decidido y reanuda la tarea asociada.
 * Esta función puede ser llamada por un worker o webhook.
 */
export async function processApprovalDecidedEvent(params: {
  approvalId: string;
  decision: "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy: string;
  empresaId: string;
}) {
  const supabase = await createClient();

  // Obtener la aprobación para obtener task_id
  const { data: approval } = await supabase
    .from("agent_approvals")
    .select("task_id, run_id, tool_name, payload_json")
    .eq("id", params.approvalId)
    .eq("empresa_id", params.empresaId)
    .single();

  if (!approval) {
    return { success: false, error: "Approval no encontrado" };
  }

  // Emitir evento APPROVAL_DECIDED
  await emitAgentEvent({
    db: supabase,
    empresaId: params.empresaId,
    eventType: "APPROVAL_DECIDED",
    sourceType: "user",
    sourceId: params.decidedBy,
    correlationKey: `APPROVAL:${params.approvalId}`,
    dedupKey: `APPROVAL_DECIDED:${params.approvalId}:${params.decision}`,
    payloadJson: {
      approval_id: params.approvalId,
      decision: params.decision,
      decided_by: params.decidedBy,
      tool_name: approval.tool_name,
      decided_at: new Date().toISOString(),
    },
  });

  // Si fue aprobado, ejecutar el tool aprobado
  if (params.decision === "APPROVED") {
    const actor = {
      empresaId: params.empresaId,
      userId: params.decidedBy,
      role: "comercial" as const,
      actorType: "user" as const,
      source: "web" as const,
    };

    try {
      const result = await executeApprovedTool({
        db: supabase,
        actor,
        approvalId: params.approvalId,
        payloadToExecute: approval.payload_json,
      });

      return { success: true, result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Si fue rechazado/cancelado, despertar waits correlacionados por APPROVAL:<id>.
  // Se reutiliza el evento ya emitido arriba (dedup evita duplicados).
  const { data: decidedEvent } = await supabase
    .from("agent_events")
    .select("id")
    .eq("empresa_id", params.empresaId)
    .eq("dedup_key", `APPROVAL_DECIDED:${params.approvalId}:${params.decision}`)
    .maybeSingle();
  if (decidedEvent) {
    const admin = createAdminClient();
    await processAgentEvent({
      db: admin,
      eventId: (decidedEvent as { id: string }).id,
      empresaId: params.empresaId,
      processorId: params.decidedBy,
    });
  }

  return { success: true };
}
