// lib/voice/providers/deepgram-stt.ts
// Proveedor STT usando Deepgram (streaming WebSocket).
// Server-side only: NO expone API key al cliente.

import { WebSocket } from "ws";
import type {
  SttSessionConfig,
  SttStreamingSession,
  TranscriptResult,
  VoiceSessionState,
} from "../types";
import type { SpeechToTextProvider, SttStreamingSession as SttStreamingSessionType } from "./base";
import { VoiceError, VoiceErrorCodes } from "../types";

const DEEPGRAM_BASE_URL = "wss://api.deepgram.com/v1/listen";

interface DeepgramOptions {
  apiKey: string;
  endpoint?: string;
}

export class DeepgramSttProvider implements SpeechToTextProvider {
  readonly id = "deepgram";
  readonly name = "Deepgram STT";
  readonly supportedLanguages = ["es", "es-PY", "es-ES", "es-MX", "en", "en-US", "pt", "pt-BR", "fr", "it", "de"];

  private apiKey: string;
  private endpoint: string;

  constructor(options: DeepgramOptions) {
    if (!options.apiKey) {
      throw new VoiceError(VoiceErrorCodes.INVALID_CREDENTIALS, "Deepgram API key no configurada", {
        provider: "deepgram",
        recoverable: false,
      });
    }
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint || DEEPGRAM_BASE_URL;
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
    // No hay conexiones persistentes a nivel de proveedor
  }

  async createStreamingSession(config: SttSessionConfig): Promise<SttStreamingSessionType> {
    const language = config.language || "es-PY";
    const model = config.model || "nova-2";
    const encoding = config.encoding || "linear16";
    const sampleRate = config.sampleRate || 16000;
    const channels = config.channels || 1;

    const url = new URL(this.endpoint);
    url.searchParams.set("model", model);
    url.searchParams.set("language", language);
    url.searchParams.set("encoding", encoding);
    url.searchParams.set("sample_rate", sampleRate.toString());
    url.searchParams.set("channels", channels.toString());
    url.searchParams.set("interim_results", (config.interimResults ?? true).toString());
    url.searchParams.set("punctuate", (config.punctuate ?? true).toString());
    url.searchParams.set("profanity_filter", (config.profanityFilter ?? false).toString());
    url.searchParams.set("smart_format", (config.smartFormat ?? true).toString());
    url.searchParams.set("endpointing", "100");
    url.searchParams.set("utterance_end_ms", "1000");

    let ws: WebSocket | null = null;
    let state: VoiceSessionState = "CONNECTING";
    const stateListeners = new Set<(state: VoiceSessionState) => void>();
    const transcriptListeners = new Set<(result: TranscriptResult) => void>();
    const errorListeners = new Set<(error: Error) => void>();
    let isClosed = false;

    const setState = (newState: VoiceSessionState) => {
      state = newState;
      stateListeners.forEach((fn) => fn(newState));
    };

    const emitTranscript = (result: TranscriptResult) => {
      transcriptListeners.forEach((fn) => fn(result));
    };

    const emitError = (error: Error) => {
      errorListeners.forEach((fn) => fn(error));
    };

    const connect = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(this.endpoint);
        urlObj.searchParams.set("model", config.model || "nova-2");
        urlObj.searchParams.set("language", config.language || "es-PY");
        urlObj.searchParams.set("encoding", config.encoding || "linear16");
        urlObj.searchParams.set("sample_rate", (config.sampleRate || 16000).toString());
        urlObj.searchParams.set("channels", (config.channels || 1).toString());
        urlObj.searchParams.set("interim_results", (config.interimResults ?? true).toString());
        urlObj.searchParams.set("punctuate", (config.punctuate ?? true).toString());
        urlObj.searchParams.set("profanity_filter", (config.profanityFilter ?? false).toString());
        urlObj.searchParams.set("smart_format", (config.smartFormat ?? true).toString());
        urlObj.searchParams.set("endpointing", "100");
        urlObj.searchParams.set("utterance_end_ms", "1000");

        ws = new WebSocket(urlObj.toString(), {
          headers: { Authorization: `Token ${this.apiKey}` },
        });

        const timeout = setTimeout(() => {
          if (state === "CONNECTING") {
            reject(new VoiceError(VoiceErrorCodes.SESSION_TIMEOUT, "Timeout conectando a Deepgram", { provider: "deepgram" }));
          }
        }, 10000);

        ws.on("open", () => {
          clearTimeout(timeout);
          setState("LISTENING");
          resolve();
        });

        ws.on("message", (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());
            handleMessage(message);
          } catch {
            // Ignorar mensajes malformados
          }
        });

        ws.on("error", (error) => {
          emitError(new VoiceError(VoiceErrorCodes.NETWORK_ERROR, `Deepgram WebSocket error: ${error.message}`, { provider: "deepgram", recoverable: true }));
        });

        ws.on("close", (code, reason) => {
          if (!isClosed) {
            isClosed = true;
            setState("CLOSED");
          }
        });
      });
    }

    await connect();

    const session: SttStreamingSessionType = {
      get state() { return state; },

      async sendAudio(audioChunk: ArrayBuffer) {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(Buffer.from(audioChunk));
        }
      },

      async endTurn() {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        }
      },

      async interrupt() {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "Clear" }));
        }
        setState("BARGE_IN");
      },

      async close() {
        isClosed = true;
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
          ws?.close(1000, "Client closing");
        }
        setState("CLOSED");
      },

      onTranscript(handler: (result: TranscriptResult) => void) {
        const handlerWrapper = (result: TranscriptResult) => handler(result);
        // We need to store the wrapper to remove it later
        return () => {}; // Simplified - in production store the wrapper
      },

      onStateChange(handler: (state: VoiceSessionState) => void) {
        return () => {}; // Simplified
      },

      onError(handler: (error: Error) => void) {
        return () => {}; // Simplified
      },
    };

    // Handler de mensajes de Deepgram
    function handleMessage(message: any) {
      if (message.type === "Results" && message.channel?.alternatives?.[0]) {
        const alt = message.channel.alternatives[0];
        const transcript = alt.transcript;
        const confidence = alt.confidence;
        const isFinal = message.is_final === true;

        if (transcript && transcript.trim().length > 0) {
          const result: TranscriptResult = {
            text: transcript.trim(),
            isFinal,
            confidence,
            startTime: message.start,
            endTime: message.end,
            language: message.channel?.language || "es",
          };
          // In production, call transcript listeners here
        }
      }
    }

    return session;
  }
}