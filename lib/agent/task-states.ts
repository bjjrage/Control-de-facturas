// lib/agent/task-states.ts
// BATCH 6 — State machine canónica de agent_tasks. Pura, sin DB.
// Una sola autoridad para validar transiciones.

import type { TaskStatus } from "./runtime";

export type TaskTransitionActorType = "user" | "agent" | "system" | "worker";

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ["RUNNING", "SCHEDULED", "CANCELLED"],
  RUNNING: ["WAITING_EXTERNAL", "WAITING_APPROVAL", "SCHEDULED", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_EXTERNAL: ["RUNNING", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED"],
  SCHEDULED: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["RUNNING"],
  CANCELLED: [],
};

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ["COMPLETED", "CANCELLED"];

export const RESUMABLE_TASK_STATUSES: TaskStatus[] = [
  "WAITING_EXTERNAL",
  "WAITING_APPROVAL",
  "SCHEDULED",
  "FAILED",
];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function isResumableTaskStatus(status: TaskStatus): boolean {
  return RESUMABLE_TASK_STATUSES.includes(status);
}

export function validateTaskTransition(params: {
  currentStatus: TaskStatus;
  newStatus: TaskStatus;
  actorType: TaskTransitionActorType;
  actorRole?: string | null;
}): void {
  const { currentStatus, newStatus, actorType, actorRole } = params;
  if (currentStatus === newStatus) return;
  const allowed = TASK_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Transicion de estado invalida: ${currentStatus} -> ${newStatus} (actor: ${actorType}, role: ${actorRole ?? "none"})`
    );
  }
}
