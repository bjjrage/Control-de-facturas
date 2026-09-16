// lib/agent/waits.ts
// BATCH 6 — Esperas durables. El wait sobrevive a reinicios.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTaskWaitRow, TaskWaitKind } from "./life-types";
import { updateTaskStatus } from "./runtime";

export async function createTaskWait(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  runId?: string | null;
  kind: TaskWaitKind;
  eventType?: string | null;
  correlationKey?: string | null;
  wakeAt?: string | null;
  payloadJson?: Record<string, unknown>;
}): Promise<AgentTaskWaitRow> {
  if (!["EVENT", "TIMER", "APPROVAL"].includes(params.kind)) {
    throw new Error(`kind invalido: ${params.kind}`);
  }
  if (params.kind === "TIMER" && !params.wakeAt) {
    throw new Error("TIMER wait requiere wakeAt");
  }
  if (params.kind !== "TIMER" && (!params.eventType || !params.correlationKey)) {
    throw new Error(`${params.kind} wait requiere eventType y correlationKey`);
  }
  const { data, error } = await params.db
    .from("agent_task_waits")
    .insert({
      task_id: params.taskId,
      run_id: params.runId ?? null,
      empresa_id: params.empresaId,
      kind: params.kind,
      event_type: params.eventType ?? null,
      correlation_key: params.correlationKey ?? null,
      wake_at: params.wakeAt ?? null,
      payload_json: params.payloadJson ?? {},
      status: "WAITING",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createTaskWait: ${error?.message ?? "sin data"}`);
  return data as AgentTaskWaitRow;
}

export async function satisfyTaskWait(params: {
  db: SupabaseClient;
  waitId: string;
  empresaId: string;
  eventId: string;
}): Promise<AgentTaskWaitRow> {
  const { data, error } = await params.db
    .from("agent_task_waits")
    .update({
      status: "SATISFIED",
      satisfied_by_event_id: params.eventId,
      satisfied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.waitId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "WAITING")
    .select("*")
    .single();
  if (error || !data) throw new Error(`satisfyTaskWait: ${error?.message ?? "sin data"}`);
  return data as AgentTaskWaitRow;
}

export async function cancelTaskWait(params: {
  db: SupabaseClient;
  waitId: string;
  empresaId: string;
}): Promise<AgentTaskWaitRow> {
  const { data, error } = await params.db
    .from("agent_task_waits")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", params.waitId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "WAITING")
    .select("*")
    .single();
  if (error || !data) throw new Error(`cancelTaskWait: ${error?.message ?? "sin data"}`);
  return data as AgentTaskWaitRow;
}

export async function getTaskWaits(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  status?: AgentTaskWaitRow["status"];
}): Promise<AgentTaskWaitRow[]> {
  let q = params.db
    .from("agent_task_waits")
    .select("*")
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .order("created_at", { ascending: true });
  if (params.status) q = q.eq("status", params.status);
  const { data, error } = await q;
  if (error) throw new Error(`getTaskWaits: ${error.message}`);
  return (data ?? []) as AgentTaskWaitRow[];
}

export async function parkTaskForApproval(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  runId?: string | null;
  approvalId: string;
}): Promise<AgentTaskWaitRow> {
  await updateTaskStatus({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    status: "WAITING_APPROVAL",
    actorType: "system",
  });
  return createTaskWait({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    runId: params.runId ?? null,
    kind: "APPROVAL",
    eventType: "APPROVAL_DECIDED",
    correlationKey: `APPROVAL:${params.approvalId}`,
    payloadJson: { approval_id: params.approvalId },
  });
}

export async function parkTaskForEvent(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  runId?: string | null;
  eventType: string;
  correlationKey: string;
  payloadJson?: Record<string, unknown>;
}): Promise<AgentTaskWaitRow> {
  await updateTaskStatus({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    status: "WAITING_EXTERNAL",
    actorType: "system",
  });
  return createTaskWait({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    runId: params.runId ?? null,
    kind: "EVENT",
    eventType: params.eventType,
    correlationKey: params.correlationKey,
    payloadJson: params.payloadJson ?? {},
  });
}

export async function parkTaskForTimer(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  runId?: string | null;
  wakeAt: string;
  payloadJson?: Record<string, unknown>;
}): Promise<AgentTaskWaitRow> {
  await updateTaskStatus({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    status: "SCHEDULED",
    actorType: "system",
  });
  return createTaskWait({
    db: params.db,
    taskId: params.taskId,
    empresaId: params.empresaId,
    runId: params.runId ?? null,
    kind: "TIMER",
    eventType: "TASK_TIMER_DUE",
    correlationKey: `TASK:${params.taskId}`,
    wakeAt: params.wakeAt,
    payloadJson: params.payloadJson ?? {},
  });
}

export async function cancelWaitingWaitsForTask(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
}): Promise<number> {
  const { data, error } = await params.db
    .from("agent_task_waits")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .eq("status", "WAITING")
    .select("id");
  if (error) throw new Error(`cancelWaitingWaitsForTask: ${error.message}`);
  return (data ?? []).length;
}
