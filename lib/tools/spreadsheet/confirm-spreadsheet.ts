// lib/tools/spreadsheet/confirm-spreadsheet.ts
// EXTERNAL_ACTION tool LEVEL 2 — Confirma una planilla y aplica cambios a tablas de dominio.
// Requiere aprobación humana (risk 2). DeepSeek no puede ejecutarlo directamente.
// Tras aprobación humana y validación criptográfica del payload, ejecuta confirmarPlanilla.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { confirmarPlanilla } from "@/lib/planillas/service";

export const ConfirmSpreadsheetInputSchema = z.object({
  planilla_id: z.string().uuid({ message: "planilla_id debe ser UUID valido" }),
  confirm_confirmation: z.boolean().refine((v) => v === true, {
    message: "confirm_confirmation debe ser true para confirmar la planilla",
  }),
});

export type ConfirmSpreadsheetInput = z.infer<typeof ConfirmSpreadsheetInputSchema>;

export interface ConfirmSpreadsheetOutput {
  planilla_id: string;
  already_confirmed: boolean;
  result: {
    inserted: number;
    updated: number;
    deleted: number;
  };
  message: string;
}

async function handler(
  ctx: AgentToolContext,
  input: ConfirmSpreadsheetInput,
  deps: { db: SupabaseClient }
): Promise<ConfirmSpreadsheetOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  const result = await confirmarPlanilla(db, empresaId, input.planilla_id);

  return {
    planilla_id: input.planilla_id,
    already_confirmed: result.alreadyConfirmed,
    result: result.result,
    message: result.alreadyConfirmed
      ? "La planilla ya estaba confirmada — no se reaplicaron cambios (idempotente)."
      : `Planilla confirmada: ${result.result.inserted} insertadas, ${result.result.updated} actualizadas, ${result.result.deleted} eliminadas en tablas de dominio.`,
  };
}

// Auto-registro (side-effect al importar). Risk 2 = EXTERNAL_ACTION (requiere approval humano obligatorio).
registerTool<ConfirmSpreadsheetInput, ConfirmSpreadsheetOutput>({
  name: "confirm_spreadsheet",
  description:
    "Confirma y finaliza una planilla (spreadsheet embebida): transiciona estado de DRAFT a CONFIRMED y aplica inserts/updates/deletes atómicos contra las tablas de dominio (ej. budget_items). Requiere aprobación humana (Risk 2: compromiso de datos). Usar cuando el usuario dice 'confirma estos cambios' o 'aplica el presupuesto'.",
  inputSchema: ConfirmSpreadsheetInputSchema,
  riskLevel: 2,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const confirmSpreadsheetTool = { handler, inputSchema: ConfirmSpreadsheetInputSchema };