"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const MAX_PHOTOS = 5;

/**
 * Registra un parte de avance desde el link público del capataz — sin
 * usuario logueado, así que todo corre con service role y el acceso queda
 * gateado únicamente por conocer el token (igual que /certificados/[token]).
 */
export async function submitAvance(token: string, formData: FormData): Promise<{ error: string | null }> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, status")
    .eq("execution_token", token)
    .maybeSingle();
  if (!project) return { error: "Enlace inválido." };
  if (project.status !== "ACTIVO") return { error: "Esta obra no está activa — no se puede cargar avance." };

  const budgetItemId = (formData.get("budget_item_id") as string | null) || null;
  const entryDate = (formData.get("entry_date") as string | null) || null;
  const quantity = Number(formData.get("quantity_executed") ?? 0);
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (!budgetItemId) return { error: "Elegí un ítem." };
  if (!entryDate) return { error: "Falta la fecha." };
  if (!(quantity > 0)) return { error: "La cantidad debe ser mayor a cero." };

  const { data: item } = await admin
    .from("budget_items")
    .select("id")
    .eq("id", budgetItemId)
    .eq("project_id", project.id)
    .maybeSingle();
  if (!item) return { error: "Ítem inválido para esta obra." };

  const { data: entry, error } = await admin
    .from("execution_entries")
    .insert({
      project_id: project.id,
      budget_item_id: budgetItemId,
      entry_date: entryDate,
      quantity_executed: quantity,
      notes,
      submitted_by_portal: true,
    })
    .select("id")
    .single();
  if (error || !entry) return { error: "No se pudo registrar el avance." };

  // Fotos: ya llegan comprimidas del cliente (ver avance-form.tsx). Falla
  // silenciosa por foto — el parte de avance en sí ya quedó guardado.
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const paths: string[] = [];
  for (let i = 0; i < Math.min(files.length, MAX_PHOTOS); i++) {
    const file = files[i];
    const path = `${project.id}/${entry.id}/${i}.jpg`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const up = await admin.storage
      .from("execution-photos")
      .upload(path, bytes, { contentType: file.type || "image/jpeg" });
    if (!up.error) paths.push(path);
  }
  if (paths.length > 0) {
    await admin.from("execution_entries").update({ photo_paths: paths }).eq("id", entry.id);
  }

  revalidatePath(`/avance/${token}`);
  return { error: null };
}
