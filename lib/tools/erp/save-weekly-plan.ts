import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

const item = z.object({
  budget_item_id: z.string().uuid(),
  front_label: z.string().trim().max(160).optional().nullable(),
  input_mode: z.enum(["QUANTITY", "CONTRACT_PERCENTAGE_POINTS"]),
  input_value: z.number().finite().nonnegative(),
  unit: z.string().trim().min(1).max(40),
});
export const SaveWeeklyPlanInputSchema = z.object({
  plan_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["DRAFT", "COMMITTED", "CLOSED"]),
  notes: z.string().trim().max(2000).optional().nullable(),
  weather_snapshot_batch_id: z.string().uuid().optional().nullable(),
  items: z.array(item),
  mrp_commit: z.object({
    lines: z.array(z.object({ producto_id: z.string().uuid(), quantity: z.number().positive().finite() })),
    needed_by_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).optional(),
}).superRefine((input, ctx) => {
  if (input.status === "COMMITTED" && !input.mrp_commit) {
    ctx.addIssue({
      code: "custom",
      path: ["mrp_commit"],
      message: "A committed plan requires a current MRP preview reference.",
    });
  }
});
export type SaveWeeklyPlanInput = z.infer<typeof SaveWeeklyPlanInputSchema>;

async function handler(_ctx: AgentToolContext, input: SaveWeeklyPlanInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/weekly-plan-actions");
  const result = await actions.saveWeeklyPlanAction({
    planId: input.plan_id ?? undefined,
    projectId: input.project_id,
    startDate: input.start_date,
    endDate: input.end_date,
    status: input.status,
    notes: input.notes ?? null,
    weatherSnapshotBatchId: input.weather_snapshot_batch_id ?? null,
    items: input.items.map((row) => ({
      budgetItemId: row.budget_item_id,
      frontLabel: row.front_label ?? null,
      inputMode: row.input_mode,
      inputValue: row.input_value,
      unit: row.unit,
    })),
    mrpCommit: input.mrp_commit ? {
      lines: input.mrp_commit.lines.map((line) => ({ producto_id: line.producto_id, quantity: line.quantity })),
      neededByDate: input.mrp_commit.needed_by_date,
    } : undefined,
  });
  return actionResult(result);
}

registerTool<SaveWeeklyPlanInput, Record<string, unknown>>({
  name: "save_weekly_plan",
  description: "Guarda o compromete un plan semanal real mediante la acción y RPC atómica existentes. COMMITTED requiere una referencia MRP vigente, recalcula cobertura y reserva materiales atómicamente; requiere aprobación.",
  inputSchema: SaveWeeklyPlanInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const saveWeeklyPlanTool = { handler, inputSchema: SaveWeeklyPlanInputSchema };
