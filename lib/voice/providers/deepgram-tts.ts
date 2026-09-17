// lib/voice/providers/deepgram-tts.ts
// Proveedor TTS usando Deepgram (streaming HTTP).
// Server-side only: NO expone API key al cliente.

import type {
  TtsSessionConfig,
  TtsSpeakOptions,
} from "../types";
import type { TextToSpeechProvider } from "./base";
import { VoiceError, VoiceErrorCodes } from "../types";

const DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";

interface DeepgramTtsOptions {
  apiKey: string;
}

interface DeepgramTtsVoice {
  name: string;
  model: string;
}

export class DeepgramTtsProvider implements TextToSpeechProvider {
  readonly id = "deepgram";
  readonly name = "Deepgram TTS";
  readonly voices = [
    "aura-asteria-es",
    "aura-luna-es",
    "aura-stella-es",
    "aura-asteria-en",
    "aura-luna-en",
    "aura-orpheus-en",
    "aura-helios-en",
    "aura-zeus-en",
    "aura-athena-en",
    "aura-hera-en",
  ];

  private apiKey: string;

  constructor(options: DeepgramTtsOptions) {
    if (!options.apiKey) {
      throw new VoiceError(VoiceErrorCodes.INVALID_CREDENTIALS, "Deepgram API key no configurada", {
        provider: "deepgram",
        recoverable: false,
      });
    }
    this.apiKey = options.apiKey;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("https://api.deepgram.com/v1/projects", {
        headers: { Authorization: `Token ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // No hay conexiones persistentes
  }

  async speak(
    text: string,
    options: {
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
    }
  ): Promise<{
    audioBuffer?: ArrayBuffer;
    stream?: AsyncIterable<ArrayBuffer>;
    durationMs?: number;
  }> {
    const {
      config = {},
      stream = false,
      onAudioChunk,
      onStart,
      onEnd,
      onError,
    } = options;

    const voice = config.voice || "aura-asteria-es";
    const model = config.model || "aura-2";
    const encoding = config.encoding || "linear16";
    const sampleRate = config.sampleRate || 16000;
    const container = config.container || "none";
    const speed = config.speed ?? 1.0;

    // Validar voz
    if (!this.voices.includes(voice)) {
      throw new VoiceError(VoiceErrorCodes.AUDIO_FORMAT_UNSUPPORTED, `Voz no soportada: ${voice}`, {
        provider: "deepgram",
        recoverable: false,
      });
    }

    const url = new URL(DEEPGRAM_TTS_URL);
    url.searchParams.set("model", voice);
    url.searchParams.set("encoding", encoding);
    url.searchParams.set("sample_rate", "16000"); // Deepgram TTS siempre 16k
    if (config.container) url.searchParams.set("container", container);

    const body = JSON.stringify({ text });

    try {
      const response = await fetch("https://api.deepgram.com/v1/speak", {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "audio/" + (config.encoding === "mp3" ? "mpeg" : "wav"),
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new VoiceError(
          VoiceErrorCodes.TTS_SYNTHESIS_FAILED,
          `Deepgram TTS error: ${response.status} ${errorText}`,
          { provider: "deepgram", recoverable: response.status >= 500 }
        );
      }

      if (!response.body) {
        throw new VoiceError(VoiceErrorCodes.TTS_SYNTHESIS_FAILED, "No response body from Deepgram TTS", {
          provider: "deepgram",
          recoverable: true,
        });
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      if (options.onStart) options.onStart();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (options.onAudioChunk) {
          options.onAudioChunk(value.buffer);
        }

        chunks.push(value);
        totalLength += value.length;
      }

      if (options.onEnd) options.onEnd();

      // Combinar todos los chunks
      const audioBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        audioBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      return {
        audioBuffer: audioBuffer.buffer,
        durationMs: Math.round((totalLength / 2) / 16000 * 1000), // PCM 16-bit @ 16kHz
      };
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      throw new VoiceError(VoiceErrorCodes.TTS_SYNTHESIS_FAILED, `TTS synthesis failed: ${error}`, {
        provider: "deepgram",
        recoverable: true,
      });
    }
  }

  async interrupt(): Promise<void> {
    // Para HTTP TTS no hay interrupt real, pero se puede cancelar el fetch
    // En streaming real, se cancelaría el reader
  }
}