"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isRodrigoState, type RodrigoState } from "@/lib/agent/rodrigo-state";

const STATUS_POLL_MS = 15_000;

export type RodrigoPendingApproval = {
  id: string;
  toolName: string;
  createdAt: string;
};

export type RodrigoAgentStatus = {
  state: RodrigoState;
  activeTaskCount: number;
  pendingApprovals: RodrigoPendingApproval[];
  updatedAt: string | null;
  label: string;
  description: string;
};

export type RodrigoMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type RodrigoVisualStateOptions = {
  /** Restores the durable state after short-lived visual feedback. */
  resetAfterMs?: number;
};

type MicrophoneStopHandler = () => void;

type RodrigoAgentContextValue = {
  state: RodrigoState;
  status: RodrigoAgentStatus;
  isOpen: boolean;
  open: () => void;
  minimize: () => void;
  refreshStatus: () => Promise<void>;
  setVisualState: (state: RodrigoState | null, options?: RodrigoVisualStateOptions) => void;
  registerMicrophoneStop: (handler: MicrophoneStopHandler) => () => void;
  messages: RodrigoMessage[];
  sending: boolean;
  sendMessage: (text: string) => Promise<void>;
};

const DEFAULT_STATUS: RodrigoAgentStatus = {
  state: "idle",
  activeTaskCount: 0,
  pendingApprovals: [],
  updatedAt: null,
  label: "Listo para ayudarte",
  description: "Rodrigo está disponible para acompañarte con el trabajo del ERP.",
};

const DISABLED_STATUS: RodrigoAgentStatus = {
  state: "disabled",
  activeTaskCount: 0,
  pendingApprovals: [],
  updatedAt: null,
  label: "Agente no disponible",
  description: "El runtime del agente no está disponible en este entorno.",
};

const RodrigoAgentContext = createContext<RodrigoAgentContextValue | null>(null);

function parseStatus(value: unknown): RodrigoAgentStatus | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Record<string, unknown>;
  if (!isRodrigoState(response.state)) return null;
  const rawApprovals = Array.isArray(response.pendingApprovals) ? response.pendingApprovals : [];
  const pendingApprovals: RodrigoPendingApproval[] = rawApprovals
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .filter((a) => typeof a.id === "string" && typeof a.toolName === "string")
    .map((a) => ({
      id: a.id as string,
      toolName: a.toolName as string,
      createdAt: typeof a.createdAt === "string" ? (a.createdAt as string) : "",
    }));

  return {
    state: response.state,
    activeTaskCount: typeof response.activeTaskCount === "number" ? response.activeTaskCount : 0,
    pendingApprovals,
    updatedAt: typeof response.updatedAt === "string" ? response.updatedAt : null,
    label: typeof response.label === "string" ? response.label : DEFAULT_STATUS.label,
    description: typeof response.description === "string" ? response.description : DEFAULT_STATUS.description,
  };
}

export function RodrigoAgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RodrigoAgentStatus>(DEFAULT_STATUS);
  const [isOpen, setIsOpen] = useState(false);
  const [interactionState, setInteractionState] = useState<RodrigoState | null>(null);
  const [messages, setMessages] = useState<RodrigoMessage[]>([]);
  const [sending, setSending] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const microphoneStopHandlersRef = useRef(new Set<MicrophoneStopHandler>());
  const sendingRef = useRef(false);

  const clearVisualReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/status", { cache: "no-store" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const parsed = parseStatus(await response.json());
      if (!parsed) throw new Error("invalid agent status response");
      setStatus(parsed);
    } catch {
      // The shell remains usable if the migration or runtime is unavailable.
      setStatus(DISABLED_STATUS);
    }
  }, []);

  useEffect(() => {
    // Defer the first sync to the browser task queue. Besides avoiding a
    // render-phase cascade, this lets the authenticated shell paint first.
    const initialRefresh = window.setTimeout(() => void refreshStatus(), 0);
    const interval = window.setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshStatus]);

  useEffect(() => clearVisualReset, [clearVisualReset]);

  const setVisualState = useCallback(
    (nextState: RodrigoState | null, options?: RodrigoVisualStateOptions) => {
      clearVisualReset();
      setInteractionState(nextState);

      if (nextState && options?.resetAfterMs && options.resetAfterMs > 0) {
        resetTimerRef.current = setTimeout(() => {
          setInteractionState((current) => (current === nextState ? null : current));
          resetTimerRef.current = null;
        }, options.resetAfterMs);
      }
    },
    [clearVisualReset]
  );

  const registerMicrophoneStop = useCallback((handler: MicrophoneStopHandler) => {
    microphoneStopHandlersRef.current.add(handler);
    return () => microphoneStopHandlersRef.current.delete(handler);
  }, []);

  const minimize = useCallback(() => {
    // This intentionally only ends browser microphone streams. It never
    // touches durable agent tasks, worker leases, or background execution.
    for (const stopMicrophone of microphoneStopHandlersRef.current) {
      try {
        stopMicrophone();
      } catch {
        // A stale browser stream must not prevent the panel from closing.
      }
    }
    setIsOpen(false);
    setVisualState(null);
  }, [setVisualState]);

  const open = useCallback(() => {
    setIsOpen(true);
    void refreshStatus();
  }, [refreshStatus]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      const userMessage: RodrigoMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        text: trimmed.slice(0, 2000),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev.slice(-19), userMessage]);
      setVisualState("thinking");
      try {
        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          answer?: unknown;
          state?: unknown;
        };
        const answer =
          typeof payload.answer === "string" && payload.answer.length > 0
            ? payload.answer
            : "No pude procesar el mensaje. Probá de nuevo.";
        const assistantMessage: RodrigoMessage = {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          text: answer,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev.slice(-19), assistantMessage]);
        const nextState: RodrigoState =
          payload.state === "approval"
            ? "approval"
            : response.ok
              ? "success"
              : "error";
        setVisualState(nextState, { resetAfterMs: 12_000 });
      } catch {
        setMessages((prev) => [
          ...prev.slice(-19),
          {
            id: `a-${Date.now()}-err`,
            role: "assistant",
            text: "Se cortó la conexión con el agente. Probá de nuevo.",
            createdAt: new Date().toISOString(),
          },
        ]);
        setVisualState("error", { resetAfterMs: 8_000 });
      } finally {
        sendingRef.current = false;
        setSending(false);
        void refreshStatus();
      }
    },
    [refreshStatus, setVisualState]
  );

  const state = status.state === "disabled" ? "disabled" : interactionState ?? status.state;

  const value = useMemo<RodrigoAgentContextValue>(
    () => ({
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
    }),
    [isOpen, messages, minimize, open, refreshStatus, registerMicrophoneStop, sendMessage, sending, setVisualState, state, status]
  );

  return <RodrigoAgentContext.Provider value={value}>{children}</RodrigoAgentContext.Provider>;
}

export function useRodrigoAgent(): RodrigoAgentContextValue {
  const context = useContext(RodrigoAgentContext);
  if (!context) {
    throw new Error("useRodrigoAgent must be used inside RodrigoAgentProvider");
  }
  return context;
}
