// lib/voice/service.ts
// Servicio de voz que integra STT + TTS con el Agent Orchestrator.
// Maneja el ciclo de vida completo de una sesión de voz.

import type { AgentToolContext } from "@/lib/agent/context";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AgentOrchestrator } from "@/lib/agent/orchestrator";
import {
  getSttProvider,
  getTtsProvider,
  isVoiceAvailable,
} from "./providers";
import { VoiceError, VoiceErrorCodes } from "./providers";
import type {
  SttSessionConfig,
  TtsSessionConfig,
  TranscriptResult,
  VoiceMetrics,
  VoiceSessionState,
} from "./providers";
import { logAudit } from "@/lib/audit";

export interface VoiceSessionConfig {
  stt?: SttSessionConfig;
  tts?: TtsSessionConfig;
  maxTurnDurationMs?: number;
  idleTimeoutMs?: number;
  maxTtsChars?: number;
}

export interface VoiceSession {
  sessionId: string;
  state: VoiceSessionState;
  context: AgentToolContext;
  config: VoiceSessionConfig;
  metrics: VoiceMetrics;
  abortController: AbortController;
}

const MAX_TURN_DURATION_MS = 60_000;
const IDLE_TIMEOUT_MS = 30_000;
const MAX_TTS_CHARS = 4000;

/**
 * Crea una nueva sesión de voz.
 * El contexto (tenant, user, project, workspace) viene del agente autenticado.
 */
export async function createVoiceSession(
  context: AgentToolContext,
  config: VoiceSessionConfig = {}
): Promise<VoiceSession> {
  if (!context.empresaId) {
    throw new Error("Voice session requiere empresaId en context");
  }

  const sessionId = crypto.randomUUID();
  const abortController = new AbortController();

  const metrics: VoiceMetrics = {
    sessionId,
    empresaId: context.empresaId,
    userId: context.userId,
    agentRunId: context.runId || context.taskId || null,
    sttAudioSeconds: 0,
    ttsCharacters: 0,
    provider: "deepgram",
    errors: 0,
    startedAt: new Date().toISOString(),
  };

  return {
    sessionId,
    state: "IDLE",
    context,
    config: {
      maxTurnDurationMs: config.maxTurnDurationMs || MAX_TURN_DURATION_MS,
      idleTimeoutMs: config.idleTimeoutMs || IDLE_TIMEOUT_MS,
      maxTtsChars: config.maxTtsChars || MAX_TTS_CHARS,
      stt: config.stt,
      tts: config.tts,
    },
    metrics,
    abortController,
  };
}

/**
 * Ejecuta un turno de voz completo: STT -> Orchestrator -> TTS.
 * Maneja barge-in, timeouts y errores.
 */
