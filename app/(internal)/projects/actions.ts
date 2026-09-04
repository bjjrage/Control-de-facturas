"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/lib/types";

export async function createProject(formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const name = formData.get("name") as string | null;
  const code = formData.get("code") as string | null;
  const client = (formData.get("client") as string | null) || null;
  const location = (formData.get("location") as string | null) || null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;
  const budgetTotal = Number(formData.get("budget_total") ?? 0);

  if (!name) return { error: "El nombre es obligatorio." };
  if (!code) return { error: "El código es obligatorio." };

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      empresa_id: empresaId,
      name,
      code,
      client,
      location,
      start_date: startDate,
      end_date: endDate,
      budget_total: Number.isFinite(budgetTotal) ? budgetTotal : 0,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !project) {
    const dup = error?.code === "23505";
    return { error: dup ? `Ya existe un proyecto con el código "${code}".` : (error?.message ?? "No se pudo crear el proyecto.") };
  }

  await logAudit(supabase, {
    action: "project.created",
    detail: { project_id: project.id, code },
  });

  revalidatePath("/projects");
  return { error: null };
}

export async function updateProjectStatus(projectId: string, status: ProjectStatus): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId)
    .eq("empresa_id", empresaId);

  if (error) return { error: "No se pudo actualizar el estado del proyecto." };

  await logAudit(supabase, {
    action: "project.status_updated",
    detail: { project_id: projectId, status },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function addBudgetItem(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  // Verifica pertenencia del proyecto a la empresa antes de insertar el ítem
  // (budget_items no tiene empresa_id propio, se deriva vía project_id en RLS).
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const code = formData.get("code") as string | null;
  const description = formData.get("description") as string | null;
  const unit = (formData.get("unit") as string | null) || null;
  const quantity = formData.get("quantity") ? Number(formData.get("quantity")) : null;
  const unitPrice = formData.get("unit_price") ? Number(formData.get("unit_price")) : null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;

  if (!code) return { error: "El código es obligatorio." };
  if (!description) return { error: "La descripción es obligatoria." };

  const { data: maxRow } = await supabase
    .from("budget_items")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("budget_items").insert({
    project_id: projectId,
    code,
    description,
    unit,
    quantity,
    unit_price: unitPrice,
    start_date: startDate,
    end_date: endDate,
    sort_order: nextSortOrder,
  });

  if (error) return { error: "No se pudo agregar el ítem." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function addExecutionEntry(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const budgetItemId = formData.get("budget_item_id") as string | null;
  const quantityExecuted = Number(formData.get("quantity_executed") ?? 0);
  const entryDate = (formData.get("entry_date") as string | null) || new Date().toISOString().slice(0, 10);
  const notes = (formData.get("notes") as string | null) || null;

  if (!budgetItemId) return { error: "Seleccioná un ítem del presupuesto." };
  if (!(quantityExecuted > 0)) return { error: "La cantidad ejecutada debe ser mayor a cero." };

  const { error } = await supabase.from("execution_entries").insert({
    project_id: projectId,
    budget_item_id: budgetItemId,
    entry_date: entryDate,
    quantity_executed: quantityExecuted,
    notes,
    recorded_by: profile.id,
  });

  if (error) return { error: "No se pudo registrar el avance." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function updateBudgetItemSchedule(
  itemId: string,
  startDate: string | null,
  endDate: string | null,
  dependsOn: string | null
): Promise<{ error: string | null }> {
  await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  // budget_items no tiene empresa_id propio: RLS ya filtra por
  // project_id IN (SELECT id FROM projects WHERE empresa_id = current_empresa_id()),
  // así que un select/update que no matchee esa política simplemente no afecta filas.
  const { data: item, error: fetchError } = await supabase
    .from("budget_items")
    .select("id, project_id")
    .eq("id", itemId)
    .single();
  if (fetchError || !item) return { error: "Ítem no encontrado." };

  const { error } = await supabase
    .from("budget_items")
    .update({ start_date: startDate, end_date: endDate, depends_on: dependsOn })
    .eq("id", itemId);

  if (error) return { error: "No se pudo actualizar el cronograma." };

  revalidatePath(`/projects/${item.project_id}`);
  return { error: null };
}
