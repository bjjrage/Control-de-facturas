// lib/agent/retries.ts
// BATCH 6 — Reintentos con backoff. Sin loops infinitos.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTaskRetryRow } from "./life-types";

export function computeBackoffMs(params: {
  attemptNumber: number;
  baseMs?: number;
  maxMs?: number;
  multiplier?: number;
}): number {
  const base = params.baseMs ?? 5000;
  const max = params.maxMs ?? 300000;
  const mult = params.multiplier ?? 2;
  const exp = base * Math.pow(mult, Math.max(0, params.attemptNumber - 1));
  return Math.min(max, Math.round(exp));
}

export async function scheduleRetry(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  runId?: string | null;
  errorCode: string;
  errorMessage: string;
  maxAttempts?: number;
}): Promise<AgentTaskRetryRow> {
  const { data: existing } = await params.db
    .from("agent_task_retries")
    .select("*")
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .in("status", ["PENDING", "SCHEDULED", "EXECUTING"])
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const attemptNumber = existing ? (existing as AgentTaskRetryRow).attempt_number + 1 : 1;
  const maxAttempts = params.maxAttempts ?? (existing as AgentTaskRetryRow | null)?.max_attempts ?? 3;

  if (attemptNumber > maxAttempts) {
    const { data, error } = await params.db
      .from("agent_task_retries")
      .insert({
        task_id: params.taskId,
        run_id: params.runId ?? null,
        empresa_id: params.empresaId,
        attempt_number: attemptNumber,
        max_attempts: maxAttempts,
        last_error_code: params.errorCode,
        last_error_message: params.errorMessage.slice(0, 2000),
        last_error_at: new Date().toISOString(),
        next_retry_at: null,
        status: "EXHAUSTED",
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`scheduleRetry: ${error?.message ?? "sin data"}`);
    await params.db
      .from("agent_tasks")
      .update({ status: "FAILED", error_message: params.errorMessage.slice(0, 2000), updated_at: new Date().toISOString() })
      .eq("id", params.taskId)
      .eq("empresa_id", params.empresaId);
    return data as AgentTaskRetryRow;
  }

  const nextRetryAt = new Date(Date.now() + computeBackoffMs({ attemptNumber })).toISOString();
  const { data, error } = await params.db
    .from("agent_task_retries")
    .insert({
      task_id: params.taskId,
      run_id: params.runId ?? null,
      empresa_id: params.empresaId,
      attempt_number: attemptNumber,
      max_attempts: maxAttempts,
      last_error_code: params.errorCode,
      last_error_message: params.errorMessage.slice(0, 2000),
      last_error_at: new Date().toISOString(),
      next_retry_at: nextRetryAt,
      status: "SCHEDULED",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`scheduleRetry: ${error?.message ?? "sin data"}`);
  return data as AgentTaskRetryRow;
}

export async function resolveOpenRetries(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
}): Promise<number> {
  const { data, error } = await params.db
    .from("agent_task_retries")
    .update({ status: "RESOLVED", updated_at: new Date().toISOString() })
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .in("status", ["PENDING", "SCHEDULED", "EXECUTING"])
    .select("id");
  if (error) throw new Error(`resolveOpenRetries: ${error.message}`);
  return (data ?? []).length;
}

export async function processDueRetries(params: {
  db: SupabaseClient;
  empresaId?: string;
  limit?: number;
}): Promise<{ retriedCount: number; taskIds: string[] }> {
  let q = params.db
    .from("agent_task_retries")
    .select("id, task_id, empresa_id")
    .in("status", ["PENDING", "SCHEDULED"])
    .lte("next_retry_at", new Date().toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(params.limit ?? 50);
  if (params.empresaId) q = q.eq("empresa_id", params.empresaId);
  const { data, error } = await q;
  if (error) throw new Error(`processDueRetries: ${error.message}`);
  const taskIds: string[] = [];
  for (const row of (data ?? []) as Array<{ id: string; task_id: string; empresa_id: string }>) {
    await params.db
      .from("agent_task_retries")
      .update({ status: "EXECUTING", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    taskIds.push(row.task_id);
  }
  return { retriedCount: taskIds.length, taskIds };
}
