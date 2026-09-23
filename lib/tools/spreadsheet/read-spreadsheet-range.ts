// lib/tools/spreadsheet/read-spreadsheet-range.ts
// READ tool LEVEL 0 — Lee un rango específico de una planilla (spreadsheet embebida).
// No duplica lógica: usa el motor de planillas existente con scoping tenant.
// Flujo normal: workspace context → selection → read only required cells → LLM
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { obtenerPlanilla } from "@/lib/planillas/service";
import type { PlanillaRowMeta } from "@/lib/planillas/types";

export const MAX_ROWS = 200;
export const MAX_COLS = 50;
export const MAX_CELLS = MAX_ROWS * MAX_COLS;
export const MAX_PAYLOAD_CHARS = 50000;

function parseA1Range(range: string): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  // Soporta A1:H10, A1:H10 (case-insensitive), con o sin $
  const match = range.trim().toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return null;
  const [, startColStr, startRowStr, endColStr, endRowStr] = match;
  const colToIndex = (col: string): number => {
    let idx = 0;
    for (const ch of col) {
      idx = idx * 26 + (ch.charCodeAt(0) - 64);
    }
    return idx - 1; // 0-based
  };
  return {
    startRow: parseInt(startRowStr, 10) - 1, // 0-based
    startCol: colToIndex(startColStr),
    endRow: parseInt(endRowStr, 10) - 1,
    endCol: colToIndex(endColStr),
  };
}

export const ReadSpreadsheetRangeInputSchema = z.object({
  planilla_id: z.string().uuid({ message: "planilla_id debe ser UUID valido" }),
  range: z.string().max(32).optional().nullable().describe("Rango A1-style ej: 'A18:H24'. Si no se pasa, usa selection del workspace context."),
  max_rows: z.number().int().positive().max(MAX_ROWS).optional(),
  max_cols: z.number().int().positive().max(MAX_COLS).optional(),
});

export type ReadSpreadsheetRangeInput = z.infer<typeof ReadSpreadsheetRangeInputSchema>;

export interface ReadSpreadsheetRangeOutput {
  planilla_id: string;
  modulo: string;
  estado: "draft" | "confirmed" | "cancelled";
  range: {
    requested: string | null;
    actual_start_row: number;
    actual_start_col: number;
    actual_end_row: number;
    actual_end_col: number;
    rows_returned: number;
    cols_returned: number;
  };
  columns: Array<{
    key: string;
    label: string;
    type: "text" | "numeric" | "readonly-numeric";
    index: number;
  }>;
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  warnings: string[];
}

