// READ tool LEVEL 0 — progreso, planificación, certificados y clima de una obra.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { getWeeklyPlanOverviewTool } from "./get-weekly-plan-overview";

export const GetProjectOperationalOverviewInputSchema = z.object({ project_id: z.string().uuid() });
export type GetProjectOperationalOverviewInput = z.infer<typeof GetProjectOperationalOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetProjectOperationalOverviewInput, deps: { db: SupabaseClient }) {
  const { db } = deps;
  const { data: project, error: projectError } = await db.from("projects").select("id, name, code, status").eq("id", input.project_id).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (projectError) throw new Error(`Error leyendo la obra: ${projectError.message}`);
  if (!project) throw new Error("La obra no existe o no pertenece a tu empresa.");
  const [budget, execution, certificates, climateEvents, workdays, evidence, weekly] = await Promise.all([
    db.from("budget_items").select("id, code, description, unit, quantity, unit_price, subtotal, parent_id, sort_order").eq("project_id", input.project_id).order("sort_order"),
    db.from("execution_entries").select("id, budget_item_id, entry_date, quantity_executed, notes, created_at").eq("project_id", input.project_id).order("entry_date", { ascending: false }),
    db.from("project_certificates").select("id, numero, period_start, period_end, status, monto_anterior, monto_presente, monto_acumulado, notes, created_at, closed_at").eq("project_id", input.project_id).order("numero", { ascending: false }),
    db.from("climate_events").select("*").eq("project_id", input.project_id).order("event_date", { ascending: false }).limit(90),
    db.from("project_workday_status").select("*").eq("project_id", input.project_id).order("work_date", { ascending: false }).limit(90),
    db.from("climate_evidence").select("*").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(180),
    getWeeklyPlanOverviewTool.handler(ctx, { project_id: input.project_id, limit: 4 }, deps),
  ]);
  for (const result of [budget, execution, certificates, climateEvents, workdays, evidence]) {
    if (result.error) throw new Error(`Error leyendo operación de obra: ${result.error.message}`);
  }
  return { project, budget_items: budget.data ?? [], execution_entries: execution.data ?? [], certificates: certificates.data ?? [], climate_events: climateEvents.data ?? [], workdays: workdays.data ?? [], climate_evidence: evidence.data ?? [], weekly_plans: weekly.plans };
}

registerTool({
  name: "get_project_operational_overview",
  description: "Lee por composición las fuentes reales de una obra: partidas, avance ejecutado, planificación semanal, certificados, eventos climáticos, jornadas perdidas y evidencia. Solo lectura; no materializa un informe inventado.",
  inputSchema: GetProjectOperationalOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getProjectOperationalOverviewTool = { handler, inputSchema: GetProjectOperationalOverviewInputSchema };
