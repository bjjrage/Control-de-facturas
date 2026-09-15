// lib/agent/leases.ts
// BATCH 6 — Leases atómicos para evitar resume/ejecución concurrente.
// Un task = un lease activo. El holder lo renueva; otro worker solo
// puede tomarlo cuando expiró (crash recovery).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTaskLeaseRow } from "./life-types";

export async function claimTaskLease(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  holderId: string;
  holderType?: string;
  ttlSeconds?: number;
}): Promise<{ success: boolean; lease?: AgentTaskLeaseRow; error?: string }> {
  const ttl = params.ttlSeconds ?? 300;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await params.db
    .from("agent_task_leases")
    .delete()
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .lt("expires_at", now);

  const { data, error } = await params.db
    .from("agent_task_leases")
    .insert({
      task_id: params.taskId,
      empresa_id: params.empresaId,
      holder_id: params.holderId,
      holder_type: params.holderType ?? "worker",
      acquired_at: now,
      expires_at: expiresAt,
      renewed_at: null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { success: false, error: "Lease held by another holder" };
  }
  return { success: true, lease: data as AgentTaskLeaseRow };
}

export async function renewTaskLease(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  holderId: string;
  ttlSeconds?: number;
}): Promise<{ success: boolean; lease?: AgentTaskLeaseRow; error?: string }> {
  const ttl = params.ttlSeconds ?? 300;
  const { data, error } = await params.db
    .from("agent_task_leases")
    .update({
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      renewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .eq("holder_id", params.holderId)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Lease not found or expired" };
  }
  return { success: true, lease: data as AgentTaskLeaseRow };
}

export async function releaseTaskLease(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  holderId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { error } = await params.db
    .from("agent_task_leases")
    .delete()
    .eq("task_id", params.taskId)
    .eq("empresa_id", params.empresaId)
    .eq("holder_id", params.holderId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function cleanupExpiredLeases(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("agent_task_leases")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (error) throw new Error(`cleanupExpiredLeases: ${error.message}`);
  return count ?? 0;
}
