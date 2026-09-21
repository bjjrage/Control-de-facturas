import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult, toFormData } from "./action-utils";

export const ManageBudgetItemInputSchema = z.object({
  operation: z.enum(["create", "update", "schedule", "record_execution"]),
  project_id: z.string().uuid(),
  item_id: z.string().uuid().optional(),
  code: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  unit: z.string().trim().max(40).optional().nullable(),
  quantity: z.number().nonnegative().finite().optional().nullable(),
  unit_price: z.number().nonnegative().finite().optional().nullable(),
  quantity_per_unit: z.number().nonnegative().finite().optional().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  depends_on: z.string().uuid().optional().nullable(),
  quantity_executed: z.number().positive().finite().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ManageBudgetItemInput = z.infer<typeof ManageBudgetItemInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageBudgetItemInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/actions");
  let result: unknown;
  if (input.operation === "create") {
    if (!input.code || !input.description) throw new Error("Crear partida necesita código y descripción.");
    result = await actions.addBudgetItem(input.project_id, toFormData(input));
  } else if (input.operation === "update") {
    if (!input.item_id || !input.code || !input.description) throw new Error("Editar partida necesita item_id, código y descripción.");
    result = await actions.updateBudgetItem(input.project_id, input.item_id, toFormData(input));
  } else if (input.operation === "schedule") {
    if (!input.item_id) throw new Error("Programar partida necesita item_id.");
    result = await actions.updateBudgetItemSchedule(input.item_id, input.start_date ?? null, input.end_date ?? null, input.depends_on ?? null);
  } else {
    if (!input.quantity_executed) throw new Error("Registrar avance necesita cantidad positiva.");
    result = await actions.addExecutionEntry(input.project_id, toFormData({
      budget_item_id: input.item_id,
      quantity_executed: input.quantity_executed,
      entry_date: input.entry_date,
      notes: input.notes,
    }));
  }
  return { operation: input.operation, project_id: input.project_id, item_id: input.item_id ?? null, ...actionResult(result), message: "Partida/avance procesado por el ERP." };
}

registerTool<ManageBudgetItemInput, Record<string, unknown>>({
  name: "manage_budget_item",
  description: "Crea o edita partidas de presupuesto, programa fechas/dependencias y registra avance real de obra usando las acciones existentes. Requiere aprobación; no inventa APU ni cantidades.",
  inputSchema: ManageBudgetItemInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageBudgetItemTool = { handler, inputSchema: ManageBudgetItemInputSchema };
