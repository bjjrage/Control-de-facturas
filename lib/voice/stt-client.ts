// lib/voice/stt-client.ts
// STT del lado cliente para Rodrigo V1: graba audio real con MediaRecorder
// (cross-browser: Firefox/Chrome/Edge, sin Web Speech API), detecta actividad
// de voz localmente (VAD con AudioContext/AnalyserNode, sin enviar audio al
// servidor hasta terminar) y envía a POST /api/agent/voice/transcribe, que
// transcribe server-side con OpenAI gpt-transcribe. Rodrigo NO habla: no hay
// TTS ni playback en este módulo. El transcript final entra al flujo normal
// vía onFinal -> sendMessage(). Una grabación = máximo un onFinal (fase
// explícita como guard de idempotencia).

import { DEFAULT_VAD_CONFIG, VoiceActivityDetector } from "./vad";

export type SttSupport = "supported" | "unsupported";

export type SttCallbacks = {
  /** Reservado (compat): MediaRecorder no produce interims, nunca se llama. */
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
  /** POST de transcripción en curso (UI "Transcribiendo…"). */
  onTranscribing?: () => void;
  /** Recorder andando (permiso OK, grabando). */
  onStarted?: () => void;
  /** VAD detectó voz (UI "Te escucho…"). */
  onSpeechStart?: () => void;
  /** Nivel RMS 0..1 para waveform real (throttleado por rAF). */
  onLevel?: (level: number) => void;
};

export type SttHandle = {
  /** Termina la grabación y transcribe (flujo normal: Apagar / auto-stop VAD). */
  stop: () => void;
  /** Aborta todo sin transcribir (minimizar/desmontar/cancelar): sin POST. */
  cancel: () => void;
};

export const STT_MAX_RECORD_MS = 30_000;
const TRANSCRIBE_URL = "/api/agent/voice/transcribe";

type FrameHandle = { raf: number } | { timeout: ReturnType<typeof setTimeout> };

function nextFrame(cb: () => void): FrameHandle {
  if (typeof requestAnimationFrame === "function") {
    return { raf: requestAnimationFrame(cb) };
  }
  return { timeout: setTimeout(cb, 16) };
}

function cancelFrame(handle: FrameHandle | null): void {
  if (!handle) return;
  try {
    if ("raf" in handle) cancelAnimationFrame(handle.raf);
    else clearTimeout(handle.timeout);
  } catch {
    // noop
  }
}

const MIME_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

type MediaDevicesLike = {
  getUserMedia?: (constraints: { audio: boolean }) => Promise<MediaStream>;
};

type RecorderConstructor = {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
};

type AudioContextConstructor = {
  new (): AudioContext;
};

function getMediaDevices(): MediaDevicesLike | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { mediaDevices?: MediaDevicesLike };
  if (typeof nav.mediaDevices?.getUserMedia !== "function") return null;
  return nav.mediaDevices;
}

function getRecorderConstructor(): RecorderConstructor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as Record<string, unknown>).MediaRecorder;
  return typeof ctor === "function" ? (ctor as RecorderConstructor) : null;
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  return typeof ctor === "function" ? (ctor as AudioContextConstructor) : null;
}

function pickMimeType(): string | null {
  const MR = getRecorderConstructor();
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  for (const mime of MIME_PREFERENCE) {
    try {
      if (MR.isTypeSupported(mime)) return mime;
    } catch {
      // Seguir probando el siguiente MIME.
    }
  }
  return null;
}

/** Client-only: true si se puede grabar + analizar audio (VAD). */
export function isSttSupported(): boolean {
  return (
    getMediaDevices() !== null &&
    getRecorderConstructor() !== null &&
    getAudioContextConstructor() !== null
  );
}

function micErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "No se pudo acceder al micrófono. Revisá los permisos del sitio.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No se encontró un micrófono.";
  }
  return "No se pudo iniciar el micrófono. Probá de nuevo.";
}

type SessionPhase = "setup" | "recording" | "finishing" | "done";

/**
 * Graba hasta 30s con VAD (auto-stop ~1s de silencio tras habla; "No te
 * escuché" si nunca hay voz), luego POSTea el Blob y llama onFinal. stop() =
 * terminar y transcribir; cancel() = abortar sin transcribir. Idempotencia:
 * una sola transición terminal por sesión (un onFinal XOR un onError, un
 * onEnd). Siempre cierra tracks, AudioContext, rAF y timers.
 */
