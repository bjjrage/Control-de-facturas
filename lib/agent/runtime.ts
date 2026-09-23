// lib/agent/runtime.ts
// Persistent Agent Runtime — CRUD para agent_tasks / agent_runs / agent_steps.
// Server-only. Usa Supabase (service_role / server client scoping por empresa_id).
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateTaskTransition } from "./task-states";
import { sanitizeAgentError } from "./sanitize";

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING_EXTERNAL"
  | "WAITING_APPROVAL"
  | "SCHEDULED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type StepStatus = "SUCCESS" | "ERROR" | "WAITING_APPROVAL" | "SKIPPED";

export interface AgentTaskRow {
  id: string;
  empresa_id: string;
  user_id: string | null;
  project_id: string | null;
  type: string;
  status: TaskStatus;
  context_json: Record<string, unknown>;
  idempotency_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AgentRunRow {
  id: string;
  task_id: string;
  empresa_id: string;
  session_id: string | null;
  model: string | null;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  usage_json: Record<string, unknown> | null;
}

export interface AgentStepRow {
  id: string;
  task_id: string;
  run_id: string;
  empresa_id: string;
  tool_name: string | null;
  input_json: unknown;
  output_json: unknown;
  status: StepStatus;
  error_message: string | null;
  idempotency_key: string | null;
  duration_ms: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(params: {
  db: SupabaseClient;
  empresaId: string;
  userId?: string | null;
  projectId?: string | null;
  type?: string;
  status?: TaskStatus;
  contextJson?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): Promise<AgentTaskRow> {
  // Idempotencia: si existe task con misma empresa+key, devolver existente (no crear duplicado)
  if (params.idempotencyKey) {
    const { data: existing } = await params.db
      .from("agent_tasks")
      .select("*")
      .eq("empresa_id", params.empresaId)
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();
    if (existing) return existing as AgentTaskRow;
  }

  const { data, error } = await params.db
    .from("agent_tasks")
    .insert({
      empresa_id: params.empresaId,
      user_id: params.userId ?? null,
      project_id: params.projectId ?? null,
      type: params.type ?? "USER_INTENT",
      status: params.status ?? "PENDING",
      context_json: (params.contextJson ?? {}) as never,
      idempotency_key: params.idempotencyKey ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createTask fallo: ${error?.message ?? "sin data"}`);
  return data as AgentTaskRow;
}

export async function getTask(db: SupabaseClient, taskId: string): Promise<AgentTaskRow | null> {
  const { data, error } = await db.from("agent_tasks").select("*").eq("id", taskId).single();
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") return null;
    throw new Error(`getTask fallo: ${error.message}`);
  }
  return data as AgentTaskRow;
}

export async function listTasksForEmpresa(
  db: SupabaseClient,
  empresaId: string,
  opts?: { status?: TaskStatus; limit?: number }
): Promise<AgentTaskRow[]> {
  let q = db.from("agent_tasks").select("*").eq("empresa_id", empresaId).order("created_at", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(`listTasksForEmpresa fallo: ${error.message}`);
  return (data ?? []) as AgentTaskRow[];
}

export async function updateTaskStatus(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId?: string; // si se pasa, se usa para scoping extra
  status: TaskStatus;
  errorMessage?: string | null;
  completedAt?: string | null;
  actorType?: "user" | "agent" | "system" | "worker";
  actorRole?: string | null;
}): Promise<AgentTaskRow> {
  const { data: current, error: currentError } = await params.db
    .from("agent_tasks")
    .select("status")
    .eq("id", params.taskId)
    .single();
  if (currentError || !current) {
    throw new Error(`updateTaskStatus: no se pudo leer task actual: ${currentError?.message ?? "sin data"}`);
  }
  validateTaskTransition({
    currentStatus: (current as { status: TaskStatus }).status,
    newStatus: params.status,
    actorType: params.actorType ?? "system",
    actorRole: params.actorRole ?? null,
  });
  const patch: Record<string, unknown> = { status: params.status };
  if (params.errorMessage !== undefined) patch.error_message = params.errorMessage ? sanitizeAgentError(params.errorMessage) : params.errorMessage;
  if (params.completedAt !== undefined) patch.completed_at = params.completedAt;
  if (params.status === "COMPLETED" || params.status === "FAILED" || params.status === "CANCELLED") {
    if (!patch.completed_at) patch.completed_at = new Date().toISOString();
  }
  let q = params.db.from("agent_tasks").update(patch).eq("id", params.taskId);
  if (params.empresaId) q = q.eq("empresa_id", params.empresaId);
  const { data, error } = await q.select("*").single();
  if (error || !data) throw new Error(`updateTaskStatus fallo: ${error?.message ?? "sin data"}`);
  return data as AgentTaskRow;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function createRun(params: {
  db: SupabaseClient;
  taskId: string;
  empresaId: string;
  model?: string | null;
  sessionId?: string | null;
  status?: RunStatus;
}): Promise<AgentRunRow> {
  const { data, error } = await params.db
    .from("agent_runs")
    .insert({
      task_id: params.taskId,
      empresa_id: params.empresaId,
      model: params.model ?? null,
      session_id: params.sessionId ?? null,
      status: params.status ?? "RUNNING",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createRun fallo: ${error?.message ?? "sin data"}`);
  return data as AgentRunRow;
}

export async function finishRun(params: {
  db: SupabaseClient;
  runId: string;
  status: RunStatus;
  errorMessage?: string | null;
  usageJson?: Record<string, unknown> | null;
}): Promise<AgentRunRow> {
  const patch: Record<string, unknown> = {
    status: params.status,
    finished_at: new Date().toISOString(),
  };
  if (params.errorMessage !== undefined) patch.error_message = params.errorMessage ? sanitizeAgentError(params.errorMessage) : params.errorMessage;
  if (params.usageJson !== undefined) patch.usage_json = params.usageJson as never;
  const { data, error } = await params.db.from("agent_runs").update(patch).eq("id", params.runId).select("*").single();
  if (error || !data) throw new Error(`finishRun fallo: ${error?.message ?? "sin data"}`);
  return data as AgentRunRow;
}

// ---------------------------------------------------------------------------
// Steps (append-only observable actions; sanitized)
// ---------------------------------------------------------------------------

const MAX_JSON_BYTES = 64 * 1024; // 64KB — si el output es gigante, truncamos (no persistir blobs)

function sanitizeForPersist(value: unknown, toolName?: string | null): unknown {
  if (value === null || value === undefined) return value;
  if (toolName === "prepare_email" || toolName === "send_email") {
    return { _redacted: true, reason: "email_content" };
  }

  const redactedKeys = new Set([
    "apikey", "authorization", "token", "secret", "password", "accesstoken", "refreshtoken",
    "to", "cc", "bcc", "email", "recipientemails", "subject", "body", "bodytext", "bodyhtml",
    "objective", "revisioninstruction", "draftsnapshot", "attachments", "filename", "storagebucket",
    "storagepath", "contentsha256", "url", "signedurl", "downloadurl",
  ]);
  const redact = (item: unknown, key?: string): unknown => {
    const normalizedKey = key?.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (normalizedKey && redactedKeys.has(normalizedKey)) return "[REDACTED]";
    if (Array.isArray(item)) return item.map((child) => redact(child));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, redact(child, childKey)]));
    }
    if (typeof item === "string") return sanitizeAgentError(item, MAX_JSON_BYTES);
    return item;
  };