async function handler(
  ctx: AgentToolContext,
  input: ReadSpreadsheetRangeInput,
  deps: { db: SupabaseClient }
): Promise<ReadSpreadsheetRangeOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // Obtener planilla con validación de tenant
  const planilla = await obtenerPlanilla(db, empresaId, input.planilla_id);

  if (planilla.estado === "confirmed") {
    // En planillas confirmadas, leer snapshot histórico
  } else if (planilla.estado !== "draft") {
    throw new Error(`Planilla en estado "${planilla.estado}" no legible`);
  }

  // Obtener columnas del adaptador
  const { getPlanillaAdapter } = await import("@/lib/planillas/registry");
  const adapter = getPlanillaAdapter(planilla.modulo);

  // Snapshot rows
  const snapshotRows = (planilla.snapshot as { rows: Array<PlanillaRowMeta & Record<string, unknown>> }).rows;

  // Determinar rango
  let startRow = 0;
  let startCol = 0;
  let endRow = Math.min(snapshotRows.length - 1, MAX_ROWS - 1);
  let endCol = Math.min(adapter.columns.length - 1, MAX_COLS - 1);
  let requestedRange = input.range ?? null;

  if (input.range) {
    const parsed = parseA1Range(input.range);
    if (!parsed) {
      throw new Error(`Rango invalido: "${input.range}". Formato esperado: "A1:H24"`);
    }
    startRow = Math.max(0, Math.min(parsed.startRow, MAX_ROWS - 1));
    startCol = Math.max(0, Math.min(parsed.startCol, MAX_COLS - 1));
    endRow = Math.max(startRow, Math.min(parsed.endRow, MAX_ROWS - 1, snapshotRows.length - 1));
    endCol = Math.max(startCol, Math.min(parsed.endCol, MAX_COLS - 1, adapter.columns.length - 1));
    requestedRange = input.range;
  } else if (ctx.workspace?.spreadsheet?.selection) {
    // Usar selection del workspace context
    const wsSel = ctx.workspace.spreadsheet.selection;
    const parsed = parseA1Range(wsSel);
    if (parsed) {
      startRow = Math.max(0, Math.min(parsed.startRow, MAX_ROWS - 1));
      startCol = Math.max(0, Math.min(parsed.startCol, MAX_COLS - 1));
      endRow = Math.max(startRow, Math.min(parsed.endRow, MAX_ROWS - 1, snapshotRows.length - 1));
      endCol = Math.max(startCol, Math.min(parsed.endCol, MAX_COLS - 1, adapter.columns.length - 1));
      requestedRange = wsSel;
    }
  } else if (ctx.workspace?.spreadsheet?.selectedRows?.length) {
    // Usar selectedRows del workspace context
    const rowIndices = ctx.workspace.spreadsheet.selectedRows
      .map((rid) => snapshotRows.findIndex((r) => r._rowId === rid))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (rowIndices.length > 0) {
      startRow = rowIndices[0];
      endRow = Math.min(rowIndices[rowIndices.length - 1], MAX_ROWS - 1);
      requestedRange = `selection:${ctx.workspace.spreadsheet.selectedRows.length}rows`;
    }
  }

  // Aplicar límites explícitos si se pasaron
  if (input.max_rows) {
    endRow = Math.min(endRow, startRow + input.max_rows - 1, MAX_ROWS - 1);
  }
  if (input.max_cols) {
    endCol = Math.min(endCol, startCol + input.max_cols - 1, MAX_COLS - 1);
  }

  // Validar que el rango tenga sentido
  if (startRow > snapshotRows.length - 1) {
    throw new Error(`Rango fuera de bounds: start_row ${startRow + 1} > total rows ${snapshotRows.length}`);
  }

  // Extraer columnas del rango
  const columnsInRange = adapter.columns.slice(startCol, endCol + 1).map((c, i) => ({
    key: c.key,
    label: c.label,
    type: c.type,
    index: startCol + i,
  }));

  // Select adapter columns directly. Snapshot metadata must not displace them.
  const colKeys = columnsInRange.map((c) => c.key);
  const selectedRows = snapshotRows.slice(startRow, endRow + 1);
  const selectedPayloadRows = selectedRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const k of colKeys) if (k in row) out[k] = row[k];
    return out;
  });

  const totalCells = selectedPayloadRows.length * (endCol - startCol + 1);
  const baseWarnings: string[] = [];

  if (totalCells > MAX_CELLS) baseWarnings.push(`Rango supera ${MAX_CELLS} celdas máximas`);
  const filteredRows: Array<Record<string, unknown>> = [];
  let payloadTruncated = false;

  const makeOutput = (rows: Array<Record<string, unknown>>, isPayloadTruncated: boolean): ReadSpreadsheetRangeOutput => ({
    planilla_id: input.planilla_id,
    modulo: planilla.modulo,
    estado: planilla.estado,
    range: {
      requested: requestedRange,
      actual_start_row: startRow + 1,
      actual_start_col: startCol + 1,
      actual_end_row: startRow + rows.length,
      actual_end_col: endCol + 1,
      rows_returned: rows.length,
      cols_returned: endCol - startCol + 1,
    },
    columns: columnsInRange,
    rows,
    truncated: totalCells > MAX_CELLS || isPayloadTruncated,
    warnings: isPayloadTruncated
      ? [
          ...baseWarnings,
          rows.length === 0
            ? `La primera fila supera el límite de ${MAX_PAYLOAD_CHARS} caracteres; no se devolvieron filas.`
            : `Se omitieron filas para respetar el límite de ${MAX_PAYLOAD_CHARS} caracteres del payload.`,
        ]
      : baseWarnings,
  });

  for (const row of selectedPayloadRows) {
    const candidateRows = [...filteredRows, row];
    // Medir el objeto completo (columnas, rango y avisos incluidos), no solo rows.
    if (JSON.stringify(makeOutput(candidateRows, true)).length > MAX_PAYLOAD_CHARS) {
      payloadTruncated = true;
      break;
    }
    filteredRows.push(row);
  }

  let output = makeOutput(filteredRows, payloadTruncated);
  while (JSON.stringify(output).length > MAX_PAYLOAD_CHARS && filteredRows.length > 0) {
    filteredRows.pop();
    payloadTruncated = true;
    output = makeOutput(filteredRows, payloadTruncated);
  }
  if (JSON.stringify(output).length > MAX_PAYLOAD_CHARS) {
    throw new Error(`Las columnas y metadatos del rango superan el límite de ${MAX_PAYLOAD_CHARS} caracteres.`);
  }
  return output;
}

// Auto-registro (side-effect al importar). Risk 0 = READ.
registerTool<ReadSpreadsheetRangeInput, ReadSpreadsheetRangeOutput>({
  name: "read_spreadsheet_range",
  description:
    "Lee un rango específico de celdas de una planilla (spreadsheet embebida). Input: planilla_id + range (A1:H24) o usa selection del workspace context. Retorna solo celdas solicitadas con límites de filas/cols/payload. Flujo normal: workspace context → selection → read range → LLM. No retorna workbook completo.",
  inputSchema: ReadSpreadsheetRangeInputSchema,
  riskLevel: 0,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const readSpreadsheetRangeTool = { handler, inputSchema: ReadSpreadsheetRangeInputSchema };