export function startDictation(callbacks: SttCallbacks): SttHandle {
  const devices = getMediaDevices();
  const RecorderCtor = getRecorderConstructor();
  const AudioCtxCtor = getAudioContextConstructor();
  if (!devices?.getUserMedia || !RecorderCtor || !AudioCtxCtor) {
    callbacks.onError?.("Tu navegador no permite grabar audio desde esta página. Escribí el mensaje.");
    callbacks.onEnd?.();
    return { stop: () => undefined, cancel: () => undefined };
  }

  let phase: SessionPhase = "setup";
  let cancelled = false; // cancel() pidió abortar (sin transcribir, sin callbacks finales)
  let settled = false; // terminal onFinal/onError ya disparado (un transcript max)
  let ended = false; // onEnd ya disparado
  let stopRequested = false; // stop() durante setup
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let aborter: AbortController | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let frame: FrameHandle | null = null;
  let vad: VoiceActivityDetector | null = null;
  const chunks: BlobPart[] = [];
  const pcm = new Float32Array(512);

  const clearMaxTimer = () => {
    if (maxTimer !== null) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  };

  const stopFrame = () => { cancelFrame(frame); frame = null; };

  const closeAudioGraph = () => {
    stopFrame();
    try {
      sourceNode?.disconnect();
    } catch {
      // noop
    }
    sourceNode = null;
    analyser = null;
    vad = null;
    if (audioCtx) {
      const ctx = audioCtx;
      audioCtx = null;
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        // noop
      }
    }
  };

  const closeTracks = () => {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Un track ya cerrado no debe romper el cleanup.
        }
      }
      stream = null;
    }
  };

  const finishEnd = () => {
    if (ended) return;
    ended = true;
    phase = "done";
    clearMaxTimer();
    closeAudioGraph();
    closeTracks();
    recorder = null;
    callbacks.onEnd?.();
  };

  const fail = (message: string) => {
    if (settled || phase === "done") return;
    settled = true;
    phase = "finishing";
    try {
      aborter?.abort();
    } catch {
      // noop
    }
    callbacks.onError?.(message);
    finishEnd();
  };

  const mapTranscribeStatus = (status: number): string => {
    if (status === 422 || status === 400) return "No se detectó audio. Probá de nuevo.";
    if (status === 413) return "El audio superó el límite. Probá con un mensaje más corto.";
    return "No pude transcribir el audio. Probá de nuevo.";
  };

  const transcribe = async (blob: Blob) => {
    if (settled || phase === "done") {
      finishEnd();
      return;
    }
    phase = "finishing";
    if (blob.size === 0) {
      fail("No se detectó audio. Probá de nuevo.");
      return;
    }
    callbacks.onTranscribing?.();
    aborter = new AbortController();
    let response: Response;
    try {
      const form = new FormData();
      const base = (blob.type || "audio/webm").split(";")[0]?.trim().toLowerCase() || "audio/webm";
      const ext = base === "audio/ogg" ? "ogg" : base === "audio/mp4" ? "mp4" : "webm";
      form.append("audio", blob, `audio.${ext}`);
      response = await fetch(TRANSCRIBE_URL, {
        method: "POST",
        body: form,
        signal:
          typeof AbortSignal.any === "function"
            ? AbortSignal.any([aborter.signal, AbortSignal.timeout(70_000)])
            : aborter.signal,
      });
    } catch (error) {
      if (cancelled || (error as { name?: string } | null)?.name === "AbortError") {
        finishEnd();
        return;
      }
      fail("Se cortó la conexión mientras transcribía.");
      return;
    }
    if (cancelled) {
      finishEnd();
      return;
    }
    if (!response.ok) {
      fail(mapTranscribeStatus(response.status));
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as { transcript?: unknown };
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
    if (!transcript) {
      fail("No se detectó audio. Probá de nuevo.");
      return;
    }
    settled = true;
    callbacks.onFinal?.(transcript);
    finishEnd();
  };

  const onVadEvent = (event: "speech_start" | "silence_stop" | "no_speech_timeout") => {
    if (event === "speech_start") {
      callbacks.onSpeechStart?.();
      return;
    }
    if (event === "silence_stop") {
      stopTranscribe();
      return;
    }
    fail("No te escuché. Probá de nuevo.");
  };

  const loop = () => {
    if (phase !== "recording") return;
    frame = null;
    if (analyser && vad) {
      try {
        analyser.getFloatTimeDomainData(pcm);
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 1) {
          const v = pcm[i] ?? 0;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / pcm.length);
        callbacks.onLevel?.(Math.min(1, Math.max(0, rms)));
        vad.process(rms, performance.now());
      } catch {
        // Un frame corrupto no debe matar el loop; el próximo reintenta.
      }
    }
    if (phase === "recording") {
      frame = nextFrame(loop);
    }
  };

  const stopTranscribe = () => {
    if (settled || phase === "done" || phase === "finishing") return;
    if (phase === "setup" || !recorder) {
      // stop() antes de que arranque el recorder: transcribir ni bien arranque.
      stopRequested = true;
      return;
    }
    // Recorder existe: si está grabando, stop() dispara onstop -> transcribe.
    // Si ya está inactivo pero hay POST en curso, noop (ya transcribiendo).
    // La fase finishing la marca transcribe(); acá solo disparamos el stop.
    if (recorder.state !== "inactive") {
      phase = "finishing";
      clearMaxTimer();
      stopFrame();
      try {
        recorder.stop();
      } catch {
        fail("No se pudo grabar el audio. Probá de nuevo.");
      }
      return;
    }
    // Inactivo sin POST en curso y sin datos nuevos: solo puede pasar si
    // onstop aún no corrió (microtask pendiente) -> noop, onstop resolverá.
  };

  const beginRecording = (mediaStream: MediaStream) => {
    if (phase === "done") {
      mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // noop
        }
      });
      finishEnd();
      return;
    }
    const mimeType = pickMimeType();
    if (!mimeType) {
      mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // noop
        }
      });
      fail("Tu navegador no permite grabar audio desde esta página. Escribí el mensaje.");
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioCtxCtor();
    } catch {
      mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // noop
        }
      });
      fail("No se pudo iniciar el micrófono. Probá de nuevo.");
      return;
    }
    audioCtx = ctx;
    try {
      void ctx.resume().catch(() => undefined);
      sourceNode = ctx.createMediaStreamSource(mediaStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      sourceNode.connect(analyser);
    } catch {
      closeAudioGraph();
      mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // noop
        }
      });
      fail("No se pudo iniciar el micrófono. Probá de nuevo.");
      return;
    }
    stream = mediaStream;
    vad = new VoiceActivityDetector(DEFAULT_VAD_CONFIG, onVadEvent);
    try {
      recorder = new RecorderCtor(mediaStream, { mimeType });
    } catch {
      closeAudioGraph();
      closeTracks();
      fail("No se pudo iniciar el micrófono. Probá de nuevo.");
      return;
    }
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      clearMaxTimer();
      stopFrame();
      const type = recorder?.mimeType || mimeType;
      const blob = new Blob(chunks, { type });
      chunks.length = 0;
      closeTracks();
      if (phase === "done") {
        finishEnd();
        return;
      }
      void transcribe(blob);
    };
    recorder.onerror = () => {
      fail("No se pudo grabar el audio. Probá de nuevo.");
    };
    try {
      recorder.start();
    } catch {
      closeAudioGraph();
      closeTracks();
      fail("No se pudo iniciar el micrófono. Probá de nuevo.");
      return;
    }
    phase = "recording";
    callbacks.onStarted?.();
    frame = nextFrame(loop);
    maxTimer = setTimeout(() => {
      maxTimer = null;
      stopTranscribe();
    }, STT_MAX_RECORD_MS);
    if (stopRequested) {
      stopTranscribe();
    }
  };

  const cancelAll = () => {
    if (phase === "done") return;
    cancelled = true;
    phase = "done";
    clearMaxTimer();
    try {
      aborter?.abort();
    } catch {
      // noop
    }
    if (recorder && recorder.state !== "inactive") {
      const rec = recorder;
      // onstop verá phase done -> solo limpia (sin transcribir).
      try {
        rec.stop();
      } catch {
        // noop; finishEnd cierra igual
      }
    }
    // finishEnd cierra grafo/track y dispara el único onEnd (sin onFinal/onError).
    finishEnd();
  };

  devices
    .getUserMedia({ audio: true })
    .then(beginRecording)
    .catch((error: unknown) => {
      if (phase === "done") {
        finishEnd();
        return;
      }
      callbacks.onError?.(micErrorMessage(error));
      finishEnd();
    });

  return {
    stop: () => {
      try {
        stopTranscribe();
      } catch {
        // noop defensivo
      }
    },
    cancel: () => {
      try {
        cancelAll();
      } catch {
        // noop defensivo
      }
    },
  };
}
