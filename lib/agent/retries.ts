// lib/agent/retries.ts
// BATCH 6 — Reintentos con backoff. Sin loops infinitos.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTaskRetryRow } from "./life-types";
import { updateTaskStatus } from "./runtime";
import { sanitizeAgentError } from "./sanitize";

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
  const safeErrorMessage = sanitizeAgentError(params.errorMessage, 2000);
  const { data: existing } = await params.db
    .from("agent_task_retries")
    .select("*")
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const attemptNumber = existing ? (existing as AgentTaskRetryRow).attempt_number + 1 : 1;
  const maxAttempts = params.maxAttempts ?? (existing as AgentTaskRetryRow | null)?.max_attempts ?? 3;

  const { data: task } = await params.db
    .from("agent_tasks")
    .select("status")
    .eq("id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .maybeSingle();
  if (task && (task as { status: string }).status === "RUNNING") {
    await updateTaskStatus({
      db: params.db,
      taskId: params.taskId,
      empresaId: params.empresaId,
      status: "FAILED",
      errorMessage: safeErrorMessage,
      actorType: "worker",
    });
  }

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
        last_error_message: safeErrorMessage,
        last_error_at: new Date().toISOString(),
        next_retry_at: null,
        status: "EXHAUSTED",
      })
      .select("*")
      .single();
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === "23505") {
        const { data: concurrent } = await params.db
          .from("agent_task_retries")
          .select("*")
          .eq("task_id", params.taskId)
          .eq("attempt_number", attemptNumber)
          .maybeSingle();
        if (concurrent) return concurrent as AgentTaskRetryRow;
      }
      throw new Error(`scheduleRetry: ${error?.message ?? "sin data"}`);
    }
    if ((task as { status?: string } | null)?.status !== "FAILED") {
      await updateTaskStatus({
        db: params.db,
        taskId: params.taskId,
        empresaId: params.empresaId,
        status: "FAILED",
        errorMessage: safeErrorMessage,
        actorType: "worker",
      });
    }
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
      last_error_message: safeErrorMessage,
      last_error_at: new Date().toISOString(),
      next_retry_at: nextRetryAt,
      status: "SCHEDULED",
    })
    .select("*")
    .single();
  if (error || !data) {
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: concurrent } = await params.db
        .from("agent_task_retries")
        .select("*")
        .eq("task_id", params.taskId)
        .eq("attempt_number", attemptNumber)
        .maybeSingle();
      if (concurrent) return concurrent as AgentTaskRetryRow;
    }
    throw new Error(`scheduleRetry: ${error?.message ?? "sin data"}`);
  }
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
  staleExecutingAfterMs?: number;
}): Promise<{ retriedCount: number; taskIds: string[] }> {
  const staleBefore = new Date(Date.now() - (params.staleExecutingAfterMs ?? 60_000)).toISOString();
  let staleQuery = params.db
    .from("agent_task_retries")
    .select("id, task_id, empresa_id")
    .eq("status", "EXECUTING")
    .lt("updated_at", staleBefore);
  if (params.empresaId) staleQuery = staleQuery.eq("empresa_id", params.empresaId);
  const { data: staleRows, error: staleError } = await staleQuery;
  if (staleError) throw new Error(`processDueRetries recovery: ${staleError.message}`);
  for (const row of (staleRows ?? []) as Array<{ id: string }>) {
    const { error: recoverError } = await params.db
      .from("agent_task_retries")
      .update({ status: "SCHEDULED", next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "EXECUTING");
    if (recoverError) throw new Error(`processDueRetries recovery: ${recoverError.message}`);
  }

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
    const { data: claimed, error: claimError } = await params.db
      .from("agent_task_retries")
      .update({ status: "EXECUTING", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .in("status", ["PENDING", "SCHEDULED"])
      .select("id");
    if (claimError) throw new Error(`processDueRetries claim: ${claimError.message}`);
    if ((claimed ?? []).length > 0) taskIds.push(row.task_id);
  }
  return { retriedCount: taskIds.length, taskIds };
}
