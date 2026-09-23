// app/(internal)/agent/approval-actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile } from "@/lib/agent/context";
import { decideApproval, getApproval } from "@/lib/agent/approvals";
import { executeApprovedTool } from "@/lib/agent/gateway";
import { emitAgentEvent, processAgentEvent } from "@/lib/agent/events";
import { createRun, createTask, finishRun, updateTaskStatus } from "@/lib/agent/runtime";
import { sanitizeAgentError } from "@/lib/agent/sanitize";
import { getEmailDraftSendContext, getEmailDraftPreview, getRecipientLabel, markEmailDraftWaitingApproval, recordEmailEvent } from "@/lib/email/domain-service";
import { recoverStaleEmailSendAttempts } from "@/lib/email/recovery";
import type { EmailPreview } from "@/lib/email/types";
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

  if (approval.tool_name === "send_email") {
    const snapshot = approval.payload_json && typeof approval.payload_json === "object"
      ? (approval.payload_json as { draft_snapshot?: EmailPreview }).draft_snapshot
      : undefined;
    await recordEmailEvent(supabase, actorFromProfile(profile), {
      eventType: params.decision === "APPROVED" ? "email.send.approved" : "email.send.failed",
      draftId: snapshot?.draftId ?? null,
      idempotencyKey: approval.payload_json && typeof approval.payload_json === "object"
        ? (approval.payload_json as { idempotency_key?: string }).idempotency_key
        : null,
      subject: snapshot?.subject ?? null,
      recipientEmails: snapshot?.to ?? [],
      metadata: { approvalId: approval.id, decision: params.decision },
    });
  }

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

/**
 * Explicit email button flow. The server reconstructs the approved payload
 * from the tenant-scoped draft, creates the normal Gateway approval record,
 * then consumes it exactly once. The browser never supplies recipients/body.
 */
