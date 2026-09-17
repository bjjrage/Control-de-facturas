// lib/voice/stt-client.ts
// STT del lado cliente para Rodrigo V1: usa Web Speech API del navegador
// (SpeechRecognition, procesamiento local del vendor del browser, sin keys).
// Rodrigo NO habla: no hay TTS ni playback en este módulo.

export type SttSupport = "supported" | "unsupported";

export type SttCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return (typeof ctor === "function" ? ctor : null) as (new () => SpeechRecognitionInstance) | null;
}

/** Client-only: true si el navegador expone SpeechRecognition. */
export function isSttSupported(): boolean {
  return getRecognitionConstructor() !== null;
}

/**
 * Inicia reconocimiento en español (es-PY con fallback es-ES). Llama onFinal
 * con el transcript definitivo. Retorna función stop(). Puro browser.
 */
export function startDictation(callbacks: SttCallbacks): () => void {
  const Ctor = getRecognitionConstructor();
  if (!Ctor) {
    callbacks.onError?.("Tu navegador no expone reconocimiento de voz. Escribí el mensaje.");
    callbacks.onEnd?.();
    return () => undefined;
  }
  const recognition = new Ctor();
  recognition.lang = "es-PY";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let stopped = false;

  recognition.onresult = (event: unknown) => {
    const e = event as {
      results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
    };
    let interim = "";
    for (let i = 0; i < e.results.length; i += 1) {
      const res = e.results[i];
      if (res.isFinal) {
        callbacks.onFinal?.(res[0].transcript.trim());
        return;
      }
      interim += res[0].transcript;
    }
    if (interim.trim()) callbacks.onInterim?.(interim.trim());
  };
  recognition.onerror = (event: unknown) => {
    const e = event as { error?: string };
    if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
      callbacks.onError?.("Micrófono bloqueado por el navegador. Revisá los permisos del sitio.");
    } else if (e?.error === "no-speech") {
      callbacks.onError?.("No se detectó voz. Probá de nuevo más cerca del micrófono.");
    } else {
      callbacks.onError?.("Falló el reconocimiento de voz. Escribí el mensaje.");
    }
  };
  recognition.onend = () => {
    if (!stopped) callbacks.onEnd?.();
  };
  try {
    recognition.start();
  } catch {
    callbacks.onError?.("No se pudo iniciar el reconocimiento de voz.");
    callbacks.onEnd?.();
  }
  return () => {
    stopped = true;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // noop: el stream ya terminó
      }
    }
  };
}
