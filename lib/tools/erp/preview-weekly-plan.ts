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
export const PreviewWeeklyPlanInputSchema = z.object({
  project_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather_overlay: z.boolean().default(false),
  items: z.array(item).default([]),
  mrp: z.object({ mode: z.literal("MRP"), needed_by_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional(),
}).superRefine((input, ctx) => {
  const neededBy = input.mrp?.needed_by_date ?? input.end_date;
  if (input.mrp && (neededBy < input.start_date || neededBy > input.end_date)) {
    ctx.addIssue({
      code: "custom",
      path: ["mrp", "needed_by_date"],
      message: "MRP needed_by_date must fall within the plan period.",
    });
  }
});
export type PreviewWeeklyPlanInput = z.infer<typeof PreviewWeeklyPlanInputSchema>;

async function handler(_ctx: AgentToolContext, input: PreviewWeeklyPlanInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/weekly-plan-actions");
  const result = await actions.previewWeeklyPlanAction({
    projectId: input.project_id,
    startDate: input.start_date,
    endDate: input.end_date,
    weatherOverlay: input.weather_overlay,
    items: input.items.map((row) => ({
      budgetItemId: row.budget_item_id,
      frontLabel: row.front_label ?? null,
      inputMode: row.input_mode,
      inputValue: row.input_value,
      unit: row.unit,
    })),
    coverage: input.mrp ? { mode: "MRP", neededByDate: input.mrp.needed_by_date } : undefined,
  });
  return actionResult(result);
}

registerTool<PreviewWeeklyPlanInput, Record<string, unknown>>({
  name: "preview_weekly_plan",
  description: "Calcula un plan semanal real sin guardarlo: usa el motor de planificación, ejecución, BOM, stock, inbound y opcionalmente MRP/clima. No modifica el plan.",
  inputSchema: PreviewWeeklyPlanInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const previewWeeklyPlanTool = { handler, inputSchema: PreviewWeeklyPlanInputSchema };