export async function sendPreparedEmailAction(params: {
  draftId: string;
  previewHash: string;
  forceResend?: boolean;
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();
  const actor = actorFromProfile(profile);
  await recoverStaleEmailSendAttempts();
  let context = await getEmailDraftSendContext(supabase, actor, params.draftId, params.previewHash);
  if (context.row.status === "DELIVERY_UNKNOWN") {
    if (!params.forceResend) {
      return {
        error: "El resultado del envío anterior es incierto. Usá «Enviar nuevamente» para crear una nueva aprobación explícita.",
        result: null,
      };
    }
    const { error: resendError } = await supabase
      .from("email_drafts")
      .update({ status: "READY", delivery_retry_authorized: true, failure_reason: null })
      .eq("id", context.row.id)
      .eq("empresa_id", profile.empresa_id)
      .eq("created_by", profile.id)
      .eq("status", "DELIVERY_UNKNOWN");
    if (resendError) return { error: resendError.message, result: null };
    context = await getEmailDraftSendContext(supabase, actor, params.draftId, params.previewHash);
  }
  if (context.row.status === "SENT" && context.row.provider_message_id) {
    return {
      error: null,
      result: {
        draftId: context.row.id,
        provider: "GMAIL" as const,
        providerMessageId: context.row.provider_message_id,
        sentAt: context.row.sent_at ?? new Date().toISOString(),
        alreadySent: true,
        recipientLabel: await getRecipientLabel(supabase, profile.empresa_id, context.snapshot.to),
      },
    };
  }
  const task = await createTask({
    db: supabase,
    empresaId: profile.empresa_id,
    userId: profile.id,
    projectId: context.row.project_id,
    type: "EMAIL_SEND",
    status: "PENDING",
    contextJson: { draftId: context.row.id, objective: `Enviar correo: ${context.row.subject}` },
    idempotencyKey: `email-send:${context.row.id}`,
  });
  await updateTaskStatus({ db: supabase, taskId: task.id, empresaId: profile.empresa_id, status: "RUNNING", actorType: "user" });
  const run = await createRun({ db: supabase, taskId: task.id, empresaId: profile.empresa_id, model: "email-gateway" });
  try {
    const pending = await (await import("@/lib/agent/gateway")).gatewayExecuteSafe({
      db: supabase,
      actor,
      toolName: "send_email",
      rawInput: context.input,
      taskId: task.id,
      runId: run.id,
    });
    if (!pending.ok) {
      await markEmailDraftWaitingApproval(
        supabase,
        actor,
        context.snapshot,
        pending.approvalId,
        context.row.idempotency_key
      );
      await recordEmailEvent(supabase, actor, {
        eventType: "email.send.approval_requested",
        draftId: context.row.id,
        connectionId: context.row.provider_connection_id,
        idempotencyKey: context.row.idempotency_key,
        subject: context.row.subject,
        recipientEmails: context.snapshot.to,
        metadata: { approvalId: pending.approvalId },
      });
      const decided = await decideApproval({
        db: supabase,
        approvalId: pending.approvalId,
        empresaId: profile.empresa_id,
        decidedBy: profile.id,
        decision: "APPROVED",
      });
      await recordEmailEvent(supabase, actor, {
        eventType: "email.send.approved",
        draftId: context.row.id,
        connectionId: context.row.provider_connection_id,
        idempotencyKey: context.row.idempotency_key,
        subject: context.row.subject,
        recipientEmails: context.snapshot.to,
        metadata: { approvalId: decided.id, source: "email_preview_button" },
      });
      const result = await executeApprovedTool({
        db: supabase,
        actor,
        approvalId: pending.approvalId,
        payloadToExecute: decided.payload_json,
        idempotencyKey: context.row.idempotency_key,
      });
      await finishRun({ db: supabase, runId: run.id, status: "COMPLETED" });
      await updateTaskStatus({ db: supabase, taskId: task.id, empresaId: profile.empresa_id, status: "COMPLETED", actorType: "user" });
      return { error: null, result: result.output };
    }
    await finishRun({ db: supabase, runId: run.id, status: "COMPLETED" });
    await updateTaskStatus({ db: supabase, taskId: task.id, empresaId: profile.empresa_id, status: "COMPLETED", actorType: "user" });
    return { error: null, result: pending.output };
  } catch (error) {
    const message = sanitizeAgentError(error);
    await finishRun({ db: supabase, runId: run.id, status: "FAILED", errorMessage: message }).catch(() => null);
    await updateTaskStatus({ db: supabase, taskId: task.id, empresaId: profile.empresa_id, status: "FAILED", errorMessage: message, actorType: "system" }).catch(() => null);
    return { error: message, result: null };
  }
}

/** Approves an already-requested send_email approval after rechecking its hash. */
export async function approveAndExecuteEmailApprovalAction(params: {
  approvalId: string;
  previewHash: string;
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();
  const actor = actorFromProfile(profile);
  const approval = await getApproval(supabase, params.approvalId);
  if (!approval || approval.empresa_id !== profile.empresa_id || approval.tool_name !== "send_email") {
    return { error: "Aprobación de correo no encontrada", result: null };
  }
  const payload = approval.payload_json as { draft_id?: string; draft_hash?: string; idempotency_key?: string };
  if (payload.draft_hash !== params.previewHash || !payload.draft_id) {
    return { error: "El preview aprobado ya no coincide con el borrador", result: null };
  }
  try {
    if (approval.status === "REQUESTED") {
      await decideApprovalAction({ approvalId: params.approvalId, decision: "APPROVED" });
    }
    const latest = await getApproval(supabase, params.approvalId);
    if (!latest) return { error: "Aprobación no encontrada", result: null };
    const result = await executeApprovedTool({
      db: supabase,
      actor,
      approvalId: params.approvalId,
      payloadToExecute: latest.payload_json,
      idempotencyKey: payload.idempotency_key ?? null,
    });
    return { error: null, result: result.output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), result: null };
  }
}

export async function cancelEmailDraftAction(params: { draftId: string }) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();
  const actor = actorFromProfile(profile);
  const preview = await getEmailDraftPreview(supabase, actor, params.draftId);
  const { error } = await supabase
    .from("email_drafts")
    .update({ status: "CANCELLED" })
    .eq("id", params.draftId)
    .eq("empresa_id", profile.empresa_id)
    .eq("created_by", profile.id)
    .in("status", ["READY", "WAITING_APPROVAL"]);
  if (error) return { error: error.message };
  await supabase.rpc("cancel_email_approval_for_draft", { p_draft_id: params.draftId, p_empresa_id: profile.empresa_id });
  await recordEmailEvent(supabase, actor, {
    eventType: "email.draft.updated",
    draftId: params.draftId,
    subject: preview.subject,
    recipientEmails: preview.to,
    metadata: { status: "CANCELLED" },
  });
  return { error: null };
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
