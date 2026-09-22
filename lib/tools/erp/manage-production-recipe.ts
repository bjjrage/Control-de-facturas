import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

const component = z.object({ budget_item_id: z.string().uuid(), quantity_per_unit: z.number().positive().finite(), unit: z.string().trim().min(1).max(40) });
export const ManageProductionRecipeInputSchema = z.object({
  project_id: z.string().uuid(),
  recipe_id: z.string().uuid().optional().nullable(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  production_unit: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional().nullable(),
  contract_total_quantity: z.number().nonnegative().finite().optional().nullable(),
  source_type: z.enum(["EXCEL", "BIM", "MANUAL"]).optional(),
  source_file_name: z.string().trim().max(255).optional().nullable(),
  components: z.array(component).min(1),
});
export type ManageProductionRecipeInput = z.infer<typeof ManageProductionRecipeInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageProductionRecipeInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/production-recipe-actions");
  const result = await actions.saveProductionRecipe({
    recipeId: input.recipe_id ?? undefined,
    projectId: input.project_id,
    code: input.code,
    name: input.name,
    productionUnit: input.production_unit,
    description: input.description,
    contractTotalQuantity: input.contract_total_quantity,
    sourceType: input.source_type,
    sourceFileName: input.source_file_name,
    components: input.components.map((row) => ({ budgetItemId: row.budget_item_id, quantityPerUnit: row.quantity_per_unit, unit: row.unit })),
  });
  return { project_id: input.project_id, recipe_id: input.recipe_id ?? null, ...actionResult(result), message: "Receta/BOM de producción procesada por el servicio real." };
}

registerTool<ManageProductionRecipeInput, Record<string, unknown>>({
  name: "manage_production_recipe",
  description: "Crea o edita una receta/BOM de producción real y sus componentes de presupuesto; valida que las partidas pertenezcan a la obra. Requiere aprobación.",
  inputSchema: ManageProductionRecipeInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageProductionRecipeTool = { handler, inputSchema: ManageProductionRecipeInputSchema };
