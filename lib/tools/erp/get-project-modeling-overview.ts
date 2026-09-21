import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetProjectModelingOverviewInputSchema = z.object({ project_id: z.string().uuid() });
export type GetProjectModelingOverviewInput = z.infer<typeof GetProjectModelingOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetProjectModelingOverviewInput, deps: { db: SupabaseClient }) {
  const { data: project, error: projectError } = await deps.db.from("projects").select("id, name, code").eq("id", input.project_id).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (projectError) throw new Error(`Error leyendo la obra: ${projectError.message}`);
  if (!project) throw new Error("La obra no existe o no pertenece a tu empresa.");

  const [{ data: budget, error: budgetError }, { data: bimModels, error: bimError }, { data: computoImports, error: computoError }] = await Promise.all([
    deps.db.from("budget_items").select("id, code, description, unit, quantity, unit_price, subtotal, parent_id, sort_order").eq("project_id", input.project_id).order("sort_order"),
    deps.db.from("bim_models").select("id, file_name, status, element_count, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }),
    deps.db.from("computo_imports").select("id, file_name, status, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }),
  ]);
  if (budgetError) throw new Error(`Error leyendo presupuesto: ${budgetError.message}`);
  if (bimError) throw new Error(`Error leyendo modelos BIM: ${bimError.message}`);
  if (computoError) throw new Error(`Error leyendo cómputos: ${computoError.message}`);
  return { project, budget_items: budget ?? [], bim_models: bimModels ?? [], computo_imports: computoImports ?? [] };
}

registerTool<GetProjectModelingOverviewInput, Record<string, unknown>>({
  name: "get_project_modeling_overview",
  description: "Lee presupuesto/cómputo, modelos BIM y estado de importaciones de una obra desde tablas reales, sin generar matches ni inventar APU.",
  inputSchema: GetProjectModelingOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getProjectModelingOverviewTool = { handler, inputSchema: GetProjectModelingOverviewInputSchema };
