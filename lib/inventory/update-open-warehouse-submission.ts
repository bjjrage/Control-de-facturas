import type { createAdminClient } from "@/lib/supabase/admin";

export async function updateOpenWarehouseSubmission(
  admin: ReturnType<typeof createAdminClient>,
  submissionId: string,
  empresaId: string,
  patch: { status?: "NEEDS_REVIEW"; processing_error: string | null },
): Promise<boolean> {
  const { data, error } = await admin.from("warehouse_submissions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", submissionId)
    .eq("empresa_id", empresaId)
    .in("status", ["UPLOADED", "NEEDS_REVIEW"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
