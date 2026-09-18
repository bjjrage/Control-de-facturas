"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  Send,
  Sparkles,
} from "lucide-react";
import { decideApprovalAction } from "@/app/(internal)/agent/approval-actions";
import { getRodrigoStatePresentation, type RodrigoState } from "@/lib/agent/rodrigo-state";
import { isSttSupported, startDictation, type SttHandle } from "@/lib/voice/stt-client";
import { useRodrigoAgent } from "./rodrigo-agent-provider";
import styles from "./rodrigo-agent-widget.module.css";

// Three.js solo en cliente y solo cuando el widget existe (lazy, sin SSR).
const Rodrigo3DMascot = dynamic(
  () => import("./rodrigo-3d-mascot").then((m) => m.Rodrigo3DMascot),
  {
    ssr: false,
    loading: () => (
      <span className="flex h-full w-full items-center justify-center" aria-hidden="true">
        <Sparkles size={26} className="text-[var(--primary)]" />
      </span>
    ),
  }
);

function StateGlyph({ state }: { state: RodrigoState }) {
  if (state === "thinking" || state === "working") {
    return <Loader2 aria-hidden="true" size={14} className="animate-spin" />;
  }
  if (state === "approval" || state === "error") {
    return <AlertTriangle aria-hidden="true" size={14} />;
  }
  if (state === "success") {
    return <CheckCircle2 aria-hidden="true" size={14} />;
  }
  if (state === "listening") {
    return <Mic aria-hidden="true" size={14} />;
  }
  if (state === "disabled") {
    return <MicOff aria-hidden="true" size={14} />;
  }
  return <Sparkles aria-hidden="true" size={14} />;
}

// Waveform real: 14 barras cuya altura escribe directo el nivel RMS del
// micrófono (vía ref, sin re-renders). Memoizado para que el timer (500ms)
// no las resetee. Sin volumen no hay movimiento (nada fake).
const VoiceWaveform = memo(function VoiceWaveform({
  barsRef,
}: {
  barsRef: React.MutableRefObject<Array<HTMLSpanElement | null>>;
}) {
  return (
    <span aria-hidden="true" className="flex h-5 items-end gap-[3px]">
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="w-[3px] origin-bottom rounded-full bg-[var(--primary)]"
          style={{ height: "100%", transform: "scaleY(0.12)" }}
        />
      ))}
    </span>
  );
});

function formatVoiceElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function RodrigoAgentWidget() {
  const {
    state,
    status,
    isOpen,
    open,
    minimize,
    refreshStatus,
    setVisualState,
    registerMicrophoneStop,
    messages,
    sending,
    sendMessage,
  } = useRodrigoAgent();
  const stopSttRef = useRef<SttHandle | null>(null);
  const isOpenRef = useRef(isOpen);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  // Máquina de estados de voz (única fuente para la UI del micrófono; evita
  // booleanos descoordinados). sending (chat) lo aporta el provider.
  const [voice, setVoice] = useState<"idle" | "requesting" | "listening" | "transcribing">("idle");
  const [vad, setVad] = useState<"waiting" | "speech">("waiting");
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const WAVE_TAPER = useRef([
    0.45, 0.6, 0.78, 0.92, 1, 1, 0.95, 0.88, 0.95, 1, 1, 0.92, 0.78, 0.6,
  ]);
  const [draft, setDraft] = useState("");
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const presentation = state === status.state ? status : getRodrigoStatePresentation(state);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const stopMicrophone = useCallback(() => {
    const handle = stopSttRef.current;
    stopSttRef.current = null;
    try {
      // Cancelar (minimizar/desmontar/runtime caído): aborta sin transcribir
      // ni enviar; cierra recorder, AudioContext, rAF, timers y tracks.
      handle?.cancel();
    } catch {
      // Un stream ya cerrado no debe impedir que el panel se cierre.
    }
    setVoice("idle");
    setVad("waiting");
    setVisualState(null);
  }, [setVisualState]);

  useEffect(() => {
    const unregister = registerMicrophoneStop(stopMicrophone);
    return () => {
      unregister();
      stopMicrophone();
    };
  }, [registerMicrophoneStop, stopMicrophone]);

  useEffect(() => {
    // Si el runtime se cae con el micrófono abierto, no dejar captura oculta.
    if (state !== "disabled" || voice === "idle") return;
    const stopTimer = window.setTimeout(stopMicrophone, 0);
    return () => window.clearTimeout(stopTimer);
  }, [voice, state, stopMicrophone]);

  useEffect(() => {
    // Cronómetro de grabación (solo display, 500ms).
    if (voice !== "listening") return;
    const startedAt = Date.now();
    setVoiceElapsedMs(0);
    const id = window.setInterval(() => setVoiceElapsedMs(Date.now() - startedAt), 500);
    return () => window.clearInterval(id);
  }, [voice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) minimize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, minimize]);

  useEffect(() => {
    // Mantener visible el último mensaje (transcript + respuesta escrita).
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, isOpen]);

  const toggleMicrophone = useCallback(() => {
    // Una sola sesión a la vez: la máquina voice impide reentradas
    // (doble click, auto-stop + click simultáneo) por construcción.
    if (voice !== "idle") {
      if (voice !== "listening") return;
      // Apagar manual (fallback): stop() → transcribe → onFinal/onError.
      // El VAD auto-stop usa exactamente la misma vía (idempotente en cliente).
      const handle = stopSttRef.current;
      try {
        handle?.stop();
      } catch {
        setVoice("idle");
        setVisualState(null);
        return;
      }
      setVoice("transcribing");
      setVisualState("thinking");
      return;
    }
    if (state === "disabled" || sending) return;
    if (!isSttSupported()) {
      setMicrophoneError("Tu navegador no permite grabar audio desde esta página. Escribí el mensaje.");
      setVisualState("error", { resetAfterMs: 5_000 });
      return;
    }
    setMicrophoneError(null);
    setVad("waiting");
    setVoice("requesting");
    const handle = startDictation({
      onInterim: (text) => setDraft(text),
      onStarted: () => {
        setVoice("listening");
        setVad("waiting");
        setVisualState("listening");
      },
      onSpeechStart: () => {
        setVad("speech");
      },
      onLevel: (level) => {
        const taper = WAVE_TAPER.current;
        const bars = barsRef.current;
        for (let i = 0; i < bars.length; i += 1) {
          const el = bars[i];
          if (!el) continue;
          const h = 0.12 + Math.min(1, Math.max(0, level)) * (taper[i] ?? 1) * 0.88;
          el.style.transform = `scaleY(${h.toFixed(3)})`;
        }
      },
      onTranscribing: () => {
        setVoice("transcribing");
        setVisualState("thinking");
      },
      onFinal: (text) => {
        setDraft("");
        setVoice("idle");
        setVad("waiting");
        stopSttRef.current = null;
        setVisualState(null);
        if (text && isOpenRef.current) void sendMessage(text);
      },
      onError: (message) => {
        if (!isOpenRef.current) return;
        setMicrophoneError(message);
        setVoice("idle");
        setVad("waiting");
        setVisualState("error", { resetAfterMs: 5_000 });
      },
      onEnd: () => {
        stopSttRef.current = null;
        setVoice("idle");
        setVad("waiting");
        setVisualState(null);
      },
    });
    stopSttRef.current = handle;
  }, [voice, sending, sendMessage, setVisualState, state]);

  const cancelRecording = useCallback(() => {
    // Cancelar: aborta sin transcribir ni enviar (el onEnd del cliente resetea).
    try {
      stopSttRef.current?.cancel();
    } catch {
      setVoice("idle");
      setVad("waiting");
      setVisualState(null);
    }
  }, [setVisualState]);

  const submitDraft = useCallback(() => {
    if (!draft.trim() || sending || state === "disabled") return;
    const text = draft;
    setDraft("");
    void sendMessage(text);
  }, [draft, sending, sendMessage, state]);

  const decideApproval = useCallback(
    async (approvalId: string, decision: "APPROVED" | "REJECTED") => {
      setApprovalBusyId(approvalId);
      setApprovalError(null);
      try {
        await decideApprovalAction({ approvalId, decision });
        await refreshStatus();
      } catch {
        setApprovalError("No se pudo registrar la decisión. Probá desde el Activity Center.");
      } finally {
        setApprovalBusyId(null);
      }
    },
    [refreshStatus]
  );

  function handleMascotClick() {
    if (isOpen) minimize();
    else open();
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-5 sm:right-5 ${styles.widget} ${styles[`state-${state}`]}`}
      data-state={state}
    >
      {isOpen ? (
        <section
          id="rodrigo-agent-panel"
          aria-label="Panel del agente Rodrigo"
          className={`flex max-h-[min(34rem,calc(100vh-8rem))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl ${styles.panel}`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-[var(--panel-2)]">
                <Rodrigo3DMascot state={state} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Rodrigo</p>
                <p className="text-[11px] text-[var(--muted)]">Asistente Frictionless</p>
              </div>
            </div>
            <button
              type="button"
              onClick={minimize}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              aria-label="Minimizar panel de Rodrigo"
              title="Minimizar"
            >
              <ChevronDown aria-hidden="true" size={17} />
            </button>
          </div>

          <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${styles.stateIcon}`}>
                <StateGlyph state={state} />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold" aria-live="polite">
                  {presentation.label}
                </p>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--muted)]">{presentation.description}</p>
              </div>
            </div>

            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[92%] rounded-xl px-3 py-2 text-[12px] leading-5 ${
                  m.role === "user"
                    ? "ml-auto bg-[var(--primary-bg)] text-[var(--foreground)]"
                    : "border border-[var(--border)] bg-[var(--panel-2)]"
                }`}
              >
                {m.text}
              </div>
            ))}

            {status.pendingApprovals.length > 0 ? (
              <div className="rounded-xl border border-[var(--warn)] bg-transparent p-3">
                <p className="text-[12px] font-semibold">Aprobaciones pendientes ({status.pendingApprovals.length})</p>
                <ul className="mt-2 space-y-2">
                  {status.pendingApprovals.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate" title={a.id}>
                        {a.toolName}
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          disabled={approvalBusyId === a.id}
                          onClick={() => void decideApproval(a.id, "APPROVED")}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--hover)] disabled:opacity-50"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={approvalBusyId === a.id}
                          onClick={() => void decideApproval(a.id, "REJECTED")}
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--hover)] disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {approvalError ? <p className="mt-2 text-[11px] text-[var(--error)]">{approvalError}</p> : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMicrophone}
                  disabled={state === "disabled" || sending || voice === "requesting" || voice === "transcribing"}
                  aria-pressed={voice === "listening"}
                  aria-label={
                    voice === "transcribing"
                      ? "Transcribiendo audio"
                      : voice === "listening"
                        ? "Apagar micrófono y transcribir"
                        : "Activar micrófono"
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-3 text-[12px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--hover)] disabled:opacity-50"
                >
                  {voice === "listening" ? <MicOff aria-hidden="true" size={15} /> : <Mic aria-hidden="true" size={15} />}
                  {voice === "transcribing"
                    ? "Transcribiendo…"
                    : voice === "listening"
                      ? "Apagar micrófono"
                      : "Activar micrófono"}
                </button>
                {voice === "listening" ? (
                  <button
                    type="button"
                    onClick={cancelRecording}
                    className="inline-flex h-9 items-center rounded-lg px-2 text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                  >
                    Cancelar
                  </button>
                ) : null}
              </span>
              <Link
                href="/agent/activity"
                onClick={() => void refreshStatus()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-[var(--primary-hover)] transition-colors hover:bg-[var(--primary-bg)]"
              >
                <Activity aria-hidden="true" size={15} />
                Actividad{status.activeTaskCount > 0 ? ` (${status.activeTaskCount})` : ""}
              </Link>
            </div>

            {microphoneError ? <p className="text-[11px] leading-4 text-[var(--error)]">{microphoneError}</p> : null}
          </div>

          {voice === "listening" ? (
            <div
              className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2"
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              <span className="text-[12px] font-medium">
                {vad === "speech" ? "Te escucho…" : "Escuchando…"}
              </span>
              <span className="text-[11px] tabular-nums text-[var(--muted)]">
                {formatVoiceElapsed(voiceElapsedMs)}
              </span>
              <span className="ml-auto">
                <VoiceWaveform barsRef={barsRef} />
              </span>
            </div>
          ) : null}

          <form
            className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              submitDraft();
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={state === "disabled" ? "Agente no disponible" : "Escribile a Rodrigo…"}
              disabled={sending || state === "disabled"}
              aria-label="Mensaje para Rodrigo"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 text-[12px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending || state === "disabled"}
              aria-label="Enviar mensaje"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <Send aria-hidden="true" size={15} />}
            </button>
          </form>

          <div className="border-t border-[var(--border)] px-4 py-2.5 text-[11px] leading-4 text-[var(--muted)]">
            Al minimizar, el micrófono se apaga. Las tareas del agente siguen ejecutándose en segundo plano.
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={handleMascotClick}
        aria-expanded={isOpen}
        aria-controls="rodrigo-agent-panel"
        aria-label={isOpen ? "Minimizar el panel de Rodrigo" : "Abrir el panel de Rodrigo"}
        title={isOpen ? "Minimizar Rodrigo" : "Abrir Rodrigo"}
        className={`relative flex h-[76px] w-[76px] items-end justify-center overflow-visible rounded-full border border-white/10 bg-[var(--panel)] shadow-xl transition-transform duration-200 hover:scale-[1.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:h-[84px] sm:w-[84px] ${styles.mascotButton}`}
      >
        <span className="sr-only">{presentation.label}</span>
        <span className={`absolute inset-0 ${styles.mascot}`}>
          <Rodrigo3DMascot state={state} />
        </span>
        {state === "approval" || status.pendingApprovals.length > 0 ? (
          <span className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[var(--panel)] bg-[var(--warn)] px-1 text-[10px] font-bold text-[#2b1d00] ${styles.approvalBadge}`}>
            {status.pendingApprovals.length > 0 ? status.pendingApprovals.length : "!"}
          </span>
        ) : null}
        {state === "error" ? (
          <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-[var(--panel)] bg-[var(--error)]" />
        ) : null}
        {state === "success" ? (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--panel)] bg-[var(--ok)] text-[#052015]">
            <CheckCircle2 aria-hidden="true" size={12} />
          </span>
        ) : null}
      </button>
    </div>
  );
}
