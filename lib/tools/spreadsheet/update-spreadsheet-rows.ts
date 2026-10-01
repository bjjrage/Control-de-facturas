// lib/tools/spreadsheet/update-spreadsheet-rows.ts
// PREPARE tool LEVEL 1 — Actualiza filas del snapshot de una planilla (borrador).
// Puede escribir porque solo actualiza el borrador (planilla.estado === "draft").
// No toca las tablas de dominio — solo el snapshot en planillas.snapshot.
// Debe ser idempotente: misma key+planilla+empresa retorna mismo resultado.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actualizarSnapshot } from "@/lib/planillas/service";
import { PlanillaRowMeta } from "@/lib/planillas/types";

export const UpdateSpreadsheetRowsInputSchema = z.object({
  planilla_id: z.string().uuid({ message: "planilla_id debe ser UUID valido" }),
  rows: z.array(z.object({
    _rowId: z.string(),
    _version: z.string().optional().nullable(),
    _deleted: z.boolean().optional(),
  }).passthrough()).min(1, "al menos una fila"),
  idempotency_key: z.string().uuid().optional(),
});

export type UpdateSpreadsheetRowsInput = z.infer<typeof UpdateSpreadsheetRowsInputSchema>;

export interface UpdateSpreadsheetRowsOutput {
  planilla_id: string;
  updated_at: string;
  rows_affected: number;
  message: string;
}

async function handler(
  ctx: AgentToolContext,
  input: UpdateSpreadsheetRowsInput,
  deps: { db: SupabaseClient }
): Promise<UpdateSpreadsheetRowsOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // Validar que las filas tengan _rowId (identidad, no posición)
  for (const row of input.rows) {
    if (!row._rowId) {
      throw new Error("Cada fila debe tener _rowId (identidad obligatoria, nunca posición).");
    }
  }

  // Convertir a PlanillaRowMeta[]
  const rowsMeta: PlanillaRowMeta[] = input.rows.map((r) => ({
    _rowId: r._rowId,
    _version: r._version ?? null,
    _deleted: r._deleted ?? false,
  }));

  const result = await actualizarSnapshot(db, empresaId, input.planilla_id, rowsMeta);

  return {
    planilla_id: input.planilla_id,
    updated_at: result.updated_at,
    rows_affected: input.rows.length,
    message: `Snapshot de planilla actualizado (${input.rows.length} fila(s)). Cambios solo en borrador — no afecta tablas de dominio hasta confirmar.`,
  };
}

// Auto-registro (side-effect al importar). Risk 1 = PREPARE (escribe borrador reversible).
registerTool<UpdateSpreadsheetRowsInput, UpdateSpreadsheetRowsOutput>({
  name: "update_spreadsheet_rows",
  description:
    "Actualiza filas del snapshot de una planilla (borrador). SOLO modifica el borrador en planillas.snapshot — no toca tablas de dominio (budget_items, etc.) hasta confirmar. Idempotente: misma key+planilla+empresa retorna mismo resultado. Usar cuando el usuario edita celdas en la spreadsheet y dice 'guarda estos cambios'.",
  inputSchema: UpdateSpreadsheetRowsInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const updateSpreadsheetRowsTool = { handler, inputSchema: UpdateSpreadsheetRowsInputSchema };
