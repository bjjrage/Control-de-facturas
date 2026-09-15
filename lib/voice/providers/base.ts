// lib/voice/providers/base.ts
// Abstracción base para proveedores de STT y TTS.
// El resto del ERP SOLO depende de estas interfaces, NUNCA de SDKs concretos.

import type {
  SttSessionConfig,
  TtsSessionConfig,
  TranscriptResult,
  TtsSpeakOptions,
  VoiceSessionState,
} from "../types";

/** Interfaz que todo proveedor STT debe implementar */
export interface SpeechToTextProvider {
  /** Identificador único del proveedor */
  readonly id: string;
  /** Nombre legible del proveedor */
  readonly name: string;
  /** Idiomas soportados (códigos BCP-47) */
  readonly supportedLanguages: string[];

  /**
   * Crea una sesión de streaming STT.
   * Retorna un objeto con métodos para enviar audio y recibir transcripciones.
   */
  createStreamingSession(config: SttSessionConfig): Promise<SttStreamingSession>;

  /**
   * Verifica si el proveedor está disponible y las credenciales son válidas.
   */
  healthCheck(): Promise<boolean>;

  /** Cierra conexiones y limpia recursos del proveedor */
  close(): Promise<void>;
}

/** Sesión activa de STT streaming */
export interface SttStreamingSession {
  /** Estado actual de la sesión */
  readonly state: VoiceSessionState;

  /**
   * Envía un chunk de audio (PCM 16-bit little-endian, sample rate según config).
   * Debe ser no bloqueante.
   */
  sendAudio(audioChunk: ArrayBuffer): Promise<void>;

  /**
   * Señala que no habrá más audio (fin de turno).
   * El proveedor debe enviar el transcript final si corresponde.
   */
  endTurn(): Promise<void>;

  /**
   * Interrumpe la sesión actual (barge-in).
   * Debe cancelar cualquier procesamiento pendiente y limpiar buffers.
   */
  interrupt(): Promise<void>;

  /**
   * Cierra la sesión completamente y libera recursos.
   */
  close(): Promise<void>;

  /**
   * Callback para resultados de transcripción (interim y final).
   * El caller registra su handler aquí.
   */
  onTranscript(handler: (result: TranscriptResult) => void): () => void;

  /**
   * Callback para cambios de estado.
   */
  onStateChange(handler: (state: VoiceSessionState) => void): () => void;

  /**
   * Callback de errores.
   */
  onError(handler: (error: Error) => void): () => void;
}

/** Interfaz que todo proveedor TTS debe implementar */
export interface TextToSpeechProvider {
  /** Identificador único del proveedor */
  readonly id: string;
  /** Nombre legible del proveedor */
  readonly name: string;
  /** Voces disponibles */
  readonly voices: string[];

  /**
   * Sintetiza texto a audio (streaming o buffer completo).
   * Retorna un stream o buffer de audio según opciones.
   */
  speak(text: string, options: {
    config?: {
      voice?: string;
      model?: string;
      encoding?: "linear16" | "mp3" | "mulaw" | "ogg_opus";
      sampleRate?: number;
      speed?: number;
      container?: "none" | "wav" | "mp3";
    };
    stream?: boolean;
    onAudioChunk?: (chunk: ArrayBuffer) => void;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: Error) => void;
  }): Promise<{
    audioBuffer?: ArrayBuffer;    // si stream=false
    stream?: AsyncIterable<ArrayBuffer>; // si stream=true
    durationMs?: number;
  }>;

  /**
   * Detiene cualquier síntesis/reproducción en curso (barge-in).
   */
  interrupt(): Promise<void>;

  /**
   * Verifica si el proveedor está disponible.
   */
  healthCheck(): Promise<boolean>;

  /** Cierra y limpia recursos */
  close(): Promise<void>;
}

/** Factory para obtener proveedores configurados */
export interface VoiceProviderFactory {
  getSttProvider(): SpeechToTextProvider | null;
  getTtsProvider(): TextToSpeechProvider | null;
  isVoiceAvailable(): boolean;
}