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
  MailPlus,
  Mic,
  MicOff,
  Send,
  Sparkles,
} from "lucide-react";
import { decideApprovalAction } from "@/app/(internal)/agent/approval-actions";
import { getRodrigoStatePresentation, type RodrigoState } from "@/lib/agent/rodrigo-state";
import { isSttSupported, startDictation, type SttHandle } from "@/lib/voice/stt-client";
import { useRodrigoAgent } from "./rodrigo-agent-provider";
import { EmailPreviewCard } from "./email-preview-card";
import styles from "./rodrigo-agent-widget.module.css";

type GmailConnectionState = {
  status: "loading" | "connected" | "disconnected";
  email: string | null;
};

function truncateEmailAddress(email: string) {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email.slice(0, Math.min(at, 7))}@…`;
}

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
    emailPreview,
    setEmailPreview,
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
  const [composerOpen, setComposerOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [gmail, setGmail] = useState<GmailConnectionState>({ status: "loading", email: null });
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const MASCOT_SIZE = 84;
  const VIEWPORT_MARGIN = 12;
  const [mascotPosition, setMascotPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressMascotClickRef = useRef(false);

  const presentation = state === status.state ? status : getRodrigoStatePresentation(state);

  useEffect(() => {
    const saved = window.localStorage.getItem("rodrigo-mascot-position");
    let initial: { x: number; y: number } | null = null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { x?: number; y?: number };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          initial = { x: parsed.x, y: parsed.y };
        }
      } catch {
        // Posición corrupta: volvemos al default.
      }
    }
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - MASCOT_SIZE - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - MASCOT_SIZE - VIEWPORT_MARGIN);
    // Initialize persisted viewport-relative placement after the browser is available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMascotPosition({
      x: Math.min(maxX, Math.max(VIEWPORT_MARGIN, initial?.x ?? maxX)),
      y: Math.min(maxY, Math.max(VIEWPORT_MARGIN, initial?.y ?? maxY)),
    });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setMascotPosition((current) => {
        if (!current) return current;
        const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - MASCOT_SIZE - VIEWPORT_MARGIN);
        const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - MASCOT_SIZE - VIEWPORT_MARGIN);
        return {
          x: Math.min(maxX, Math.max(VIEWPORT_MARGIN, current.x)),
          y: Math.min(maxY, Math.max(VIEWPORT_MARGIN, current.y)),
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void fetch("/api/integrations/gmail/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ connection?: { status?: unknown; providerEmail?: unknown } | null }>;
      })
      .then((payload) => {
        if (!active) return;
        const connection = payload?.connection;
        const connected = connection?.status === "CONNECTED";
        setGmail({
          status: connected ? "connected" : "disconnected",
          email: connected && typeof connection?.providerEmail === "string" ? connection.providerEmail : null,
        });
      })
      .catch(() => {
        if (active) setGmail({ status: "disconnected", email: null });
      });
    return () => {
      active = false;
    };
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
        setVoiceElapsedMs(0);
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

  const prepareEmailFromComposer = useCallback(() => {
    const recipient = emailTo.trim();
    const body = emailBody.trim();
    if (!recipient) {
      setComposerError("Indicá a quién va dirigido el correo.");
      return;
    }
    if (!body) {
      setComposerError("Escribí qué querés comunicar.");
      return;
    }
    setComposerError(null);
    const subject = emailSubject.trim();
    const request = [
      `Prepará un correo para ${recipient}.`,
      subject ? `Asunto: ${subject}.` : "",
      `Mensaje: ${body}`,
    ].filter(Boolean).join(" ");
    setComposerOpen(false);
    void sendMessage(request);
  }, [emailBody, emailSubject, emailTo, sendMessage]);

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
    if (suppressMascotClickRef.current) {
      suppressMascotClickRef.current = false;
      return;
    }
    if (isOpen) minimize();
    else open();
  }

  function handleMascotPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!mascotPosition) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: mascotPosition.x,
      originY: mascotPosition.y,
      moved: false,
    };
  }

  function handleMascotPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;

    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - MASCOT_SIZE - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - MASCOT_SIZE - VIEWPORT_MARGIN);
    setMascotPosition({
      x: Math.min(maxX, Math.max(VIEWPORT_MARGIN, drag.originX + dx)),
      y: Math.min(maxY, Math.max(VIEWPORT_MARGIN, drag.originY + dy)),
    });
  }

  function handleMascotPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    suppressMascotClickRef.current = drag.moved;

    if (drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - MASCOT_SIZE - VIEWPORT_MARGIN);
      const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - MASCOT_SIZE - VIEWPORT_MARGIN);
      const finalPosition = {
        x: Math.min(maxX, Math.max(VIEWPORT_MARGIN, drag.originX + dx)),
        y: Math.min(maxY, Math.max(VIEWPORT_MARGIN, drag.originY + dy)),
      };
      setMascotPosition(finalPosition);
      window.localStorage.setItem("rodrigo-mascot-position", JSON.stringify(finalPosition));
    }
  }

  return (
    <div
      className={`fixed z-40 h-[84px] w-[84px] ${styles.widget} ${styles[`state-${state}`]}`}
      data-state={state}
      style={
        mascotPosition
          ? { left: mascotPosition.x, top: mascotPosition.y }
          : { right: VIEWPORT_MARGIN, bottom: VIEWPORT_MARGIN }
      }
    >
      {isOpen ? (
        <section
          id="rodrigo-agent-panel"
          aria-label="Panel del agente Rodrigo"
          className={`absolute flex max-h-[min(34rem,calc(100vh-2rem))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl ${styles.panel}`}
          style={{
            ...(mascotPosition && mascotPosition.x < 360
              ? { left: 0 }
              : { right: 0 }),
            ...(mascotPosition && mascotPosition.y < 420
              ? { top: "calc(100% + 8px)" }
              : { bottom: "calc(100% + 8px)" }),
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-[var(--panel-2)]">
                <Rodrigo3DMascot state={state} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">Rodrigo</p>
                <p className="text-[11px] text-[var(--muted)]">
                  {gmail.status === "connected"
                    ? `Gmail conectado · ${gmail.email ? truncateEmailAddress(gmail.email) : "cuenta conectada"}`
                    : gmail.status === "disconnected"
                      ? "Gmail no conectado"
                      : "Verificando Gmail…"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setComposerError(null);
                  setComposerOpen((current) => !current);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--primary-hover)] transition-colors hover:bg-[var(--primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                aria-label="Redactar correo"
                title="Redactar correo"
              >
                <MailPlus aria-hidden="true" size={17} />
              </button>
              <button
                type="button"
                onClick={minimize}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                aria-label="Minimizar panel de Rodrigo"
                title="Minimizar"
              >
                <ChevronDown aria-hidden="true" size={17} />
              </button>
            </div>
          </div>

          <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {composerOpen ? (
              <section className="space-y-3 rounded-xl border border-[var(--primary)] bg-[var(--panel-2)] p-3" aria-label="Redactar correo">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold">Redactar correo</p>
                    <p className="text-[11px] text-[var(--muted)]">Prepará el borrador y revisalo antes de enviarlo.</p>
                  </div>
                  {gmail.status === "disconnected" ? (
                    <Link href="/configuracion" className="text-[11px] font-medium text-[var(--primary-hover)] underline underline-offset-2">
                      Configurar Gmail
                    </Link>
                  ) : null}
                </div>
                <label className="block text-[11px] font-medium">
                  Para
                  <input
                    value={emailTo}
                    onChange={(event) => setEmailTo(event.target.value)}
                    placeholder="nombre o correo@dominio.com"
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-[12px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                  />
                </label>
                <label className="block text-[11px] font-medium">
                  Asunto <span className="font-normal text-[var(--muted)]">(opcional)</span>
                  <input
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                    placeholder="Asunto del correo"
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-[12px] outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                  />
                </label>
                <label className="block text-[11px] font-medium">
                  Mensaje
                  <textarea
                    value={emailBody}
                    onChange={(event) => setEmailBody(event.target.value)}
                    placeholder="¿Qué querés comunicar?"
                    rows={4}
                    className="mt-1 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[12px] leading-5 outline-none placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
                  />
                </label>
                {composerError ? <p className="text-[11px] text-[var(--error)]">{composerError}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setComposerOpen(false)} className="rounded-lg px-3 py-2 text-[12px] font-medium text-[var(--muted)] hover:bg-[var(--hover)]">
                    Cancelar
                  </button>
                  <button type="button" onClick={prepareEmailFromComposer} disabled={sending} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                    Preparar vista previa
                  </button>
                </div>
              </section>
            ) : null}
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

            {emailPreview && !status.pendingApprovals.some((approval) => approval.emailPreview?.draftId === emailPreview.draftId) ? (
              <EmailPreviewCard
                preview={emailPreview}
                onCompleted={() => {
                  setEmailPreview(null);
                  setVisualState("success", { resetAfterMs: 8_000 });
                  void refreshStatus();
                }}
                onCancelled={() => {
                  setEmailPreview(null);
                  void refreshStatus();
                }}
                onEdit={() => {
                  setDraft("hacelo más corto");
                  inputRef.current?.focus();
                }}
              />
            ) : null}

            {status.pendingApprovals.length > 0 ? (
              <div className="rounded-xl border border-[var(--warn)] bg-transparent p-3">
                <p className="text-[12px] font-semibold">Aprobaciones pendientes ({status.pendingApprovals.length})</p>
                <ul className="mt-2 space-y-2">
                  {status.pendingApprovals.map((a) => (
                    a.toolName === "send_email" && a.emailPreview ? (
                      <li key={a.id}>
                        <EmailPreviewCard
                          preview={a.emailPreview}
                          approvalId={a.id}
                          onCompleted={() => {
                            setEmailPreview(null);
                            setVisualState("success", { resetAfterMs: 8_000 });
                            void refreshStatus();
                          }}
                          onCancelled={() => void refreshStatus()}
                          onEdit={() => {
                            setDraft("hacelo más corto");
                            inputRef.current?.focus();
                          }}
                        />
                      </li>
                    ) : (
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
                    )
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
        onPointerDown={handleMascotPointerDown}
        onPointerMove={handleMascotPointerMove}
        onPointerUp={handleMascotPointerUp}
        onPointerCancel={handleMascotPointerUp}
        aria-expanded={isOpen}
        aria-controls="rodrigo-agent-panel"
        aria-label={isOpen ? "Minimizar el panel de Rodrigo" : "Abrir el panel de Rodrigo"}
        title={isOpen ? "Minimizar Rodrigo" : "Abrir Rodrigo"}
        className={`relative flex h-[76px] w-[76px] touch-none select-none items-end justify-center overflow-visible rounded-full border border-white/10 bg-[var(--panel)] shadow-xl transition-all duration-200 hover:scale-[1.035] hover:opacity-100 active:cursor-grabbing cursor-grab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:h-[84px] sm:w-[84px] ${isOpen ? "opacity-100" : "opacity-70"} ${styles.mascotButton}`}
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
