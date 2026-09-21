// READ tool LEVEL 0 — resolución humana de entidades ERP.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { ERP_ENTITY_TYPES, resolveErpEntity, type ErpEntityType, type ResolveErpEntityResult } from "@/lib/agent/erp-entity-resolver";

export const ResolveErpEntityInputSchema = z.object({
  entity_type: z.enum(ERP_ENTITY_TYPES),
  query: z.string().trim().min(1).max(240),
});

export type ResolveErpEntityInput = z.infer<typeof ResolveErpEntityInputSchema>;
export type ResolveErpEntityOutput = ResolveErpEntityResult;

async function handler(
  ctx: AgentToolContext,
  input: ResolveErpEntityInput,
  deps: { db: SupabaseClient }
): Promise<ResolveErpEntityOutput> {
  return resolveErpEntity(deps.db, ctx.empresaId, input.entity_type as ErpEntityType, input.query);
}

registerTool<ResolveErpEntityInput, ResolveErpEntityOutput>({
  name: "resolve_erp_entity",
  description:
    "Resuelve una referencia humana del ERP sin pedir UUID: proyecto/obra, cliente, proveedor, producto/material, factura, OC, RFQ, licitación, documento, depósito/ubicación o planilla. Devuelve candidatos tenant-scoped; si hay una coincidencia exacta única, usar ese id. Si hay ambigüedad real, preguntar solo la aclaración necesaria.",
  inputSchema: ResolveErpEntityInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const resolveErpEntityTool = { handler, inputSchema: ResolveErpEntityInputSchema };
