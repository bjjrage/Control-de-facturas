// lib/tools/spreadsheet/update-spreadsheet-rows.ts
// PREPARE tool LEVEL 1 — Actualiza filas del snapshot de una planilla (borrador).
// Puede escribir porque solo actualiza el borrador (planilla.estado === "draft").
// No toca las tablas de dominio — solo el snapshot en planillas.snapshot.
// Debe ser idempotente: misma key+planilla+empresa retorna mismo resultado.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actualizarSnapshot, obtenerPlanilla } from "@/lib/planillas/service";
import type { PlanillaRow } from "@/lib/planillas/types";
import { PlanillaConcurrencyError } from "@/lib/planillas/types";
import { getPlanillaAdapter } from "@/lib/planillas/registry";

export const UpdateSpreadsheetRowsInputSchema = z.object({
  planilla_id: z.string().uuid({ message: "planilla_id debe ser UUID valido" }),
  expected_updated_at: z.string().min(1).max(64),
  rows: z.array(z.object({
    _rowId: z.string().min(1),
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

  const planilla = await obtenerPlanilla(db, empresaId, input.planilla_id);
  if (planilla.estado !== "draft") {
    throw new Error(`No se puede editar una planilla en estado "${planilla.estado}".`);
  }
  if (planilla.updated_at !== input.expected_updated_at) {
    throw new PlanillaConcurrencyError("La planilla cambió desde que se obtuvo el snapshot; vuelve a leerla antes de editar.");
  }

  const adapter = getPlanillaAdapter(planilla.modulo);
  const currentRows = (planilla.snapshot as { rows: PlanillaRow[] }).rows;
  const rowsById = new Map(currentRows.map((row) => [row._rowId, row]));
  const seen = new Set<string>();
  const newRows: PlanillaRow[] = [];

  for (const patch of input.rows) {
    if (seen.has(patch._rowId)) {
      throw new Error(`La fila ${patch._rowId} aparece más de una vez.`);
    }
    seen.add(patch._rowId);

    const existing = rowsById.get(patch._rowId);
    const isNewRow = /^new:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patch._rowId);
    if (!existing && !isNewRow) {
      throw new Error(`La fila ${patch._rowId} no pertenece al snapshot de esta planilla.`);
    }

    // Solo se aceptan celdas definidas por el adaptador y editables. La
    // identidad, versión, estilo y columnas calculadas siempre vienen del
    // snapshot confiable, nunca del payload del modelo.
    const values = Object.fromEntries(
      adapter.columns
        .filter((column) => !column.readOnly && Object.prototype.hasOwnProperty.call(patch, column.key))
        .map((column) => [column.key, patch[column.key]])
    );
    const merged: PlanillaRow = existing
      ? { ...existing, ...values }
      : { _rowId: patch._rowId, _version: null, _deleted: false, ...values };

    if (Object.prototype.hasOwnProperty.call(patch, "_deleted")) {
      merged._deleted = patch._deleted;
    }

    if (existing) rowsById.set(patch._rowId, merged);
    else newRows.push(merged);
  }

  // El tool acepta patches de filas: las filas no mencionadas no se pierden.
  // Se persiste el snapshot completo porque actualizarSnapshot reemplaza rows.
  const mergedRows = currentRows.map((row) => rowsById.get(row._rowId) ?? row).concat(newRows);
  const result = await actualizarSnapshot(db, empresaId, input.planilla_id, mergedRows, input.expected_updated_at);

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
    "Actualiza filas del snapshot de una planilla (borrador). Incluye expected_updated_at copiado de planilla.updated_at del snapshot leído. Rechaza ediciones obsoletas. SOLO modifica el borrador — no toca tablas de dominio hasta confirmar. Idempotencia: misma key+planilla+empresa retorna el resultado previo.",
  inputSchema: UpdateSpreadsheetRowsInputSchema,
  riskLevel: 1,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const updateSpreadsheetRowsTool = { handler, inputSchema: UpdateSpreadsheetRowsInputSchema };
