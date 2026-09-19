import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile, withWorkspace } from "@/lib/agent/context";
import { createRun, createTask, finishRun, updateTaskStatus } from "@/lib/agent/runtime";
import { deriveRodrigoState, getRodrigoStatePresentation } from "@/lib/agent/rodrigo-state";
import { formatToolAnswer, RODRIGO_HELP_MESSAGE, routeChatIntent } from "@/lib/agent/rodrigo-chat";
import { AgentOrchestrator, DeepSeekConfigError } from "@/lib/agent/orchestrator";
import { gatewayExecuteSafe } from "@/lib/agent/gateway";
import "@/lib/tools"; // auto-registro de todos los tools

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_MESSAGE_CHARS = 2000;

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
    idempotencyKey?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return noStoreJson({ error: "Mensaje vacío" }, 400);
  if (message.length > MAX_MESSAGE_CHARS) return noStoreJson({ error: "Mensaje demasiado largo" }, 400);
  const workspaceProjectId =
    typeof body.workspaceProjectId === "string" && body.workspaceProjectId.length > 0
      ? body.workspaceProjectId
      : null;
  const draftId = typeof body.draftId === "string" && body.draftId.length > 0 ? body.draftId : null;
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
    if (!deepseekConfigured && process.env.NODE_ENV !== "development") {
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
      const orchestrator = new AgentOrchestrator({ maxIterations: 8, timeoutMs: 90_000 });
      const agentContext = withWorkspace(actor, workspaceProjectId ? { projectId: workspaceProjectId } : null);
      const result = await orchestrator.run({
        db,
        actor: agentContext,
        taskId: task.id,
        runId: run.id,
        userIntent: message,
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

    // Camino 2: router determinista (certificación sin LLM). Mismo Gateway.
    if (process.env.RODRIGO_ALLOW_DETERMINISTIC_FALLBACK !== "true") {
      await failTask("Rodrigo no está configurado en este entorno.");
      return noStoreJson(
        {
          error: "Rodrigo no está configurado en este entorno.",
          diagnostics: { deepseekConfigured: false },
        },
        503
      );
    }

    // Router determinista unicamente para tests/desarrollo local explicito.
    const route = routeChatIntent(message, workspaceProjectId, draftId);
    if (route.kind === "help") {
      await finishRun({ db, runId: run.id, status: "COMPLETED" });
      await updateTaskStatus({ db, taskId: task.id, empresaId: profile.empresa_id, status: "COMPLETED", actorType: "system" });
      return noStoreJson({ answer: RODRIGO_HELP_MESSAGE, taskId: task.id, state: "idle", approval: null });
    }
    if (route.kind === "clarify") {
      await finishRun({ db, runId: run.id, status: "COMPLETED" });
      await updateTaskStatus({ db, taskId: task.id, empresaId: profile.empresa_id, status: "COMPLETED", actorType: "system" });
      return noStoreJson({ answer: route.message, taskId: task.id, state: "idle", approval: null });
    }

    const agentContext = withWorkspace(actor, workspaceProjectId ? { projectId: workspaceProjectId } : null);
    const gatewayResult = await gatewayExecuteSafe({
      db,
      actor: agentContext,
      toolName: route.tool,
      rawInput: route.input,
      taskId: task.id,
      runId: run.id,
    });
    if (!gatewayResult.ok) {
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
        approval: { id: gatewayResult.approvalId, tool: gatewayResult.tool },
        emailPreview: null,
      });
    }
    const answer = formatToolAnswer(route.tool, gatewayResult.output);
    await finishRun({ db, runId: run.id, status: "COMPLETED" });
    await updateTaskStatus({ db, taskId: task.id, empresaId: profile.empresa_id, status: "COMPLETED", actorType: "system" });
    const state = deriveRodrigoState([{ status: "COMPLETED", completedAt: new Date().toISOString() }]);
    const preparedEmail =
      route.tool === "prepare_email" && gatewayResult.output && typeof gatewayResult.output === "object"
        ? (gatewayResult.output as { draftId?: unknown })
        : null;
    return noStoreJson({
      answer,
      taskId: task.id,
      state,
      approval: null,
      emailPreview: preparedEmail && typeof preparedEmail.draftId === "string" ? gatewayResult.output : null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof DeepSeekConfigError) {
      await failTask("orchestrator no configurado");
      return noStoreJson({ error: "Agente no configurado en este entorno" }, 503);
    }
    await failTask(detail.slice(0, 500));
    return noStoreJson({ error: "No pude procesar el mensaje" }, 500);
  }
}
