"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { workspaceChangeSchema, type BudgetWorkspaceChange, type BudgetWorkspaceRow } from "@/lib/projects/budget-workspace";

/** Same budget table, tenant policies and generated subtotal as the existing
 * editor. Each row is an atomic compare-and-set, with explicit partial results. */
export async function saveBudgetWorkspace(projectId: string, input: BudgetWorkspaceChange[]): Promise<{
  saved: BudgetWorkspaceRow[]; failed: { id: string; error: string }[]; error?: string;
}> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const parsed = z.array(workspaceChangeSchema).min(1).max(50).safeParse(input);
  if (!parsed.success || new Set(input.map(row => row.id)).size !== input.length) {
    return { saved: [], failed: [], error: "Los cambios no son válidos. No se guardó ninguna fila de este lote." };
  }
  const db = await createClient();
  const { data: project, error: projectError } = await db.from("projects").select("id").eq("id", projectId).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (projectError || !project) return { saved: [], failed: [], error: "No se pudo acceder a esta obra." };

  const saved: BudgetWorkspaceRow[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const change of parsed.data) {
    const { next, expected } = change;
    let query = db.from("budget_items").update({
      description: next.description, unit: next.unit, quantity: next.quantity, unit_price: next.unitPrice,
    }).eq("id", change.id).eq("project_id", projectId);
    // Never overwrite a colleague's newer edit. Dates, hierarchy, APU links and
    // certificates are deliberately absent from this patch.
    const previous = { description: expected.description, unit: expected.unit, quantity: expected.quantity, unit_price: expected.unitPrice };
    for (const [key, value] of Object.entries(previous)) query = value === null ? query.is(key, null) : query.eq(key, value);
    const { data, error } = await query.select("id,code,description,unit,quantity,unit_price,subtotal").maybeSingle();
    if (error) failed.push({ id: change.id, error: "No se pudo guardar esta partida. Sus cambios siguen pendientes." });
    else if (!data) failed.push({ id: change.id, error: "La partida cambió o fue eliminada. Recargá los datos y revisá sus cambios antes de volver a guardar." });
    else saved.push({ id: data.id, code: data.code, description: data.description, unit: data.unit, quantity: data.quantity, unitPrice: data.unit_price, subtotal: data.subtotal });
  }
  if (saved.length) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/workspace`);
  }
  return { saved, failed };
}