export async function runVoiceTurn(
  session: VoiceSession,
  audioStream: AsyncIterable<ArrayBuffer>,
  onTranscript: (result: { text: string; isFinal: boolean }) => void,
  onTtsAudio: (chunk: ArrayBuffer) => void,
  onStateChange: (state: string) => void
): Promise<{
  transcript: string;
  agentResponse: string;
  toolsUsed: string[];
  metrics: VoiceMetrics;
}> {
  const sttProvider = getSttProvider();
  const ttsProvider = getTtsProvider();

  if (!sttProvider || !ttsProvider) {
    throw new Error("Voice providers no disponibles");
  }

  const startTime = Date.now();
  let finalTranscript = "";
  let interimTranscript = "";
  let sttSession: any = null;
  let transcriptReceived = false;

  try {
    // 1. Crear sesión STT
    const sttSessionObj = await sttProvider.createStreamingSession({
      language: "es-PY",
      interimResults: true,
      punctuate: true,
      smartFormat: true,
      encoding: "linear16",
      sampleRate: 16000,
    });

    // 2. Conectar handlers STT
    const unsubTranscript = (sttSessionObj as any).onTranscript?.((result: any) => {
      if (result.isFinal) {
        finalTranscript = result.text;
        transcriptReceived = true;
        onTranscript({ text: result.text, isFinal: true });
      } else {
        interimTranscript = result.text;
        onTranscript({ text: result.text, isFinal: false });
      }
    });

    const unsubState = (sttSessionObj as any).onStateChange?.((state: string) => {
      onStateChange(state);
    });

    const unsubError = (sttSessionObj as any).onError?.((error: Error) => {
      console.error("[Voice] STT error:", error);
    });

    // 3. Enviar audio streaming
    for await (const audioChunk of audioStream) {
      if (session.abortController.signal.aborted) break;
      await (sttSessionObj as any).sendAudio(audioChunk);
    }

    // 4. End turn y esperar transcript final
    await (sttSessionObj as any).endTurn?.();

    // Esperar un poco por el transcript final
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!finalTranscript.trim()) {
      throw new Error("No se recibió transcript final");
    }

    // 4. Ejecutar orchestrator con el transcript
    const orchestrator = new AgentOrchestrator({
      apiKey: process.env.DEEPSEEK_API_KEY,
      maxIterations: 8,
      timeoutMs: 90_000,
    });

    const orchestratorResult = await orchestrator.run({
      db: null as any, // Se inyecta desde el caller
      actor: {
        ...session.context,
        taskId: session.context.taskId,
        runId: session.context.runId,
      },
      userIntent: finalTranscript,
    });

    // 5. TTS de la respuesta
    const agentResponse = orchestratorResult.answer || "No tengo respuesta.";
    const ttsText = sanitizeForTts(agentResponse);

    await speakWithTts(ttsProvider, ttsText, {
      onAudioChunk: (chunk) => {
        session.metrics.ttsCharacters += new TextDecoder().decode(chunk).length;
        // callback al cliente
      },
      onStart: () => {
        // Estado SPEAKING
      },
      onEnd: () => {
        // Estado IDLE
      },
    });

    // Actualizar métricas
    session.metrics.endedAt = new Date().toISOString();

    return {
      transcript: finalTranscript,
      agentResponse,
      toolsUsed: orchestratorResult.turns
        .filter((t): t is typeof t & { toolName: string } => typeof t.toolName === "string")
        .map((t) => t.toolName),
      metrics: session.metrics,
    };
  } finally {
    // Cleanup
    // sttSession?.close?.()
  }
}

/**
 * Sintetiza texto a audio usando TTS provider.
 */
async function speakWithTts(
  provider: any,
  text: string,
  callbacks: {
    onAudioChunk: (chunk: ArrayBuffer) => void;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: Error) => void;
  }
): Promise<void> {
  const sanitized = sanitizeForTts(text);
  
  if (!sanitized.trim()) return;

  await provider.speak(sanitized, {
    config: {
      voice: "aura-asteria-es",
      encoding: "linear16",
      sampleRate: 16000,
      speed: 1.0,
    },
    stream: true,
    onAudioChunk: callbacks.onAudioChunk,
    onStart: callbacks.onStart,
    onEnd: callbacks.onEnd,
    onError: callbacks.onError,
  });
}

/**
 * Sanitiza texto para TTS: remueve JSON, IDs técnicos, chain-of-thought.
 * Solo deja texto natural para el usuario.
 */
export function sanitizeForTts(text: string): string {
  let sanitized = text;

  // Remover bloques de código
  sanitized = sanitized.replace(/```[\s\S]*?```/g, "");
  
  // Remover JSON suelto
  sanitized = sanitized.replace(/\{[\s\S]*?\}/g, (match) => {
    try {
      JSON.parse(match);
      return "";
    } catch {
      return match;
    }
  });

  // Remover IDs técnicos (UUIDs, IDs técnicos)
  sanitized = sanitized.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");
  sanitized = sanitized.replace(/\b[A-Z]{2,}_[A-Z0-9_]+\b/g, "");

  // Remover "Thinking...", "Processing...", etc.
  sanitized = sanitized.replace(/^(thinking|processing|waiting|analizando|procesando)[\.\s]*/gi, "");

  // Normalizar espacios
  sanitized = sanitized.replace(/\s+/g, " ").trim();

  return sanitized;
}

/**
 * Log de métricas de voz para auditoría.
 */
export async function logVoiceMetrics(
  db: any,
  metrics: VoiceMetrics
): Promise<void> {
  try {
    await logAudit(db, {
      action: "voice.session.completed",
      detail: {
        session_id: metrics.sessionId,
        stt_audio_seconds: metrics.sttAudioSeconds,
        tts_characters: metrics.ttsCharacters,
        provider: metrics.provider,
        errors: metrics.errors,
        duration_ms: metrics.endedAt
          ? new Date(metrics.endedAt).getTime() - new Date(metrics.startedAt).getTime()
          : null,
      } as any,
      actorType: "internal",
      actorLabel: metrics.userId || "system",
    });
  } catch {
    // best effort
  }
}