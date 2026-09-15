// lib/agent/timers.ts
// BATCH 6 — Timers persistidos. El cron busca waits vencidos.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function processDueTimers(params: {
  db: SupabaseClient;
  empresaId?: string;
  limit?: number;
}): Promise<{ wokenCount: number; taskIds: string[] }> {
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
  for (const wait of (data ?? []) as Array<{ id: string; task_id: string; empresa_id: string }>) {
    await params.db
      .from("agent_task_waits")
      .update({ status: "SATISFIED", satisfied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", wait.id)
      .eq("status", "WAITING");
    taskIds.push(wait.task_id);
  }
  return { wokenCount: taskIds.length, taskIds };
}
