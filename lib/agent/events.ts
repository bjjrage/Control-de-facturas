// lib/agent/events.ts
// BATCH 6 — Eventos durables mínimos. Sin event bus genérico.
// El payload del evento es DATA no confiable (misma defensa que BATCH 4).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentEventRow } from "./life-types";
import { satisfyTaskWait } from "./waits";

export type AgentEventSource = "portal" | "api" | "system" | "worker" | "user" | "webhook";

export function buildDedupKey(params: {
  empresaId: string;
  eventType: string;
  correlationKey: string;
  sourceId?: string | null;
}): string {
  return `${params.empresaId}:${params.eventType}:${params.correlationKey}:${params.sourceId ?? ""}`;
}

export async function emitAgentEvent(params: {
  db: SupabaseClient;
  empresaId: string;
  eventType: string;
  sourceType: AgentEventSource;
  sourceId?: string | null;
  correlationKey: string;
  dedupKey?: string | null;
  payloadJson?: Record<string, unknown>;
  occurredAt?: string;
}): Promise<AgentEventRow | null> {
  const dedupKey =
    params.dedupKey ??
    buildDedupKey({
      empresaId: params.empresaId,
      eventType: params.eventType,
      correlationKey: params.correlationKey,
      sourceId: params.sourceId ?? null,
    });
  const { data, error } = await params.db
    .from("agent_events")
    .insert({
      empresa_id: params.empresaId,
      event_type: params.eventType,
      source_type: params.sourceType,
      source_id: params.sourceId ?? null,
      correlation_key: params.correlationKey,
      dedup_key: dedupKey,
      payload_json: params.payloadJson ?? {},
      occurred_at: params.occurredAt ?? new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw new Error(`emitAgentEvent: ${error.message}`);
  }
  return data as AgentEventRow;
}

export async function markEventProcessed(params: {
  db: SupabaseClient;
  eventId: string;
  empresaId: string;
  processorId?: string | null;
}): Promise<boolean> {
  const { error } = await params.db
    .from("agent_events")
    .update({
      processed_at: new Date().toISOString(),
      processor_id: params.processorId ?? null,
    })
    .eq("id", params.eventId)
    .eq("empresa_id", params.empresaId)
    .is("processed_at", null);
  if (error) throw new Error(`markEventProcessed: ${error.message}`);
  return true;
}

/**
 * Marca el evento como procesado (exactly-once) y satisface waits WAITING
 * correlacionados por correlation_key exacto. NO cambia tasks a RUNNING:
 * eso lo hace resumeTask(), única autoridad de reanudación.
 * No interpreta texto libre del payload (defensa prompt-injection).
 */
export async function processAgentEvent(params: {
  db: SupabaseClient;
  eventId: string;
  empresaId: string;
  processorId: string;
}): Promise<{ wokenCount: number; wokenWaitIds: string[]; taskIds: string[] }> {
  const { db, eventId, empresaId, processorId } = params;

  const { data: event, error: eventError } = await db
    .from("agent_events")
    .select("id, correlation_key, event_type, processed_at")
    .eq("id", eventId)
    .eq("empresa_id", empresaId)
    .single();
  if (eventError || !event) throw new Error(`processAgentEvent: evento no encontrado`);
  if ((event as { processed_at: string | null }).processed_at) {
    return { wokenCount: 0, wokenWaitIds: [], taskIds: [] };
  }
  await markEventProcessed({ db, eventId, empresaId, processorId });

  const { data: waits, error: waitsError } = await db
    .from("agent_task_waits")
    .select("id, task_id")
    .eq("empresa_id", empresaId)
    .eq("status", "WAITING")
    .eq("correlation_key", (event as { correlation_key: string }).correlation_key);
  if (waitsError) throw new Error(`processAgentEvent: ${waitsError.message}`);

  const wokenWaitIds: string[] = [];
  const taskIds: string[] = [];
  for (const wait of (waits ?? []) as Array<{ id: string; task_id: string }>) {
    await satisfyTaskWait({ db, waitId: wait.id, empresaId, eventId });
    wokenWaitIds.push(wait.id);
    taskIds.push(wait.task_id);
  }
  return { wokenCount: wokenWaitIds.length, wokenWaitIds, taskIds };
}
