// app/(internal)/agent/activity/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { cancelTask } from "@/lib/agent/resume";

export async function cancelAgentTaskAction(params: { taskId: string; reason?: string }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const result = await cancelTask({
    db: supabase as never,
    taskId: params.taskId,
    empresaId: profile.empresa_id,
    reason: params.reason ?? "Cancelled by user",
  });
  if (!result.success) return { error: result.error ?? "No se pudo cancelar" };
  return { error: null };
}
