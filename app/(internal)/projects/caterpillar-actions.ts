"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addLaborEntry(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const workerName = (formData.get("worker_name") as string | null)?.trim();
  const hours = Number(formData.get("hours") ?? 0);
  const hourlyCost = Number(formData.get("hourly_cost") ?? 0);
  const entryDate = (formData.get("entry_date") as string | null) || new Date().toISOString().slice(0, 10);
  const taskDescription = (formData.get("task_description") as string | null) || null;

  if (!workerName) return { error: "El nombre del trabajador es obligatorio." };
  if (!(hours > 0)) return { error: "Las horas deben ser mayores a cero." };

  const { error } = await supabase.from("daily_labor_entries").insert({
    project_id: projectId,
    entry_date: entryDate,
    worker_name: workerName,
    hours,
    hourly_cost: hourlyCost,
    task_description: taskDescription,
    recorded_by: profile.id,
  });

  if (error) return { error: "No se pudo registrar el parte." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
