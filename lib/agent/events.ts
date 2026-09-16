// lib/agent/events.ts
// BATCH 6 — Eventos durables mínimos. Sin event bus genérico.
// El payload del evento es DATA no confiable (misma defensa que BATCH 4).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentEventRow } from "./life-types";

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

/**
 * Procesa el evento y satisface waits WAITING en una única transacción DB.
 * El RPC bloquea el evento, aplica sólo los waits con empresa_id + event_type
 * + correlation_key exactos y recién después marca processed_at. Si cualquier
 * efecto falla, Postgres revierte todo y el evento queda recuperable.
 * NO cambia tasks a RUNNING: eso lo hace resumeTask(), única autoridad.
 * No interpreta texto libre del payload (defensa prompt-injection).
 */
export interface AgentEventWake {
  waitId: string;
  taskId: string;
}

export interface ProcessAgentEventResult {
  wokenCount: number;
  wokenWaitIds: string[];
  taskIds: string[];
  woken: AgentEventWake[];
}

export async function processAgentEvent(params: {
  db: SupabaseClient;
  eventId: string;
  empresaId: string;
  processorId: string;
}): Promise<ProcessAgentEventResult> {
  const { db } = params;
  const { data, error } = await db.rpc("process_agent_event", {
    p_event_id: params.eventId,
    p_empresa_id: params.empresaId,
    p_processor_id: params.processorId,
  });
  if (error) throw new Error(`processAgentEvent: ${error.message}`);

  const result = (data ?? {}) as {
    wokenCount?: number;
    wokenWaitIds?: unknown;
    taskIds?: unknown;
    woken?: unknown;
  };
  const wokenWaitIds = Array.isArray(result.wokenWaitIds)
    ? result.wokenWaitIds.filter((id): id is string => typeof id === "string")
    : [];
  const taskIds = Array.isArray(result.taskIds)
    ? result.taskIds.filter((id): id is string => typeof id === "string")
    : [];
  const woken = Array.isArray(result.woken)
    ? result.woken.filter(
        (wake): wake is AgentEventWake =>
          !!wake && typeof wake === "object" && typeof (wake as AgentEventWake).waitId === "string" && typeof (wake as AgentEventWake).taskId === "string"
      )
    : wokenWaitIds.map((waitId, index) => ({ waitId, taskId: taskIds[index] })).filter((wake): wake is AgentEventWake => Boolean(wake.taskId));

  return {
    wokenCount: typeof result.wokenCount === "number" ? result.wokenCount : woken.length,
    wokenWaitIds,
    taskIds,
    woken,
  };
}
