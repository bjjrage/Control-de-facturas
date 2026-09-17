// lib/tools/projects/get-project-context.ts
// READ tool LEVEL 0 — wrapper fino sobre domain existente (projects + budget + execution).
// No duplica lógica de negocio: lee via Supabase con scoping tenant estricto.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetProjectContextInputSchema = z.object({
  project_id: z.string().uuid({ message: "project_id debe ser UUID valido" }),
});

export type GetProjectContextInput = z.infer<typeof GetProjectContextInputSchema>;

export interface GetProjectContextOutput {
  project: {
    id: string;
    empresa_id: string;
    name: string;
    code: string;
    client: string | null;
    location: string | null;
    status: string;
    budget_total: number;
    start_date: string | null;
    end_date: string | null;
    created_at: string;
  };
  budget_summary: {
    total_items: number;
    total_subtotal: number;
    items_with_quantity: number;
  };
  progress_summary: {
    execution_entries_count: number;
    total_executed_qty: number;
  };
  // No se expone todo el computo para no cargar payloads gigantes en el LLM.
}

async function handler(
  ctx: AgentToolContext,
  input: GetProjectContextInput,
  deps: { db: SupabaseClient }
): Promise<GetProjectContextOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Proyecto (tenant-scoped)
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, empresa_id, name, code, client, location, status, budget_total, start_date, end_date, created_at")
    .eq("id", input.project_id)
    .eq("empresa_id", empresaId)
    .single();

  if (projErr || !project) {
    // PGRST116 -> not found; cualquier caso es fail-closed con mensaje claro
    throw new Error(`Proyecto no encontrado o no pertenece a tu empresa (id=${input.project_id})`);
  }

  // 2. Resumen de cómputo (budget_items) para ese proyecto
  //    budget_items no tiene empresa_id directa, scope via project_id -> projects ya validado
  const { data: budgetItems, error: budgetErr } = await db
    .from("budget_items")
    .select("id, quantity, unit_price, subtotal")
    .eq("project_id", input.project_id);

  if (budgetErr) throw new Error(`Error leyendo presupuesto del proyecto: ${budgetErr.message}`);

  const items = (budgetItems ?? []) as Array<{ quantity: number | null; unit_price: number | null; subtotal: number | null }>;
  const totalItems = items.length;
  const totalSubtotal = items.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);
  const itemsWithQuantity = items.filter((it) => it.quantity !== null && Number(it.quantity) > 0).length;

  // 3. Resumen de ejecución (execution_entries)
  const { data: execEntries, error: execErr } = await db
    .from("execution_entries")
    .select("quantity_executed")
    .eq("project_id", input.project_id);

  if (execErr) throw new Error(`Error leyendo avance de ejecucion: ${execErr.message}`);

  const exec = (execEntries ?? []) as Array<{ quantity_executed: number }>;
  const totalExecutedQty = exec.reduce((acc, e) => acc + Number(e.quantity_executed || 0), 0);

  return {
    project: {
      id: (project as { id: string }).id,
      empresa_id: (project as { empresa_id: string }).empresa_id,
      name: (project as { name: string }).name,
      code: (project as { code: string }).code,
      client: (project as { client: string | null }).client,
      location: (project as { location: string | null }).location,
      status: (project as { status: string }).status,
      budget_total: Number((project as { budget_total: number }).budget_total),
      start_date: (project as { start_date: string | null }).start_date,
      end_date: (project as { end_date: string | null }).end_date,
      created_at: (project as { created_at: string }).created_at,
    },
    budget_summary: {
      total_items: totalItems,
      total_subtotal: Math.round(totalSubtotal * 100) / 100,
      items_with_quantity: itemsWithQuantity,
    },
    progress_summary: {
      execution_entries_count: exec.length,
      total_executed_qty: Math.round(totalExecutedQty * 10000) / 10000,
    },
  };
}

// Auto-registro (side-effect al importar). BATCH 1 solo READ.
registerTool<GetProjectContextInput, GetProjectContextOutput>({
  name: "get_project_context",
  description:
    "Obtiene el contexto de un proyecto de obra por ID: datos del proyecto, resumen de presupuesto y avance de ejecucion. Usar cuando el usuario refiere a 'este proyecto' o 'esta obra' y necesitas el contexto actual.",
  inputSchema: GetProjectContextInputSchema,
  riskLevel: 0,
  requiredRoles: null, // cualquier rol interno puede leer su proyecto
  handler,
});

// Export para tests / uso directo sin registry
export const getProjectContextTool = { handler, inputSchema: GetProjectContextInputSchema };
