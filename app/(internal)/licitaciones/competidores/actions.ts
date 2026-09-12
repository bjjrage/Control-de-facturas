"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = await createClient();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  return { supabase, profile };
}

/**
 * Excluye uno o varios competidores del Radar de la empresa actual (Tenant-Isolated).
 * INVARIANTE: NUNCA elimina registros de procurement_suppliers, bids ni procesos públicos.
 */
export async function excluirCompetidoresRadar(
  supplierIds: string[],
  reason?: string
): Promise<{ success: boolean; excludedCount: number; error?: string }> {
  if (!supplierIds || supplierIds.length === 0) {
    return { success: false, excludedCount: 0, error: "No se seleccionaron competidores" };
  }

  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  const rows = supplierIds.map((supplierId) => ({
    empresa_id: empresaId,
    supplier_id: supplierId,
    reason: reason?.trim() || "Exclusión manual desde Radar",
    created_by: profile.id,
  }));

  const { error } = await supabase
    .from("empresa_competitor_exclusions")
    .upsert(rows, { onConflict: "empresa_id,supplier_id" });

  if (error) {
    console.error("Error al excluir competidores:", error);
    return { success: false, excludedCount: 0, error: error.message };
  }

  await logAudit(supabase, {
    action: "tender.competitors_excluded_from_radar",
    detail: {
      empresa_id: empresaId,
      count: supplierIds.length,
      supplier_ids: supplierIds,
      reason: reason || null,
    },
  });

  revalidatePath("/licitaciones/competidores");
  return { success: true, excludedCount: supplierIds.length };
}

/**
 * Restaura uno o varios competidores al Radar de la empresa actual (Reversible e idempotente).
 */
export async function restaurarCompetidoresRadar(
  supplierIds: string[]
): Promise<{ success: boolean; restoredCount: number; error?: string }> {
  if (!supplierIds || supplierIds.length === 0) {
    return { success: false, restoredCount: 0, error: "No se seleccionaron competidores" };
  }

  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  const { error } = await supabase
    .from("empresa_competitor_exclusions")
    .delete()
    .eq("empresa_id", empresaId)
    .in("supplier_id", supplierIds);

  if (error) {
    console.error("Error al restaurar competidores:", error);
    return { success: false, restoredCount: 0, error: error.message };
  }

  await logAudit(supabase, {
    action: "tender.competitors_restored_to_radar",
    detail: {
      empresa_id: empresaId,
      count: supplierIds.length,
      supplier_ids: supplierIds,
    },
  });

  revalidatePath("/licitaciones/competidores");
  return { success: true, restoredCount: supplierIds.length };
}
