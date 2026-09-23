import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile, withWorkspace } from "@/lib/agent/context";
import { createRun, createTask, finishRun, updateTaskStatus } from "@/lib/agent/runtime";
import { sanitizeAgentError } from "@/lib/agent/sanitize";
import { deriveRodrigoState, getRodrigoStatePresentation } from "@/lib/agent/rodrigo-state";
import { AgentOrchestrator, DeepSeekConfigError } from "@/lib/agent/orchestrator";
import "@/lib/tools"; // auto-registro de todos los tools

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 20;

type ConversationHistoryTurn = { role: "user" | "assistant"; content: string };

function parseConversationHistory(value: unknown): ConversationHistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((turn): ConversationHistoryTurn[] => {
      if (!turn || typeof turn !== "object") return [];
      const candidate = turn as { role?: unknown; content?: unknown };
      if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
      const content = candidate.content.trim().slice(0, MAX_MESSAGE_CHARS);
      return content ? [{ role: candidate.role, content }] : [];
    });
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * Texto -> Rodrigo -> Agent Orchestrator REAL -> Tool Registry -> Gateway.
 *
 * Cada mensaje crea una task durable (PENDING -> RUNNING -> COMPLETED/FAILED
 * o WAITING_APPROVAL), así /api/agent/status y el widget reflejan el estado
 * real. Nunca hay LLM directo a DB: todo pasa por el Gateway. Sin TTS.
 */
export async function POST(request: Request) {
  let profile;
  try {
    profile = await requireProfile();
    if (!profile?.empresa_id) return noStoreJson({ error: "Unauthorized" }, 401);
  } catch {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as {
    message?: unknown;
    workspaceProjectId?: unknown;
    draftId?: unknown;
    conversationHistory?: unknown;
    idempotencyKey?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return noStoreJson({ error: "Mensaje vacío" }, 400);
  if (message.length > MAX_MESSAGE_CHARS) return noStoreJson({ error: "Mensaje demasiado largo" }, 400);
  const workspaceProjectId =
    typeof body.workspaceProjectId === "string" && body.workspaceProjectId.length > 0
      ? body.workspaceProjectId
      : null;
  const conversationHistory = parseConversationHistory(body.conversationHistory);
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0 ? body.idempotencyKey : randomUUID();

  const db = await createClient();
  const actor = actorFromProfile(profile, { source: "web" });

  const task = await createTask({
    db,
    empresaId: profile.empresa_id,
    userId: profile.id,
    projectId: workspaceProjectId,
    type: "RODRIGO_CHAT",
    status: "PENDING",
    contextJson: { channel: "rodrigo-text", message: message.slice(0, 500) },
    idempotencyKey,
  });
  await updateTaskStatus({ db, taskId: task.id, empresaId: profile.empresa_id, status: "RUNNING", actorType: "user" });
  const run = await createRun({ db, taskId: task.id, empresaId: profile.empresa_id, model: "rodrigo-chat" });

  const failTask = async (errorMessage: string) => {
    await finishRun({ db, runId: run.id, status: "FAILED", errorMessage }).catch(() => null);
    await updateTaskStatus({
      db,
      taskId: task.id,
      empresaId: profile.empresa_id,
      status: "FAILED",
      errorMessage,
      actorType: "system",
    }).catch(() => null);
  };

  try {
    const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());

    // Preview y Production deben fallar cerrado: una credencial ausente nunca
    // puede convertir a Rodrigo silenciosamente en un router de keywords.
    if (!deepseekConfigured) {
      await failTask("Rodrigo no está configurado en este entorno.");
      return noStoreJson(
        {
          error: "Rodrigo no está configurado en este entorno.",
          diagnostics: { deepseekConfigured: false },
        },
        503
      );
    }

    // Camino 1: LLM real cuando hay credencial server-side.
    if (deepseekConfigured) {
      console.info("[rodrigo] chat path", { mode: "deepseek" });
      const orchestrator = new AgentOrchestrator({ maxIterations: 8, timeoutMs: 90_000 });
      const agentContext = withWorkspace(actor, workspaceProjectId ? { projectId: workspaceProjectId } : null);
      const result = await orchestrator.run({
        db,
        actor: agentContext,
        taskId: task.id,
        runId: run.id,
        userIntent: message,
        conversationHistory,
      });
      if (result.stoppedReason === "approval_required" && result.approvalId) {
        await finishRun({ db, runId: run.id, status: "COMPLETED" });
        await updateTaskStatus({
          db,
          taskId: task.id,
          empresaId: profile.empresa_id,
          status: "WAITING_APPROVAL",
          actorType: "system",
        });
        const presentation = getRodrigoStatePresentation("approval");
        return noStoreJson({
          answer: "Esta acción necesita tu aprobación en el panel antes de ejecutarse.",
          taskId: task.id,
          state: "approval",
          label: presentation.label,
          approval: { id: result.approvalId },
          emailPreview: result.emailPreview ?? null,
        });
      }
      await finishRun({ db, runId: run.id, status: "COMPLETED", usageJson: (result.usage ?? null) as never });
      await updateTaskStatus({ db, taskId: task.id, empresaId: profile.empresa_id, status: "COMPLETED", actorType: "system" });
      const state = deriveRodrigoState([{ status: "COMPLETED", completedAt: new Date().toISOString() }]);
      return noStoreJson({ answer: result.answer, taskId: task.id, state, approval: null, emailPreview: result.emailPreview ?? null });
    }

    await failTask("Rodrigo no está configurado en este entorno.");
    return noStoreJson(
      { error: "Rodrigo no está configurado en este entorno.", diagnostics: { deepseekConfigured: false } },
      503
    );

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const safeDetail = sanitizeAgentError(detail);
    console.error("[rodrigo] chat failed", {
      name: error instanceof Error ? error.name : "unknown",
      message: safeDetail,
    });
    if (error instanceof DeepSeekConfigError) {
      await failTask("orchestrator no configurado");
      return noStoreJson({ error: "Agente no configurado en este entorno" }, 503);
    }
    await failTask(safeDetail);
    return noStoreJson({ error: "No pude procesar el mensaje" }, 500);
  }
}
