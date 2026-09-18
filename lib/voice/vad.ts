// lib/voice/vad.ts
// Voice Activity Detection local y determinístico para Rodrigo.
// Analiza RMS (0..1) por frame con timestamps explícitos (sin timers propios):
// el llamador alimenta process(rms, nowMs) a ~60fps (rAF) o ~20fps (intervalo).
// Emite como máximo UN evento terminal por sesión (speech_start una vez,
// luego silence_stop O no_speech_timeout). Sin dependencias de browser.

export type VadPhase = "waiting_for_speech" | "speech_detected";

export type VadEvent = "speech_start" | "silence_stop" | "no_speech_timeout";

export type VadConfig = {
  /** RMS para considerar voz (con histéresis: stop usa speechThreshold*0.75). */
  speechThreshold: number;
  /** Ms continuos sobre threshold para confirmar habla (anti picos). */
  speechStableMs: number;
  /** Ms continuos de silencio tras habla para endpointing. */
  silenceMs: number;
  /** Ms sin habla desde el inicio para rendirse (sin envío). */
  noSpeechMs: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechThreshold: 0.02,
  speechStableMs: 150,
  silenceMs: 1000,
  noSpeechMs: 8000,
};

export class VoiceActivityDetector {
  private phase: VadPhase = "waiting_for_speech";
  private startMs: number | null = null;
  private aboveSince: number | null = null;
  private silenceSince: number | null = null;
  private done = false;

  constructor(
    private readonly config: VadConfig,
    private readonly onEvent: (event: VadEvent) => void
  ) {}

  getPhase(): VadPhase {
    return this.phase;
  }

  isDone(): boolean {
    return this.done;
  }

  reset(): void {
    this.phase = "waiting_for_speech";
    this.startMs = null;
    this.aboveSince = null;
    this.silenceSince = null;
    this.done = false;
  }

  process(rms: number, nowMs: number): void {
    if (this.done) return;
    if (this.startMs === null) this.startMs = nowMs;
    const level = Number.isFinite(rms) && rms > 0 ? rms : 0;

    if (this.phase === "waiting_for_speech") {
      if (level >= this.config.speechThreshold) {
        if (this.aboveSince === null) this.aboveSince = nowMs;
        if (nowMs - this.aboveSince >= this.config.speechStableMs) {
          this.phase = "speech_detected";
          this.silenceSince = null;
          this.onEvent("speech_start");
        }
      } else {
        this.aboveSince = null;
        if (nowMs - this.startMs >= this.config.noSpeechMs) {
          this.done = true;
          this.onEvent("no_speech_timeout");
        }
      }
      return;
    }

    // speech_detected: endpointing por silencio continuo (con histéresis).
    const silenceThreshold = this.config.speechThreshold * 0.75;
    if (level < silenceThreshold) {
      if (this.silenceSince === null) this.silenceSince = nowMs;
      if (nowMs - this.silenceSince >= this.config.silenceMs) {
        this.done = true;
        this.onEvent("silence_stop");
      }
    } else {
      // Voz (o ruido fuerte): un micro silencio entre palabras NO corta.
      this.silenceSince = null;
    }
  }
}
