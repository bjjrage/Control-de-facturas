"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
} from "lucide-react";
import { getRodrigoStatePresentation, type RodrigoState } from "@/lib/agent/rodrigo-state";
import { useRodrigoAgent } from "./rodrigo-agent-provider";
import styles from "./rodrigo-agent-widget.module.css";

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

export function RodrigoAgentWidget({ hasUtilityRail = false }: { hasUtilityRail?: boolean }) {
  const {
    state,
    status,
    isOpen,
    open,
    minimize,
    refreshStatus,
    setVisualState,
    registerMicrophoneStop,
  } = useRodrigoAgent();
  const streamRef = useRef<MediaStream | null>(null);
  const microphoneRequestRef = useRef(0);
  const isOpenRef = useRef(isOpen);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);

  const presentation = state === status.state ? status : getRodrigoStatePresentation(state);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const stopMicrophone = useCallback(() => {
    microphoneRequestRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    setMicrophoneActive(false);
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
    // If the runtime becomes unavailable while a browser stream is open, do
    // not leave a microphone capture running behind a disabled widget.
    if (state !== "disabled" || !microphoneActive) return;
    const stopTimer = window.setTimeout(stopMicrophone, 0);
    return () => window.clearTimeout(stopTimer);
  }, [microphoneActive, state, stopMicrophone]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) minimize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, minimize]);

  const toggleMicrophone = useCallback(async () => {
    if (microphoneActive) {
      stopMicrophone();
      return;
    }
    if (state === "disabled") return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophoneError("Tu navegador no permite acceder al micrófono.");
      setVisualState("error", { resetAfterMs: 5_000 });
      return;
    }

    const requestId = microphoneRequestRef.current + 1;
    microphoneRequestRef.current = requestId;
    setMicrophoneError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // If the panel was minimized while the permission prompt was open, close
      // the stream immediately so the microphone cannot remain active hidden.
      if (microphoneRequestRef.current !== requestId || !isOpenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener("ended", stopMicrophone, { once: true });
      });
      setMicrophoneActive(true);
      setVisualState("listening");
    } catch {
      if (microphoneRequestRef.current !== requestId) return;
      setMicrophoneError("No pudimos activar el micrófono. Revisá los permisos del navegador.");
      setVisualState("error", { resetAfterMs: 5_000 });
    }
  }, [microphoneActive, setVisualState, state, stopMicrophone]);

  function handleMascotClick() {
    if (isOpen) minimize();
    else open();
  }

  return (
    <div
      className={`fixed bottom-4 z-40 flex flex-col items-end gap-2 sm:bottom-5 ${
        hasUtilityRail ? "right-4 lg:right-[210px]" : "right-4 sm:right-5"
      } ${styles.widget} ${styles[`state-${state}`]}`}
      data-state={state}
    >
      {isOpen ? (
        <section
          id="rodrigo-agent-panel"
          aria-label="Panel del agente Rodrigo"
          className={`w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl ${styles.panel}`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-[var(--panel-2)]">
                <Image
                  src="/agent/rodrigo.png"
                  alt=""
                  fill
                  sizes="40px"
                  className="object-contain object-bottom"
                />
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

          <div className="space-y-3 px-4 py-4">
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

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void toggleMicrophone()}
                disabled={state === "disabled"}
                aria-pressed={microphoneActive}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-3 text-[12px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--hover)] disabled:opacity-50"
              >
                {microphoneActive ? <MicOff aria-hidden="true" size={15} /> : <Mic aria-hidden="true" size={15} />}
                {microphoneActive ? "Apagar micrófono" : "Activar micrófono"}
              </button>
              <Link
                href="/agent/activity"
                onClick={() => void refreshStatus()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-[var(--primary-hover)] transition-colors hover:bg-[var(--primary-bg)]"
              >
                <Activity aria-hidden="true" size={15} />
                Actividad
              </Link>
            </div>

            {microphoneError ? <p className="text-[11px] leading-4 text-[var(--error)]">{microphoneError}</p> : null}
          </div>

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
        <Image
          src="/agent/rodrigo.png"
          alt="Rodrigo, asistente Frictionless"
          fill
          sizes="(max-width: 640px) 76px, 84px"
          className={`object-contain object-bottom ${styles.mascot}`}
        />
        {state === "approval" ? (
          <span className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[var(--panel)] bg-[var(--warn)] px-1 text-[10px] font-bold text-[#2b1d00] ${styles.approvalBadge}`}>
            !
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
