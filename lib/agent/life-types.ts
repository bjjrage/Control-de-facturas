// lib/agent/life-types.ts
// BATCH 6 — Tipos durables. Espejan supabase/migrations/0089_*.

export type TaskWaitKind = "EVENT" | "TIMER" | "APPROVAL";
export type TaskWaitStatus = "WAITING" | "CLAIMED" | "SATISFIED" | "CANCELLED" | "EXPIRED";

export interface AgentTaskWaitRow {
  id: string;
  task_id: string;
  run_id: string | null;
  empresa_id: string;
  kind: TaskWaitKind;
  event_type: string | null;
  correlation_key: string | null;
  wake_at: string | null;
  payload_json: Record<string, unknown>;
  status: TaskWaitStatus;
  satisfied_by_event_id: string | null;
  satisfied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentEventRow {
  id: string;
  empresa_id: string;
  event_type: string;
  source_type: string;
  source_id: string | null;
  correlation_key: string;
  dedup_key: string | null;
  payload_json: Record<string, unknown>;
  occurred_at: string;
  processed_at: string | null;
  processor_id: string | null;
  created_at: string;
}

export type TaskRetryStatus = "PENDING" | "SCHEDULED" | "EXECUTING" | "EXHAUSTED" | "RESOLVED" | "CANCELLED";

export interface AgentTaskRetryRow {
  id: string;
  task_id: string;
  run_id: string | null;
  empresa_id: string;
  attempt_number: number;
  max_attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  next_retry_at: string | null;
  backoff_base_ms: number;
  backoff_max_ms: number;
  backoff_multiplier: number;
  status: TaskRetryStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentTaskLeaseRow {
  id: string;
  task_id: string;
  empresa_id: string;
  holder_id: string;
  holder_type: string;
  acquired_at: string;
  expires_at: string;
  renewed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
