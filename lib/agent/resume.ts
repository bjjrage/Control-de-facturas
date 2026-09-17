// lib/agent/resume.ts
// BATCH 6 — resumeTask: el mismo agente despertándose. No crea un AsyncAgent.
// No importa orchestrator (lo ejecuta el worker) para evitar ciclos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isResumableTaskStatus } from "./task-states";
import type { TaskStatus } from "./runtime";
import { claimTaskLease, releaseTaskLease } from "./leases";
import { finishRun } from "./runtime";
import { resolveOpenRetries } from "./retries";

export interface ResumeTaskOptions {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  actorId: string;
  actorType: "user" | "agent" | "system" | "worker";
  triggerEventId?: string | null;
  triggerWaitId?: string | null;
  allowRunningRecovery?: boolean;
}

export interface ResumeTaskResult {
  taskId: string;
  runId: string;
  empresaId: string;
  holderId: string;
  status: "RUNNING";
}

export async function resumeTask(params: ResumeTaskOptions): Promise<ResumeTaskResult> {
  const holderId = `worker_${params.actorId}`;

  const { data: task, error: taskError } = await params.db
    .from("agent_tasks")
    .select("id, empresa_id, status")
    .eq("id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .single();
  if (taskError || !task) throw new Error(`resumeTask: task no encontrada`);
  const currentStatus = (task as { status: TaskStatus }).status;
  const recoveringRunning = currentStatus === "RUNNING" && params.allowRunningRecovery === true;
  if (!isResumableTaskStatus(currentStatus) && !recoveringRunning) {
    throw new Error(`resumeTask: estado no resumible: ${(task as { status: string }).status}`);
  }

  if (params.triggerWaitId || params.triggerEventId) {
    let waitQuery = params.db
      .from("agent_task_waits")
      .select("id, status, satisfied_by_event_id")
      .eq("task_id", params.taskId)
      .eq("empresa_id", params.empresaId)
      .eq("status", "SATISFIED");
    if (params.triggerWaitId) waitQuery = waitQuery.eq("id", params.triggerWaitId);
    if (params.triggerEventId) waitQuery = waitQuery.eq("satisfied_by_event_id", params.triggerEventId);
    const { data: triggerWait, error: triggerWaitError } = await waitQuery.maybeSingle();
    if (triggerWaitError || !triggerWait) {
      throw new Error(`resumeTask: trigger wait no satisfecho o no pertenece a la task`);
    }
  }

  const lease = await claimTaskLease({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    holderId,
    holderType: "worker",
    ttlSeconds: 300,
  });
  if (!lease.success) throw new Error(`resumeTask: ${lease.error ?? "lease ocupado"}`);

  try {
    if (recoveringRunning) {
      const { data: staleRuns } = await params.db
        .from("agent_runs")
        .select("id")
        .eq("task_id", params.taskId)
        .eq("empresa_id", params.empresaId)
        .eq("status", "RUNNING")
        .order("started_at", { ascending: false })
        .limit(1);
      const staleRunId = (staleRuns?.[0] as { id?: string } | undefined)?.id;
      if (staleRunId) {
        await finishRun({
          db: params.db,
          runId: staleRunId,
          status: "FAILED",
          errorMessage: "Recovered after worker lease expiry",
        });
      }
    }

    const { data: run, error: runError } = await params.db
      .from("agent_runs")
      .insert({ task_id: params.taskId, empresa_id: params.empresaId, status: "RUNNING", started_at: new Date().toISOString() })
      .select("id")
      .single();
    if (runError || !run) throw new Error(`resumeTask: createRun fallo`);

    const { error: taskUpdateError } = await params.db
      .from("agent_tasks")
      .update({ status: "RUNNING", updated_at: new Date().toISOString() })
      .eq("id", params.taskId)
      .eq("empresa_id", params.empresaId);
    if (taskUpdateError) throw new Error(`resumeTask: task update fallo`);

    await resolveOpenRetries({ db: params.db, taskId: params.taskId, empresaId: params.empresaId });

    return {
      taskId: params.taskId,
      runId: (run as { id: string }).id,
      empresaId: params.empresaId,
      holderId,
      status: "RUNNING",
    };
  } catch (err) {
    await releaseTaskLease({ db: params.db, taskId: params.taskId, empresaId: params.empresaId, holderId });
    throw err;
  }
}

export async function cancelTask(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  reason?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { data: task, error: taskError } = await params.db
    .from("agent_tasks")
    .select("status")
    .eq("id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .single();
  if (taskError || !task) return { success: false, error: "Task no encontrada" };
  const status = (task as { status: TaskStatus }).status;
  if (status === "COMPLETED" || status === "CANCELLED") {
    return { success: false, error: `Estado terminal: ${status}` };
  }

  await params.db
    .from("agent_task_waits")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "WAITING");
  await params.db
    .from("agent_task_retries")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .in("status", ["PENDING", "SCHEDULED", "EXECUTING"]);
  await params.db.from("agent_task_leases").delete().eq("task_id", params.taskId).eq("empresa_id", params.empresaId);

  const { error } = await params.db
    .from("agent_tasks")
    .update({
      status: "CANCELLED",
      error_message: (params.reason ?? "Cancelled by user").slice(0, 2000),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.taskId)
    .eq("empresa_id", params.empresaId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
