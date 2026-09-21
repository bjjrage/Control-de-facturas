// READ tool LEVEL 0 — planificación semanal real.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetWeeklyPlanOverviewInputSchema = z.object({
  project_id: z.string().uuid(),
  limit: z.number().int().min(1).max(8).default(4),
});

export type GetWeeklyPlanOverviewInput = z.infer<typeof GetWeeklyPlanOverviewInputSchema>;

export interface GetWeeklyPlanOverviewOutput {
  project_id: string;
  plans: Array<{
    id: string;
    start_date: string;
    end_date: string;
    status: string;
    notes: string | null;
    items: Array<Record<string, unknown>>;
  }>;
}

async function handler(
  ctx: AgentToolContext,
  input: GetWeeklyPlanOverviewInput,
  deps: { db: SupabaseClient }
): Promise<GetWeeklyPlanOverviewOutput> {
  const { data: project, error: projectError } = await deps.db
    .from("projects")
    .select("id")
    .eq("id", input.project_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (projectError) throw new Error(`Error validando la obra: ${projectError.message}`);
  if (!project) throw new Error("La obra no existe o no pertenece a tu empresa.");

  const { data: plans, error: planError } = await deps.db
    .from("project_weekly_plans")
    .select("id, start_date, end_date, status, notes")
    .eq("empresa_id", ctx.empresaId)
    .eq("project_id", input.project_id)
    .order("start_date", { ascending: false })
    .limit(input.limit);
  if (planError) throw new Error(`Error leyendo planificación semanal: ${planError.message}`);

  const planRows = (plans ?? []) as Array<{ id: string; start_date: string; end_date: string; status: string; notes: string | null }>;
  const planIds = planRows.map((plan) => plan.id);
  if (planIds.length === 0) return { project_id: input.project_id, plans: [] };

  const { data: items, error: itemError } = await deps.db
    .from("project_weekly_plan_items")
    .select("id, plan_id, budget_item_id, front_label, input_mode, input_value, target_quantity, unit")
    .in("plan_id", planIds);
  if (itemError) throw new Error(`Error leyendo ítems de planificación: ${itemError.message}`);

  const itemsByPlan = new Map<string, Array<Record<string, unknown>>>();
  for (const item of (items ?? []) as Array<Record<string, unknown>>) {
    const planId = String(item.plan_id);
    const list = itemsByPlan.get(planId) ?? [];
    list.push(item);
    itemsByPlan.set(planId, list);
  }
  return {
    project_id: input.project_id,
    plans: planRows.map((plan) => ({ ...plan, items: itemsByPlan.get(plan.id) ?? [] })),
  };
}

registerTool<GetWeeklyPlanOverviewInput, GetWeeklyPlanOverviewOutput>({
  name: "get_weekly_plan_overview",
  description:
    "Lee los planes semanales reales de una obra y sus ítems comprometidos. Usar para analizar la semana actual/siguiente y combinar luego con stock, materiales y compras.",
  inputSchema: GetWeeklyPlanOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getWeeklyPlanOverviewTool = { handler, inputSchema: GetWeeklyPlanOverviewInputSchema };
