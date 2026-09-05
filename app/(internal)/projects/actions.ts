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

export async function updateProject(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const name = formData.get("name") as string | null;
  const client = (formData.get("client") as string | null) || null;
  const location = (formData.get("location") as string | null) || null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;
  const budgetTotal = Number(formData.get("budget_total") ?? 0);

  if (!name) return { error: "El nombre es obligatorio." };

  const { error } = await supabase
    .from("projects")
    .update({
      name,
      client,
      location,
      start_date: startDate,
      end_date: endDate,
      budget_total: Number.isFinite(budgetTotal) ? budgetTotal : 0,
    })
    .eq("id", projectId)
    .eq("empresa_id", empresaId);

  if (error) return { error: "No se pudo actualizar el proyecto." };

  await logAudit(supabase, { action: "project.updated", detail: { project_id: projectId } });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function deleteProject(projectId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { error } = await supabase.from("projects").delete().eq("id", projectId).eq("empresa_id", empresaId);
  if (error) return { error: "No se pudo eliminar el proyecto." };

  await logAudit(supabase, { action: "project.deleted", detail: { project_id: projectId } });

  revalidatePath("/projects");
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

export async function updateBudgetItem(
  projectId: string,
  itemId: string,
  formData: FormData
): Promise<{ error: string | null }> {
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

  const code = formData.get("code") as string | null;
  const description = formData.get("description") as string | null;
  const unit = (formData.get("unit") as string | null) || null;
  const quantity = formData.get("quantity") ? Number(formData.get("quantity")) : null;
  const unitPrice = formData.get("unit_price") ? Number(formData.get("unit_price")) : null;

  if (!code) return { error: "El código es obligatorio." };
  if (!description) return { error: "La descripción es obligatoria." };

  const { error } = await supabase
    .from("budget_items")
    .update({ code, description, unit, quantity, unit_price: unitPrice })
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) return { error: "No se pudo actualizar el ítem." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function deleteBudgetItem(projectId: string, itemId: string): Promise<{ error: string | null }> {
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

  const { error } = await supabase.from("budget_items").delete().eq("id", itemId).eq("project_id", projectId);
  if (error) return { error: "No se pudo eliminar el ítem." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function addExecutionEntry(
  projectId: string,
  formData: FormData
): Promise<{ error: string | null; entryId?: string }> {
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

  const { data: entry, error } = await supabase.from("execution_entries").insert({
    project_id: projectId,
    budget_item_id: budgetItemId,
    entry_date: entryDate,
    quantity_executed: quantityExecuted,
    notes,
    recorded_by: profile.id,
  }).select("id").single();

  if (error || !entry) return { error: "No se pudo registrar el avance." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null, entryId: entry.id as string };
}

/**
 * Persiste las rutas de fotos DESPUÉS de que el cliente ya las subió a
 * Storage (bucket execution-photos, ruta {project_id}/{entry_id}/{n}.jpg).
 * Separado de addExecutionEntry porque el entry_id recién existe después del
 * insert — el flujo real es: insertar entrada -> subir fotos -> guardar rutas.
 * Si esto falla, la entrada de avance ya está guardada igual; solo se pierden
 * las fotos, nunca el dato de ejecución.
 */
export async function updateExecutionEntryPhotos(
  entryId: string,
  photoPaths: string[]
): Promise<{ error: string | null }> {
  await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  // execution_entries no tiene empresa_id propio: RLS ya filtra por
  // project_id IN (SELECT id FROM projects WHERE empresa_id = current_empresa_id()).
  const { data: entry } = await supabase
    .from("execution_entries")
    .select("id")
    .eq("id", entryId)
    .single();
  if (!entry) return { error: "Entrada no encontrada." };

  const { error } = await supabase
    .from("execution_entries")
    .update({ photo_paths: photoPaths })
    .eq("id", entryId);

  if (error) return { error: "No se pudieron guardar las fotos." };

  return { error: null };
}

export type ImportedBudgetItem = {
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
};

/**
 * Inserta ítems importados de Excel, resolviendo jerarquía por código
 * ("1.1" cuelga de "1", "2.3.1" cuelga de "2.3"). Inserta por niveles de
 * profundidad — todos los padres de un nivel deben existir en la DB (y en
 * codeToId) antes de insertar sus hijos, si no el parent_id quedaría mal
 * resuelto dentro del mismo chunk. Un código cuyo padre no está en el
 * archivo se inserta plano (parent_id null), no falla el import entero.
 */
export async function importBudgetItems(
  projectId: string,
  items: ImportedBudgetItem[]
): Promise<{ inserted: number; skipped: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { inserted: 0, skipped: 0, error: "Proyecto no encontrado." };

  const valid = items.filter((i) => i.code.trim() && i.description.trim());
  const skipped = items.length - valid.length;
  if (valid.length === 0) return { inserted: 0, skipped, error: "Ningún ítem válido para importar." };

  const { data: maxRow } = await supabase
    .from("budget_items")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const depthOf = (code: string) => (code.match(/\./g) ?? []).length;
  const maxDepth = Math.max(0, ...valid.map((i) => depthOf(i.code)));

  const codeToId = new Map<string, string>();
  let insertedCount = 0;
  let lastError: string | null = null;
  const CHUNK = 100;

  for (let depth = 0; depth <= maxDepth && !lastError; depth++) {
    const levelItems = valid.filter((i) => depthOf(i.code) === depth);
    if (levelItems.length === 0) continue;

    for (let i = 0; i < levelItems.length; i += CHUNK) {
      const chunk = levelItems.slice(i, i + CHUNK);
      const rows = chunk.map((item) => {
        const dotIdx = item.code.lastIndexOf(".");
        const parentCode = dotIdx >= 0 ? item.code.slice(0, dotIdx) : null;
        const parentId = parentCode ? codeToId.get(parentCode) ?? null : null;
        return {
          project_id: projectId,
          parent_id: parentId,
          code: item.code,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unit_price: item.unit_price,
          sort_order: nextSortOrder++,
        };
      });

      const { data: insertedRows, error } = await supabase
        .from("budget_items")
        .insert(rows)
        .select("id, code");

      if (error) {
        lastError = error.message;
        break;
      }
      for (const row of insertedRows ?? []) {
        codeToId.set(row.code as string, row.id as string);
      }
      insertedCount += (insertedRows ?? []).length;
    }
  }

  if (lastError) {
    return { inserted: insertedCount, skipped, error: `Se importaron ${insertedCount} ítems antes de un error: ${lastError}` };
  }

  revalidatePath(`/projects/${projectId}`);
  return { inserted: insertedCount, skipped, error: null };
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

export type DuplicateBudgetOptions = {
  quantities: boolean;
  prices: boolean;
  dates: boolean;
};

/**
 * Copia el cómputo métrico de un proyecto a otro. Remapea parent_id por id
 * real (no por código, a diferencia de importBudgetItems) — acá ya tenemos
 * la jerarquía exacta de la DB, no hay que inferirla.
 *
 * Inserta UN ítem A LA VEZ (no en batch): un insert masivo con .select() no
 * garantiza que las filas devueltas vengan en el mismo orden que el array
 * insertado, así que no hay forma confiable de mapear id-viejo -> id-nuevo
 * por posición si se insertan varios juntos. Uno a la vez es más lento pero
 * inequívoco. Procesa por niveles (BFS desde parent_id null) para que el
 * padre siempre exista en el mapa antes de insertar sus hijos.
 *
 * depends_on se remapea recién al final, cuando todos los ids nuevos existen
 * — son ids de budget_items del proyecto origen, sin remapear quedarían
 * apuntando a filas que no existen en el proyecto destino.
 */
export async function duplicateBudgetFromProject(
  sourceProjectId: string,
  targetProjectId: string,
  opts: DuplicateBudgetOptions
): Promise<{ copied: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .in("id", [sourceProjectId, targetProjectId])
    .eq("empresa_id", empresaId);
  if ((projects ?? []).length !== 2) {
    return { copied: 0, error: "Uno de los proyectos no existe o no pertenece a tu empresa." };
  }

  const { data: sourceItems } = await supabase
    .from("budget_items")
    .select("*")
    .eq("project_id", sourceProjectId)
    .order("sort_order")
    .returns<import("@/lib/types").BudgetItem[]>();

  const items = sourceItems ?? [];
  if (items.length === 0) return { copied: 0, error: "El proyecto origen no tiene ítems." };

  const { data: maxRow } = await supabase
    .from("budget_items")
    .select("sort_order")
    .eq("project_id", targetProjectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const oldToNewId = new Map<string, string>();
  let copiedCount = 0;
  let lastError: string | null = null;

  let pending = items;
  let guard = 0; // corta si queda algo huérfano que nunca resuelve (no debería pasar)
  while (pending.length > 0 && guard < 50 && !lastError) {
    guard++;
    const ready = pending.filter((i) => i.parent_id === null || oldToNewId.has(i.parent_id));
    const notReady = pending.filter((i) => !(i.parent_id === null || oldToNewId.has(i.parent_id)));
    if (ready.length === 0) break; // huérfanos reales — se insertan planos abajo

    for (const item of ready) {
      const { data: inserted, error } = await supabase
        .from("budget_items")
        .insert({
          project_id: targetProjectId,
          parent_id: item.parent_id ? oldToNewId.get(item.parent_id) ?? null : null,
          code: item.code,
          description: item.description,
          unit: item.unit,
          quantity: opts.quantities ? item.quantity : null,
          unit_price: opts.prices ? item.unit_price : null,
          start_date: opts.dates ? item.start_date : null,
          end_date: opts.dates ? item.end_date : null,
          sort_order: nextSortOrder++,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        lastError = error?.message ?? "Error insertando ítem.";
        break;
      }
      oldToNewId.set(item.id, inserted.id as string);
      copiedCount++;
    }
    pending = notReady;
  }

  // Huérfanos que nunca resolvieron parent (no debería pasar dentro del
  // mismo proyecto, pero por las dudas se insertan planos, no se pierden).
  for (const item of pending) {
    if (lastError) break;
    const { data: inserted, error } = await supabase
      .from("budget_items")
      .insert({
        project_id: targetProjectId,
        parent_id: null,
        code: item.code,
        description: item.description,
        unit: item.unit,
        quantity: opts.quantities ? item.quantity : null,
        unit_price: opts.prices ? item.unit_price : null,
        start_date: opts.dates ? item.start_date : null,
        end_date: opts.dates ? item.end_date : null,
        sort_order: nextSortOrder++,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      lastError = error?.message ?? "Error insertando ítem.";
      break;
    }
    oldToNewId.set(item.id, inserted.id as string);
    copiedCount++;
  }

  if (lastError) {
    return { copied: copiedCount, error: `Se copiaron ${copiedCount} ítems antes de un error: ${lastError}` };
  }

  // Ahora que todos los ids nuevos existen, remapeamos depends_on.
  if (opts.dates) {
    for (const item of items) {
      if (!item.depends_on) continue;
      const newId = oldToNewId.get(item.id);
      if (!newId) continue;
      const remapped = item.depends_on
        .split(",")
        .map((oldDepId) => oldToNewId.get(oldDepId.trim()))
        .filter((x): x is string => !!x)
        .join(",");
      if (remapped) {
        await supabase.from("budget_items").update({ depends_on: remapped }).eq("id", newId);
      }
    }
  }

  await logAudit(supabase, {
    action: "project.budget_duplicated",
    detail: { source_project_id: sourceProjectId, target_project_id: targetProjectId, copied: copiedCount },
  });

  revalidatePath(`/projects/${targetProjectId}`);
  return { copied: copiedCount, error: null };
}

/**
 * Info mínima para el sidebar cuando el usuario está "dentro" de un proyecto
 * (modo carpeta): nombre + código para el banner. No usa requirePlan/notFound
 * a propósito — el Sidebar necesita degradar en silencio (volver al nav
 * global) si el proyecto no existe o el usuario no tiene plan, en vez de
 * romper toda la navegación.
 */
export async function getProjectNavInfo(
  projectId: string
): Promise<{ id: string; name: string; code: string } | null> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id, name, code")
      .eq("id", projectId)
      .eq("empresa_id", profile.empresa_id)
      .single();
    return data ?? null;
  } catch {
    return null;
  }
}
