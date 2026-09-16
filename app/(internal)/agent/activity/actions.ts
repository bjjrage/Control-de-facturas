// app/(internal)/agent/activity/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { cancelTask } from "@/lib/agent/resume";
import { revalidatePath } from "next/cache";

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
  revalidatePath("/agent/activity");
  return { error: null };
}

export async function cancelAgentTaskFormAction(formData: FormData): Promise<void> {
  const taskId = formData.get("taskId");
  if (typeof taskId !== "string" || !taskId) throw new Error("Task invalida");
  const result = await cancelAgentTaskAction({ taskId });
  if (result.error) throw new Error(result.error);
}
