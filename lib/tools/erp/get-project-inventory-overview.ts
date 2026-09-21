// READ tool LEVEL 0 — stock imputado a una obra.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { getBudgetInventoryConsumption, getProjectInventorySnapshot } from "@/lib/inventory/service";

export const GetProjectInventoryOverviewInputSchema = z.object({
  project_id: z.string().uuid(),
  producto_id: z.string().uuid().optional().nullable(),
});

export type GetProjectInventoryOverviewInput = z.infer<typeof GetProjectInventoryOverviewInputSchema>;

export interface GetProjectInventoryOverviewOutput {
  project: { id: string; name: string; code: string | null };
  stock: Array<Record<string, unknown>>;
  consumed_by_budget: Array<Record<string, unknown>>;
}

async function handler(
  ctx: AgentToolContext,
  input: GetProjectInventoryOverviewInput,
  deps: { db: SupabaseClient }
): Promise<GetProjectInventoryOverviewOutput> {
  const { data: project, error: projectError } = await deps.db
    .from("projects")
    .select("id, name, code")
    .eq("id", input.project_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (projectError) throw new Error(`Error leyendo la obra: ${projectError.message}`);
  if (!project) throw new Error("La obra no existe o no pertenece a tu empresa.");

  const [stock, consumed] = await Promise.all([
    getProjectInventorySnapshot(deps.db, ctx.empresaId, input.project_id, input.producto_id ?? undefined),
    getBudgetInventoryConsumption(deps.db, ctx.empresaId, {
      projectId: input.project_id,
      productoId: input.producto_id ?? undefined,
    }),
  ]);
  if (stock.error) throw new Error(`Error leyendo stock de la obra: ${stock.error}`);
  if (consumed.error) throw new Error(`Error leyendo consumo de la obra: ${consumed.error}`);

  return {
    project: { id: String(project.id), name: String(project.name), code: project.code ? String(project.code) : null },
    stock: stock.data as Array<Record<string, unknown>>,
    consumed_by_budget: consumed.data as Array<Record<string, unknown>>,
  };
}

registerTool<GetProjectInventoryOverviewInput, GetProjectInventoryOverviewOutput>({
  name: "get_project_inventory_overview",
  description:
    "Lee el stock y el consumo de materiales imputados a una obra. Acepta el proyecto resuelto por nombre y opcionalmente un producto resuelto por nombre; no requiere que el usuario conozca UUIDs.",
  inputSchema: GetProjectInventoryOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getProjectInventoryOverviewTool = { handler, inputSchema: GetProjectInventoryOverviewInputSchema };
