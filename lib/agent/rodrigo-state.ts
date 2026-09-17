// lib/agent/rodrigo-state.ts
// Estado visual canónico de Rodrigo. Este módulo es intencionalmente puro para
// poder usarse tanto en el endpoint server-side como en la interfaz client-side.
//
// Mapeo durable -> visual:
//   PENDING                                        -> thinking
//   RUNNING | WAITING_EXTERNAL | SCHEDULED        -> working
//   WAITING_APPROVAL                               -> approval
//   FAILED                                         -> error
//   COMPLETED reciente                             -> success
//   (sin tareas)                                   -> idle
// "listening" (micrófono) y "disabled" (runtime no disponible) se resuelven
// en la capa que los conoce: el provider (mic) y /api/agent/status (runtime).

export const RODRIGO_STATES = [
  "idle",
  "listening",
  "thinking",
  "working",
  "approval",
  "success",
  "error",
  "disabled",
] as const;

export type RodrigoState = (typeof RODRIGO_STATES)[number];

export type RodrigoTaskSnapshot = {
  status: string;
  updatedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
};

export type RodrigoStatePresentation = {
  label: string;
  description: string;
};

export const RODRIGO_SUCCESS_FEEDBACK_MS = 12_000;

/** Tareas que cuentan como actividad en curso (badge/conteo + working/thinking). */
const ACTIVE_TASK_STATUSES = new Set([
  "PENDING",
  "RUNNING",
  "WAITING_EXTERNAL",
  "SCHEDULED",
]);

/** Tareas que se ven como "trabajando" (PENDING se ve como "thinking"). */
const WORKING_TASK_STATUSES = new Set([
  "RUNNING",
  "WAITING_EXTERNAL",
  "SCHEDULED",
]);

const RODRIGO_STATE_PRESENTATION: Record<RodrigoState, RodrigoStatePresentation> = {
  idle: {
    label: "Listo para ayudarte",
    description: "Rodrigo está disponible para acompañarte con el trabajo del ERP.",
  },
  listening: {
    label: "Te escucho",
    description: "El micrófono está activo. Rodrigo se mantiene atento a tu indicación.",
  },
  thinking: {
    label: "Pensando",
    description: "Rodrigo está preparando una respuesta.",
  },
  working: {
    label: "Trabajando",
    description: "Hay una tarea del agente en curso. Puede continuar aunque minimices este panel.",
  },
  approval: {
    label: "Necesita tu decisión",
    description: "Hay una acción del agente que requiere aprobación humana antes de continuar.",
  },
  success: {
    label: "Tarea completada",
    description: "Rodrigo terminó una tarea recientemente.",
  },
  error: {
    label: "Requiere revisión",
    description: "Una tarea del agente necesita atención antes de poder continuar.",
  },
  disabled: {
    label: "Agente no disponible",
    description: "El runtime del agente no está disponible en este entorno.",
  },
};

function isRecent(isoDate: string | null | undefined, nowMs: number): boolean {
  if (!isoDate) return false;
  const timestamp = Date.parse(isoDate);
  return Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp <= RODRIGO_SUCCESS_FEEDBACK_MS;
}

/**
 * Traduce el runtime durable a una sola señal visual. La prioridad evita que
 * un éxito reciente esconda una aprobación o una tarea que sigue en curso.
 */
export function deriveRodrigoState(tasks: readonly RodrigoTaskSnapshot[], nowMs = Date.now()): RodrigoState {
  if (tasks.some((task) => task.status === "WAITING_APPROVAL")) return "approval";
  if (tasks.some((task) => WORKING_TASK_STATUSES.has(task.status))) return "working";
  if (tasks.some((task) => task.status === "PENDING")) return "thinking";
  if (tasks.some((task) => task.status === "FAILED")) return "error";
  if (tasks.some((task) => task.status === "COMPLETED" && isRecent(task.completedAt ?? task.updatedAt, nowMs))) {
    return "success";
  }
  return "idle";
}

export function isRodrigoState(value: unknown): value is RodrigoState {
  return typeof value === "string" && (RODRIGO_STATES as readonly string[]).includes(value);
}

export function getRodrigoStatePresentation(state: RodrigoState): RodrigoStatePresentation {
  return RODRIGO_STATE_PRESENTATION[state];
}

export function isWorkingTaskStatus(status: string): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}
