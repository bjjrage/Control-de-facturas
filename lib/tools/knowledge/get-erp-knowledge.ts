import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { retrieveErpKnowledge } from "@/lib/agent/knowledge";

export const GetErpKnowledgeInputSchema = z.object({
  topic: z.string().min(1).max(240),
});

export type GetErpKnowledgeInput = z.infer<typeof GetErpKnowledgeInputSchema>;

export interface GetErpKnowledgeOutput {
  topic: string;
  static_only: true;
  matches: ReturnType<typeof retrieveErpKnowledge>;
  guidance: string;
}

async function handler(
  _ctx: AgentToolContext,
  input: GetErpKnowledgeInput,
  _deps: { db: SupabaseClient }
): Promise<GetErpKnowledgeOutput> {
  return {
    topic: input.topic,
    static_only: true,
    matches: retrieveErpKnowledge(input.topic, { maxDocuments: 4, maxChars: 12_000 }),
    guidance: "Esto es conocimiento estático trazable a código. No contiene estado actual, no concede permisos y no reemplaza una lectura del ERP.",
  };
}

registerTool<GetErpKnowledgeInput, GetErpKnowledgeOutput>({
  name: "get_erp_knowledge",
  description:
    "Consulta conocimiento estático y trazable del ERP por tema cuando falta contexto conceptual. No devuelve datos vivos, no modifica datos y no concede permisos. Después de leerlo, usa un tool de lectura real si el usuario pidió valores actuales.",
  inputSchema: GetErpKnowledgeInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getErpKnowledgeTool = { handler, inputSchema: GetErpKnowledgeInputSchema };
