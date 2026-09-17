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

export type RodrigoAgentStatus = {
  state: RodrigoState;
  activeTaskCount: number;
  updatedAt: string | null;
  label: string;
  description: string;
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
};

const DEFAULT_STATUS: RodrigoAgentStatus = {
  state: "idle",
  activeTaskCount: 0,
  updatedAt: null,
  label: "Listo para ayudarte",
  description: "Rodrigo está disponible para acompañarte con el trabajo del ERP.",
};

const DISABLED_STATUS: RodrigoAgentStatus = {
  state: "disabled",
  activeTaskCount: 0,
  updatedAt: null,
  label: "Agente no disponible",
  description: "El runtime del agente no está disponible en este entorno.",
};

const RodrigoAgentContext = createContext<RodrigoAgentContextValue | null>(null);

function parseStatus(value: unknown): RodrigoAgentStatus | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Record<string, unknown>;
  if (!isRodrigoState(response.state)) return null;

  return {
    state: response.state,
    activeTaskCount: typeof response.activeTaskCount === "number" ? response.activeTaskCount : 0,
    updatedAt: typeof response.updatedAt === "string" ? response.updatedAt : null,
    label: typeof response.label === "string" ? response.label : DEFAULT_STATUS.label,
    description: typeof response.description === "string" ? response.description : DEFAULT_STATUS.description,
  };
}

export function RodrigoAgentProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RodrigoAgentStatus>(DEFAULT_STATUS);
  const [isOpen, setIsOpen] = useState(false);
  const [interactionState, setInteractionState] = useState<RodrigoState | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const microphoneStopHandlersRef = useRef(new Set<MicrophoneStopHandler>());

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
    }),
    [isOpen, minimize, open, refreshStatus, registerMicrophoneStop, setVisualState, state, status]
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
