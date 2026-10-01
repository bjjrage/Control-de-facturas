// MUTATION tool LEVEL 2 — cambios de OT respaldados por acciones reales.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageWorkOrderInputSchema = z.object({
  operation: z.enum(["update_status", "approve_internal"]),
  work_order_id: z.string().uuid(),
  status: z.enum(["PENDIENTE", "EN_CURSO", "COMPLETADA", "CANCELADA"]).optional(),
}).superRefine((value, ctx) => {
  if (value.operation === "update_status" && !value.status) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "status es obligatorio para update_status." });
  }
});
export type ManageWorkOrderInput = z.infer<typeof ManageWorkOrderInputSchema>;

async function handler(ctx: AgentToolContext, input: ManageWorkOrderInput, deps: { db: SupabaseClient }) {
  const { data: order, error } = await deps.db
    .from("work_orders")
    .select("id")
    .eq("id", input.work_order_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo validar la orden de trabajo: ${error.message}`);
  if (!order) throw new Error("La orden de trabajo no existe o no pertenece a tu empresa.");

  const actions = await import("@/app/(internal)/ventas/[id]/quotation-actions");
  const result = input.operation === "update_status"
    ? await actions.updateWorkOrderStatus(input.work_order_id, input.status!)
    : await actions.approveWorkOrderInternal(input.work_order_id);
  return { operation: input.operation, work_order_id: input.work_order_id, ...actionResult(result), message: "Orden de trabajo procesada por el ERP; no se tocó tesorería." };
}

registerTool<ManageWorkOrderInput, Record<string, unknown>>({
  name: "manage_work_order",
  description: "Cambia el estado operativo o aprueba internamente una orden de trabajo usando las acciones reales del ERP. Crear la OT proviene de la aceptación de una cotización; asignaciones y otros campos no disponibles siguen fuera del tool. Requiere aprobación.",
  inputSchema: ManageWorkOrderInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageWorkOrderTool = { handler, inputSchema: ManageWorkOrderInputSchema };
