// lib/agent/context.ts
// Context Provider — construye el contexto confiable del actor.
// Nunca confia en `empresa_id` enviado por el LLM. El tenant efectivo
// viene siempre del servidor: perfil autenticado, task persistido, o
// tarea de sistema/worker.
//
// Este modulo NO importa `next/headers` ni `createClient` para poder usarse
// tambien desde worker/event-driven donde no hay request. El caller es quien
// resuelve el perfil y luego llama a los builders de aca.
import type { UserRole } from "@/lib/types";
import type { CurrentProfile } from "@/lib/auth";

export type ActorType = "user" | "agent" | "system";
export type ActorSource = "web" | "worker" | "api" | "event" | "cron" | "test";

export interface AgentActorContext {
  empresaId: string;
  userId: string | null;
  role: UserRole | null;
  actorType: ActorType;
  source: ActorSource;
  email?: string | null;
}

export interface AgentWorkspaceContext {
  route?: string | null;
  projectId?: string | null;
  module?: string | null;
  currentEntity?: { type: string; id: string } | null;
  spreadsheet?: {
    workbookId?: string | null;
    sheetId?: string | null;
    selection?: string | null;
    selectedRows?: string[];
  } | null;
  document?: {
    documentId?: string | null;
  } | null;
}

export interface AgentToolContext extends AgentActorContext {
  // Identificadores del runtime persistente (opcional, solo si hay task/run)
  taskId?: string | null;
  runId?: string | null;
  // Project ID directo (para compatibilidad con withRuntime y tests)
  projectId?: string | null;
  // Contexto operativo del workspace (opcional, enriquecido por el frontend)
  workspace?: AgentWorkspaceContext | null;
}

/**
 * Builder para requests web normales. Usar junto a `requireProfile()` / `getCurrentProfile()`.
 * Valida que el perfil tenga empresa_id; si no, tira (fail-closed).
 */
export function actorFromProfile(
  profile: CurrentProfile,
  opts?: { source?: ActorSource; actorType?: ActorType }
): AgentActorContext {
  if (!profile.empresa_id) {
    throw new Error("actorFromProfile: profile sin empresa_id");
  }
  return {
    empresaId: profile.empresa_id,
    userId: profile.id,
    role: profile.role,
    actorType: opts?.actorType ?? "user",
    source: opts?.source ?? "web",
    email: profile.email ?? null,
  };
}

/**
 * Builder para worker / cron / evento. Requiere empresa_id explicito
 * (no hay sesion). userId puede ser null (system) o el usuario que origino la tarea.
 */
export function actorForSystem(opts: {
  empresaId: string;
  userId?: string | null;
  role?: UserRole | null;
  source?: ActorSource;
}): AgentActorContext {
  if (!opts.empresaId) throw new Error("actorForSystem: empresaId requerido");
  return {
    empresaId: opts.empresaId,
    userId: opts.userId ?? null,
    role: opts.role ?? null,
    actorType: "system",
    source: opts.source ?? "worker",
  };
}

export function actorForAgent(opts: {
  empresaId: string;
  userId: string | null;
  role?: UserRole | null;
  source?: ActorSource;
}): AgentActorContext {
  if (!opts.empresaId) throw new Error("actorForAgent: empresaId requerido");
  return {
    empresaId: opts.empresaId,
    userId: opts.userId,
    role: opts.role ?? null,
    actorType: "agent",
    source: opts.source ?? "web",
  };
}

/**
 * Enriquecimiento con task/run context (para gateway y handlers).
 */
export function withRuntime(
  actor: AgentActorContext,
  runtime: { taskId?: string | null; runId?: string | null; projectId?: string | null }
): AgentToolContext {
  return {
    ...actor,
    taskId: runtime.taskId ?? null,
    runId: runtime.runId ?? null,
    projectId: runtime.projectId ?? null,
    workspace: null,
  };
}

/**
 * Enriquecimiento con workspace context (proyecto actual, spreadsheet, documento, selección).
 * El frontend envía esto via headers o body; el server lo valida contra tenant/project.
 */
export function withWorkspace(
  actor: AgentActorContext,
  workspace: AgentWorkspaceContext | null
): AgentToolContext {
  return {
    ...actor,
    workspace,
  };
}

/**
 * Guard: valida que el contexto tenga empresa_id no vacio.
 */
export function assertActorHasTenant(actor: AgentActorContext): void {
  if (!actor.empresaId || typeof actor.empresaId !== "string" || actor.empresaId.trim() === "") {
    throw new Error("AgentActorContext sin empresaId — se rechazo por fail-closed");
  }
}
