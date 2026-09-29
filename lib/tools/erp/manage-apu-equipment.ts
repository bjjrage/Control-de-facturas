// ACTION tool LEVEL 2 — actualiza el componente equipo del APU/BOM.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageApuEquipmentInputSchema = z.object({
  project_id: z.string().uuid(),
  budget_item_id: z.string().uuid(),
  tipo_equipo: z.string().min(1),
  horas_por_unidad: z.number().positive().finite(),
  costo_hora: z.number().nonnegative().finite(),
});
export type ManageApuEquipmentInput = z.infer<typeof ManageApuEquipmentInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageApuEquipmentInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/[id]/apu-actions");
  const result = await actions.saveBudgetItemEquipmentAction({
    projectId: input.project_id,
    budgetItemId: input.budget_item_id,
    tipoEquipo: input.tipo_equipo,
    horasPorUnidad: input.horas_por_unidad,
    costoHora: input.costo_hora,
  });
  return { ...actionResult(result), message: "Componente de equipo de APU actualizado por la acción real; costo_hora es dato cargado, no derivado de un catálogo." };
}

registerTool({
  name: "manage_apu_equipment",
  description: "Crea o actualiza el componente de equipo de una partida en budget_item_equipment. Requiere aprobación humana; no inventa costo_hora si el usuario no lo dio.",
  inputSchema: ManageApuEquipmentInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageApuEquipmentTool = { handler, inputSchema: ManageApuEquipmentInputSchema };
