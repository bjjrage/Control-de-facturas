// lib/tools/spreadsheet/get-spreadsheet-snapshot.ts
// READ tool LEVEL 0 — Obtiene el snapshot completo de una planilla (filas + metadatos).
// No duplica lógica: usa el motor de planillas existente con scoping tenant.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { obtenerPlanilla } from "@/lib/planillas/service";

export const GetSpreadsheetSnapshotInputSchema = z.object({
  planilla_id: z.string().uuid({ message: "planilla_id debe ser UUID valido" }),
});

export type GetSpreadsheetSnapshotInput = z.infer<typeof GetSpreadsheetSnapshotInputSchema>;

export interface GetSpreadsheetSnapshotOutput {
  planilla: {
    id: string;
    modulo: string;
    estado: "draft" | "confirmed" | "cancelled";
    contexto: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    confirmed_at: string | null;
  };
  snapshot: {
    rows: Array<{
      _rowId: string;
      _version?: string | null;
      _deleted?: boolean;
      [key: string]: unknown;
    }>;
  };
  columns: Array<{
    key: string;
    label: string;
    type: "text" | "numeric" | "readonly-numeric";
    formulaTemplate?: string;
    width?: number;
    readOnly?: boolean;
  }>;
}

async function handler(
  ctx: AgentToolContext,
  input: GetSpreadsheetSnapshotInput,
  deps: { db: SupabaseClient }
): Promise<GetSpreadsheetSnapshotOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // Obtener planilla con validación de tenant
  const planilla = await obtenerPlanilla(db, empresaId, input.planilla_id);

  // Obtener columnas del adaptador
  const { getPlanillaAdapter } = await import("@/lib/planillas/registry");
  const adapter = getPlanillaAdapter(planilla.modulo);

  return {
    planilla: {
      id: planilla.id,
      modulo: planilla.modulo,
      estado: planilla.estado,
      contexto: planilla.contexto,
      created_at: planilla.created_at,
      updated_at: planilla.updated_at,
      confirmed_at: planilla.confirmed_at,
    },
    snapshot: {
      rows: (planilla.snapshot as { rows: Array<{ _rowId: string; _version?: string | null; _deleted?: boolean; [key: string]: unknown }> }).rows,
    },
    columns: adapter.columns,
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ.
registerTool<GetSpreadsheetSnapshotInput, GetSpreadsheetSnapshotOutput>({
  name: "get_spreadsheet_snapshot",
  description:
    "Obtiene el snapshot completo de una planilla (spreadsheet embebida): filas con metadatos (_rowId, _version), columnas definidas, y estado de la planilla. Usar cuando el usuario pregunta 'qué hay en esta planilla' o 'muéreme el presupuesto de esta obra'.",
  inputSchema: GetSpreadsheetSnapshotInputSchema,
  riskLevel: 0,
  requiredRoles: null, // cualquier rol interno puede leer su planilla
  handler,
});

export const getSpreadsheetSnapshotTool = { handler, inputSchema: GetSpreadsheetSnapshotInputSchema };