// lib/voice/types.ts
// Tipos compartidos para la capa de voz (STT/TTS).
// El resto del ERP NO debe depender de SDKs de proveedores concretos.

/** Estado de una sesión de voz */
export type VoiceSessionState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "TRANSCRIBING"
  | "THINKING"
  | "SPEAKING"
  | "BARGE_IN"
  | "ERROR"
  | "CLOSED";

/** Resultado parcial de transcripción (interim) */
export interface InterimTranscript {
  text: string;
  isFinal: false;
  confidence?: number;
  startTime?: number;
  endTime?: number;
}

/** Resultado final de transcripción */
export interface FinalTranscript {
  text: string;
  isFinal: true;
  confidence?: number;
  startTime?: number;
  endTime?: number;
  language?: string;
}

/** Unión de resultados de transcripción */
export type TranscriptResult = InterimTranscript | FinalTranscript;

/** Configuración de sesión STT */
export interface SttSessionConfig {
  language?: string;           // ej: "es-PY", "es-ES", "es"
  interimResults?: boolean;    // emitir resultados parciales
  punctuate?: boolean;         // agregar puntuación
  profanityFilter?: boolean;
  smartFormat?: boolean;       // formateo inteligente (números, fechas, etc.)
  model?: string;              // modelo específico del provider
  encoding?: "linear16" | "mulaw" | "opus" | "flac";
  sampleRate?: number;         // 16000, 8000, 48000
  channels?: number;           // 1 (mono) o 2 (estéreo)
}

/** Configuración de sesión TTS */
export interface TtsSessionConfig {
  voice?: string;              // voz a usar (ej: "aura-asteria-es", "aura-luna-es")
  model?: string;              // modelo TTS
  encoding?: "linear16" | "mp3" | "mulaw" | "ogg_opus";
  sampleRate?: number;         // 8000, 16000, 24000, 48000
  speed?: number;              // 0.5 - 2.0
  container?: "none" | "wav" | "mp3";
}

/** Opciones de reproducción TTS */
export interface TtsSpeakOptions {
  text: string;
  config?: TtsSessionConfig;
  /** Si true, no esperar a que termine para retornar (streaming) */
  stream?: boolean;
  /** Callback para cuando empiece la reproducción */
  onStart?: () => void;
  /** Callback para cada chunk de audio */
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  /** Callback cuando termine */
  onEnd?: () => void;
  /** Callback de error */
  onError?: (error: Error) => void;
}

/** Sesión STT streaming activa */
export interface SttStreamingSession {
  readonly state: VoiceSessionState;
  sendAudio(audioChunk: ArrayBuffer): Promise<void>;
  endTurn(): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  onTranscript(handler: (result: TranscriptResult) => void): () => void;
  onStateChange(handler: (state: VoiceSessionState) => void): () => void;
  onError(handler: (error: Error) => void): () => void;
}

/** Métricas de uso de voz */
export interface VoiceMetrics {
  sessionId: string;
  empresaId: string;
  userId: string | null;
  agentRunId?: string | null;
  sttAudioSeconds: number;
  ttsCharacters: number;
  provider: string;
  sttLatencyMs?: number;
  ttsLatencyMs?: number;
  errors: number;
  startedAt: string;
  endedAt?: string;
}

/** Error tipado de voz */
export class VoiceError extends Error {
  code: string;
  provider?: string;
  recoverable: boolean;

  constructor(code: string, message: string, opts?: { provider?: string; recoverable?: boolean }) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
    this.provider = opts?.provider;
    this.recoverable = opts?.recoverable ?? true;
  }
}

/** Códigos de error estandarizados */
export const VoiceErrorCodes = {
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  NETWORK_ERROR: "NETWORK_ERROR",
  AUDIO_FORMAT_UNSUPPORTED: "AUDIO_FORMAT_UNSUPPORTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SESSION_TIMEOUT: "SESSION_TIMEOUT",
  BARGE_IN_FAILED: "BARGE_IN_FAILED",
  TTS_SYNTHESIS_FAILED: "TTS_SYNTHESIS_FAILED",
  STT_TRANSCRIPTION_FAILED: "STT_TRANSCRIPTION_FAILED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  UNKNOWN: "UNKNOWN",
} as const;