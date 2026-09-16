// lib/agent/timers.ts
// BATCH 6 — Timers persistidos. El cron busca waits vencidos.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function processDueTimers(params: {
  db: SupabaseClient;
  empresaId?: string;
  limit?: number;
}): Promise<{ wokenCount: number; taskIds: string[]; wakes: Array<{ waitId: string; taskId: string }> }> {
  let q = params.db
    .from("agent_task_waits")
    .select("id, task_id, empresa_id")
    .eq("kind", "TIMER")
    .eq("status", "WAITING")
    .lte("wake_at", new Date().toISOString())
    .order("wake_at", { ascending: true })
    .limit(params.limit ?? 100);
  if (params.empresaId) q = q.eq("empresa_id", params.empresaId);
  const { data, error } = await q;
  if (error) throw new Error(`processDueTimers: ${error.message}`);
  const taskIds: string[] = [];
  const wakes: Array<{ waitId: string; taskId: string }> = [];
  for (const wait of (data ?? []) as Array<{ id: string; task_id: string; empresa_id: string }>) {
    const { data: updated, error: updateError } = await params.db
      .from("agent_task_waits")
      .update({ status: "SATISFIED", satisfied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", wait.id)
      .eq("status", "WAITING")
      .select("id");
    if (updateError) throw new Error(`processDueTimers: ${updateError.message}`);
    if ((updated ?? []).length > 0) {
      taskIds.push(wait.task_id);
      wakes.push({ waitId: wait.id, taskId: wait.task_id });
    }
  }
  return { wokenCount: taskIds.length, taskIds, wakes };
}
