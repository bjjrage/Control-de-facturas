// lib/agent/registry.ts
// Tool Registry — definición canónica de capabilities.
// riskLevel es DATA del registry, nunca decisión del LLM.
// Server-only (no hay import client-side).
import { z } from "zod";
import type { UserRole } from "@/lib/types";
import type { AgentToolContext } from "./context";

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** JSON schema visible para el LLM (derivado de Zod) — el prompt lo usa. */
  inputSchema: z.ZodType<TInput>;
  /** Nivel de riesgo (0 READ ... 4 MONEY). Fijado por ERP, no por LLM. */
  riskLevel: RiskLevel;
  /** Roles que pueden usar el tool (null = cualquier interno autenticado). */
  requiredRoles?: UserRole[] | null;
  /**
   * Handler: wrapper fino que llama al domain service con scoping por actor.empresaId.
   * Recibe ctx (con empresaId confiable), input validado y deps con db.
   */
  handler: (ctx: AgentToolContext, input: TInput, deps: { db: import("@supabase/supabase-js").SupabaseClient }) => Promise<TOutput>;
  /** Para OpenAI/DeepSeek function calling: ejemplo o metadata opcional */
  // Se mantiene minimal para BATCH 1; futuras policies se agregan aca sin tocar gateway.
}

type AnyTool = ToolDefinition<unknown, unknown>;

class Registry {
  private map = new Map<string, AnyTool>();

  register<TInput, TOutput>(def: ToolDefinition<TInput, TOutput>): void {
    if (this.map.has(def.name)) {
      throw new Error(`Tool ya registrado: ${def.name}`);
    }
    if (!/^[a-z_][a-z0-9_]*$/.test(def.name)) {
      throw new Error(`Nombre de tool invalido (snake_case): ${def.name}`);
    }
    if (def.riskLevel < 0 || def.riskLevel > 4) {
      throw new Error(`riskLevel invalido para ${def.name}: ${def.riskLevel}`);
    }
    // Cast seguro: guardamos como unknown
    this.map.set(def.name, def as unknown as AnyTool);
  }

  get(name: string): AnyTool | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  list(): AnyTool[] {
    return Array.from(this.map.values());
  }

  listNames(): string[] {
    return Array.from(this.map.keys());
  }

  /** Definiciones filtradas por allowlist del orchestrator (si se pasa). */
  listForAllowlist(allowlist?: string[] | null): AnyTool[] {
    if (!allowlist || allowlist.length === 0) return this.list();
    const set = new Set(allowlist);
    return this.list().filter((t) => set.has(t.name));
  }

  clearForTests(): void {
    this.map.clear();
  }
}

// Singleton del proceso (server). En tests se puede limpiar via clearForTests.
export const toolRegistry = new Registry();

// Helpers tipados para registrar sin perder inferencia de Input

export function registerTool<TInput, TOutput>(def: ToolDefinition<TInput, TOutput>): void {
  toolRegistry.register(def);
}

export function getTool(name: string): AnyTool | undefined {
  return toolRegistry.get(name);
}

export function isAllowlisted(name: string): boolean {
  return toolRegistry.has(name);
}

/** Describe tools para el prompt del LLM (solo name+description+schema shape). */
export function describeToolsForPrompt(allowlist?: string[] | null): Array<{ name: string; description: string }> {
  return toolRegistry.listForAllowlist(allowlist).map((t) => ({
    name: t.name,
    description: t.description,
  }));
}
