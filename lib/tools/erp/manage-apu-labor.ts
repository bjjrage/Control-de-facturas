// ACTION tool LEVEL 2 — actualiza el componente mano de obra del APU/BOM.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageApuLaborInputSchema = z.object({
  project_id: z.string().uuid(),
  budget_item_id: z.string().uuid(),
  rol: z.string().min(1),
  horas_por_unidad: z.number().positive().finite(),
  costo_hora: z.number().nonnegative().finite(),
});
export type ManageApuLaborInput = z.infer<typeof ManageApuLaborInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageApuLaborInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/[id]/apu-actions");
  const result = await actions.saveBudgetItemLaborAction({
    projectId: input.project_id,
    budgetItemId: input.budget_item_id,
    rol: input.rol,
    horasPorUnidad: input.horas_por_unidad,
    costoHora: input.costo_hora,
  });
  return { ...actionResult(result), message: "Componente de mano de obra de APU actualizado por la acción real; costo_hora es dato cargado, no derivado de un catálogo." };
}

registerTool({
  name: "manage_apu_labor",
  description: "Crea o actualiza el componente de mano de obra de una partida en budget_item_labor. Requiere aprobación humana; no inventa costo_hora si el usuario no lo dio.",
  inputSchema: ManageApuLaborInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageApuLaborTool = { handler, inputSchema: ManageApuLaborInputSchema };
