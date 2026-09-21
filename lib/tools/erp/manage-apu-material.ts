// ACTION tool LEVEL 2 — actualiza el componente material del APU/BOM existente.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageApuMaterialInputSchema = z.object({
  project_id: z.string().uuid(),
  budget_item_id: z.string().uuid(),
  producto_id: z.string().uuid(),
  cantidad_por_unidad: z.number().nonnegative().finite(),
  desperdicio_pct: z.number().nonnegative().max(100).finite().optional(),
});
export type ManageApuMaterialInput = z.infer<typeof ManageApuMaterialInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageApuMaterialInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/progress-forecast-actions");
  const result = await actions.saveBudgetItemMaterialAction({
    projectId: input.project_id,
    budgetItemId: input.budget_item_id,
    productoId: input.producto_id,
    cantidadPorUnidad: input.cantidad_por_unidad,
    desperdicioPct: input.desperdicio_pct ?? 0,
  });
  return { ...actionResult(result), message: "Componente material de APU actualizado por la acción real; no modifica tesorería." };
}

registerTool({
  name: "manage_apu_material",
  description: "Crea o actualiza el componente material de una partida en budget_item_materials usando la acción real de APU/BOM. Requiere aprobación humana; no inventa mano de obra ni equipos.",
  inputSchema: ManageApuMaterialInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageApuMaterialTool = { handler, inputSchema: ManageApuMaterialInputSchema };