  const sanitized = redact(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized) ?? String(sanitized);
  } catch {
    return { _redacted: true, reason: "unserializable_value" };
  }
  if (serialized.length > MAX_JSON_BYTES) {
    return { _truncated: true, _original_bytes: serialized.length };
  }
  return sanitized;
}

export async function createStep(params: {
  db: SupabaseClient;
  taskId: string;
  runId: string;
  empresaId: string;
  toolName?: string | null;
  input?: unknown;
  output?: unknown;
  status?: StepStatus;
  errorMessage?: string | null;
  idempotencyKey?: string | null;
  durationMs?: number | null;
}): Promise<AgentStepRow> {
  // Idempotencia tool-level: si key+tool existe para esta empresa, devolver existente
  if (params.idempotencyKey && params.toolName) {
    const { data: existing } = await params.db
      .from("agent_steps")
      .select("*")
      .eq("empresa_id", params.empresaId)
      .eq("tool_name", params.toolName)
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();
    // Un ERROR no consume la key: el retry debe poder registrar SUCCESS.
    // Un WAITING_APPROVAL tampoco bloquea el step SUCCESS posterior.
    if (existing && (existing as AgentStepRow).status === "SUCCESS") return existing as AgentStepRow;
  }

  const { data, error } = await params.db
    .from("agent_steps")
    .insert({
      task_id: params.taskId,
      run_id: params.runId,
      empresa_id: params.empresaId,
      tool_name: params.toolName ?? null,
      input_json: sanitizeForPersist(params.input, params.toolName) as never,
      output_json: sanitizeForPersist(params.output, params.toolName) as never,
      status: params.status ?? "SUCCESS",
      error_message: params.errorMessage ? sanitizeAgentError(params.errorMessage) : null,
      idempotency_key: params.idempotencyKey ?? null,
      duration_ms: params.durationMs ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`createStep fallo: ${error?.message ?? "sin data"}`);
  return data as AgentStepRow;
}

export async function listStepsForRun(db: SupabaseClient, runId: string): Promise<AgentStepRow[]> {
  const { data, error } = await db.from("agent_steps").select("*").eq("run_id", runId).order("created_at", { ascending: true });
  if (error) throw new Error(`listStepsForRun fallo: ${error.message}`);
  return (data ?? []) as AgentStepRow[];
}

export async function listStepsForTask(db: SupabaseClient, taskId: string): Promise<AgentStepRow[]> {
  const { data, error } = await db.from("agent_steps").select("*").eq("task_id", taskId).order("created_at", { ascending: true });
  if (error) throw new Error(`listStepsForTask fallo: ${error.message}`);
  return (data ?? []) as AgentStepRow[];
}
