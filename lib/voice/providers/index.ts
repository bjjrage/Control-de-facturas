// lib/voice/providers/index.ts
// Factory de proveedores de voz.
// Server-side only: NO expone API keys al cliente.

import type { VoiceProviderFactory } from "./base";
import { DeepgramSttProvider } from "./deepgram-stt";
import { DeepgramTtsProvider } from "./deepgram-tts";
import type { SpeechToTextProvider, TextToSpeechProvider } from "./base";
import { VoiceError, VoiceErrorCodes } from "../types";
import type {
  SttSessionConfig,
  TtsSessionConfig,
  TranscriptResult,
  TtsSpeakOptions,
  VoiceMetrics,
  VoiceSessionState,
} from "../types";

export { VoiceError, VoiceErrorCodes };
export type {
  SttSessionConfig,
  TtsSessionConfig,
  TranscriptResult,
  TtsSpeakOptions,
  VoiceMetrics,
  VoiceSessionState,
};

let sttProvider: SpeechToTextProvider | null = null;
let ttsProvider: TextToSpeechProvider | null = null;
let initialized = false;

/**
 * Inicializa los proveedores de voz.
 * Debe llamarse una sola vez al inicio de la aplicación (server-side).
 */
export function initializeVoiceProviders(options?: {
  deepgramApiKey?: string;
  sttProvider?: SpeechToTextProvider;
  ttsProvider?: TextToSpeechProvider;
}): void {
  if (initialized) return;

  const apiKey = options?.deepgramApiKey || process.env.DEEPGRAM_API_KEY;

  if (options?.sttProvider) {
    sttProvider = options.sttProvider;
  } else if (apiKey) {
    sttProvider = new DeepgramSttProvider({ apiKey });
  }

  if (options?.ttsProvider) {
    ttsProvider = options.ttsProvider;
  } else if (apiKey) {
    ttsProvider = new DeepgramTtsProvider({ apiKey });
  }

  initialized = true;
}

/**
 * Obtiene el proveedor STT configurado.
 * Retorna null si no hay proveedor configurado (voice unavailable).
 */
export function getSttProvider(): SpeechToTextProvider | null {
  return sttProvider;
}

/**
 * Obtiene el proveedor TTS configurado.
 * Retorna null si no hay proveedor configurado (voice unavailable).
 */
export function getTtsProvider(): TextToSpeechProvider | null {
  return ttsProvider;
}

/**
 * Verifica si la funcionalidad de voz está disponible.
 */
export function isVoiceAvailable(): boolean {
  return sttProvider !== null && ttsProvider !== null;
}

/**
 * Realiza health check de ambos proveedores.
 */
export async function voiceHealthCheck(): Promise<{
  stt: boolean;
  tts: boolean;
}> {
  const stt = sttProvider ? await sttProvider.healthCheck().catch(() => false) : false;
  const tts = ttsProvider ? await ttsProvider.healthCheck().catch(() => false) : false;
  return { stt, tts };
}

/**
 * Cierra todos los proveedores y limpia recursos.
 */
export async function closeVoiceProviders(): Promise<void> {
  await Promise.all([
    sttProvider?.close().catch(() => {}),
    ttsProvider?.close().catch(() => {}),
  ]);
  sttProvider = null;
  ttsProvider = null;
  initialized = false;
}

/**
 * Error si se intenta usar voz sin haber inicializado.
 */
export function assertVoiceAvailable(): void {
  if (!isVoiceAvailable()) {
    throw new Error(
      "Voice no disponible: DEEPGRAM_API_KEY no configurada o proveedores no inicializados. " +
        "Llamar a initializeVoiceProviders() al inicio de la aplicación."
    );
  }
}