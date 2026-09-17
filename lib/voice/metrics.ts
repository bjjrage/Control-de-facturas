// lib/voice/metrics.ts
// Métricas y costos de uso de voz.
// Registra uso para auditoría y control de costos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import type { VoiceMetrics } from "./providers";

/** Costos estimados por proveedor (USD) - actualizar según pricing real */
const PROVIDER_COSTS = {
  deepgram: {
    sttPerMinute: 0.0043,  // $0.0043/min (Pay-as-you-go Nova-2)
    ttsPerChar: 0.000015,  // $0.000015/char (~$15/1M chars)
  },
} as const;

export interface VoiceUsageRecord {
  sessionId: string;
  empresaId: string;
  userId: string | null;
  agentRunId?: string | null;
  provider: string;
  sttAudioSeconds: number;
  ttsCharacters: number;
  sttCostUsd: number;
  ttsCostUsd: number;
  totalCostUsd: number;
  latencyMs: {
    stt?: number;
    tts?: number;
    total?: number;
  };
  errors: number;
  startedAt: string;
  endedAt: string;
}

/**
 * Calcula costos estimados de una sesión de voz.
 */
export function calculateVoiceCost(
  provider: string,
  sttAudioSeconds: number,
  ttsCharacters: number
): { sttCostUsd: number; ttsCostUsd: number; totalCostUsd: number } {
  const costs = PROVIDER_COSTS[provider as keyof typeof PROVIDER_COSTS] || PROVIDER_COSTS.deepgram;
  const sttCostUsd = (sttAudioSeconds / 60) * costs.sttPerMinute;
  const ttsCostUsd = ttsCharacters * costs.ttsPerChar;
  return {
    sttCostUsd: Math.round(sttCostUsd * 10000) / 10000,
    ttsCostUsd: Math.round(ttsCostUsd * 10000) / 10000,
    totalCostUsd: Math.round((sttCostUsd + ttsCostUsd) * 10000) / 10000,
  };
}

/**
 * Registra métricas de uso de voz en auditoría.
 */
export async function recordVoiceUsage(
  db: any,
  metrics: {
    sessionId: string;
    empresaId: string;
    userId: string | null;
    agentRunId?: string | null;
    provider: string;
    sttAudioSeconds: number;
    ttsCharacters: number;
    latencyMs?: { stt?: number; tts?: number; total?: number };
    errors: number;
    startedAt: string;
    endedAt: string;
  }): Promise<void> {
  const costs = calculateVoiceCost(metrics.provider, metrics.sttAudioSeconds, metrics.ttsCharacters);

  const record: VoiceUsageRecord = {
    sessionId: metrics.sessionId,
    empresaId: metrics.empresaId,
    userId: metrics.userId,
    agentRunId: metrics.agentRunId,
    provider: metrics.provider,
    sttAudioSeconds: metrics.sttAudioSeconds,
    ttsCharacters: metrics.ttsCharacters,
    sttCostUsd: costs.sttCostUsd,
    ttsCostUsd: costs.ttsCostUsd,
    totalCostUsd: costs.totalCostUsd,
    latencyMs: metrics.latencyMs || {},
    errors: metrics.errors,
    startedAt: metrics.startedAt,
    endedAt: metrics.endedAt,
  };

  try {
    await logAudit(db, {
      action: "voice.usage.recorded",
      detail: record as any,
      actorType: "internal",
      actorLabel: metrics.userId || "system",
    });
  } catch {
    // best effort - no bloquear la respuesta al usuario
  }
}

/**
 * Obtiene resumen de costos de voz para una empresa en un período.
 */
export async function getVoiceCostSummary(
  db: any,
  empresaId: string,
  fromDate: string,
  toDate: string
): Promise<{
  totalSessions: number;
  totalSttMinutes: number;
  totalTtsChars: number;
  totalCostUsd: number;
  byProvider: Record<string, { sessions: number; costUsd: number }>;
}> {
  // En producción, consultar tabla de auditoría o tabla dedicada de voice_usage
  // Por ahora retorna estructura vacía
  return {
    totalSessions: 0,
    totalSttMinutes: 0,
    totalTtsChars: 0,
    totalCostUsd: 0,
    byProvider: {},
  };
}

/**
 * Verifica si una empresa ha excedido su presupuesto de voz.
 */
export async function checkVoiceBudget(
  db: any,
  empresaId: string,
  monthlyBudgetUsd: number
): Promise<{ withinBudget: boolean; currentSpendUsd: number; remainingUsd: number }> {
  // En producción, consultar voice_usage del mes actual
  const currentSpend = 0; // placeholder
  return {
    withinBudget: currentSpend < monthlyBudgetUsd,
    currentSpendUsd: currentSpend,
    remainingUsd: Math.max(0, monthlyBudgetUsd - currentSpend),
  };
}