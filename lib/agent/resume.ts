// lib/agent/resume.ts
// BATCH 6 — resumeTask: el mismo agente despertándose. No crea un AsyncAgent.
// No importa orchestrator (lo ejecuta el worker) para evitar ciclos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isResumableTaskStatus } from "./task-states";
import type { TaskStatus } from "./runtime";
import { claimTaskLease } from "./leases";
import { resolveOpenRetries } from "./retries";

export interface ResumeTaskOptions {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  actorId: string;
  actorType: "user" | "agent" | "system" | "worker";
  triggerEventId?: string | null;
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
  if (!isResumableTaskStatus((task as { status: TaskStatus }).status)) {
    throw new Error(`resumeTask: estado no resumible: ${(task as { status: string }).status}`);
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

    if (params.triggerEventId) {
      await params.db
        .from("agent_task_waits")
        .update({
          status: "SATISFIED",
          satisfied_by_event_id: params.triggerEventId,
          satisfied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("task_id", params.taskId)
        .eq("empresa_id", params.empresaId)
        .eq("status", "WAITING");
    }

    await resolveOpenRetries({ db: params.db, taskId: params.taskId, empresaId: params.empresaId });

    return {
      taskId: params.taskId,
      runId: (run as { id: string }).id,
      empresaId: params.empresaId,
      holderId,
      status: "RUNNING",
    };
  } catch (err) {
    await params.db.from("agent_task_leases").delete().eq("task_id", params.taskId).eq("empresa_id", params.empresaId).eq("holder_id", holderId);
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
    .in("status", ["PENDING", "SCHEDULED"]);
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
