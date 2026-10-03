"use server";

import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rpc } from "@/lib/rfq/service";
import { loadWeeklyPlanBaseData } from "@/lib/procurement/weekly-plan-shared";
import { calculateWeeklyPlanRequirements, type WeeklyPlanItemTargetInput } from "@/lib/procurement/weekly-plan-engine";
import { buildMrpPreview } from "@/lib/procurement/weekly-plan-coverage";
import type { MrpPreviewResult } from "./weekly-plan-actions";

export interface SavedNeed {
  id: string; producto_id: string; quantity: number;
  decision: { kind: "RFQ" | "DIRECT_PURCHASE"; rfq_id: string | null; direct_purchase_preview_id: string | null; order_id?: string | null } | null;
}
export interface NeedRefreshResult {
  snapshot_id: string; hash: string; history?: Array<{id:string;kind:string;rfq_id:string|null;order_id:string|null}>; needs: SavedNeed[]; coverage: MrpPreviewResult;
}

// Quantities are computed only from the saved plan and current canonical DB inputs.
// A source hash checked inside the write transaction rejects interleaved mutations.
export async function refreshWeeklyPlanNeedsAction(planId: string, seen: Record<string, unknown>) {
  try {
    const actor = await requirePlan("pro", ["administracion", "admin"]);
    if (!actor.active) throw new Error("Cuenta inactiva");
    const db = await createClient();
    const source = await rpc<{ hash: string; facts: {
      plan: { project_id: string; empresa_id: string; start_date: string; end_date: string; status: "DRAFT" | "COMMITTED" | "CLOSED" };
      targets: Array<WeeklyPlanItemTargetInput & { unit: string }>;
    } }>(db, "weekly_plan_need_sources", { p_plan_id: planId });
    const plan = source.facts.plan;
    if (plan.empresa_id !== actor.empresa_id || plan.status === "CLOSED") throw new Error("Plan activo requerido");
    const reference = seen.plan as { startDate?: string; endDate?: string; items?: WeeklyPlanItemTargetInput[] } | undefined;
    const normalize = (items: WeeklyPlanItemTargetInput[]) => items.filter(i=>Number(i.input_value)>0).map(i=>({
      budget_item_id:i.budget_item_id, front_label:i.front_label?.trim() || null,
      input_mode:i.input_mode, input_value:Number(i.input_value),
    }));
    if (!reference || reference.startDate!==plan.start_date || reference.endDate!==plan.end_date || !Array.isArray(reference.items)
      || JSON.stringify(normalize(reference.items))!==JSON.stringify(normalize(source.facts.targets))) {
      throw new Error("Guardá las metas y el período actuales antes de iniciar una compra.");
    }
    const base = await loadWeeklyPlanBaseData(db, plan.project_id, actor.empresa_id);
    if (!base.data || base.error) throw new Error(base.error || "Fuentes no disponibles");
    const b = base.data;
    const calculation = calculateWeeklyPlanRequirements({
      plan_id: planId, project_id: plan.project_id, start_date: plan.start_date, end_date: plan.end_date,
      status: plan.status, budget_items: b.budgetItems, targets: source.facts.targets,
      executed_quantities_by_item: b.executedQuantities, materials_by_item: b.materialsByItem,
      labor_by_item: b.laborByItem, equipment_by_item: b.equipmentByItem, subcontracts_by_item: b.subcontractsByItem,
      stock_and_inbound: Object.fromEntries(Object.entries(b.stockAndInbound).map(([id,v])=>[id,{...v,oc_inbound:0}])),
      recent_execution_entries: b.recentEntries, weather_overlay_enabled: false,
    });
    const coverage = await buildMrpPreview(db, actor.empresa_id, calculation, b.materialsByItem, b, plan.end_date);
    const saved = await rpc<Omit<NeedRefreshResult, "coverage">>(createAdminClient(), "weekly_plan_refresh_needs", {
      p_actor_id: actor.id, p_plan_id: planId, p_hash: source.hash,
      p_needed_by: plan.end_date, p_lines: coverage.lines, p_seen: seen,
    });
    return { data: { ...saved, coverage }, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "No se pudo actualizar la necesidad" };
  }
}
