"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Vincula un proveedor ya existente a la obra (shortlist, sin necesidad de OC). */
export async function linkProviderToProject(projectId: string, providerId: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_providers")
    .insert({ project_id: projectId, provider_id: providerId });

  if (error) {
    return {
      error: error.code === "23505" ? "Ese proveedor ya está en la obra." : error.message,
    };
  }
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/** Crea un proveedor nuevo y lo vincula a la obra en el mismo paso. */
export async function createProviderForProject(projectId: string, formData: FormData) {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const { data: provider, error } = await supabase
    .from("providers")
    .insert({
      name,
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      tax_id: str(formData, "tax_id"),
    })
    .select("id")
    .single();

  if (error || !provider) return { error: error?.message ?? "No se pudo crear el proveedor." };

  const { error: linkError } = await supabase
    .from("project_providers")
    .insert({ project_id: projectId, provider_id: provider.id });
  if (linkError) return { error: linkError.message };

  revalidatePath("/providers");
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/** Saca a un proveedor de la obra (solo el vínculo manual — si ya tiene una
 *  OC vinculada va a seguir apareciendo en la lista igual, por la OC). */
export async function unlinkProviderFromProject(projectId: string, providerId: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  await supabase
    .from("project_providers")
    .delete()
    .eq("project_id", projectId)
    .eq("provider_id", providerId);
  revalidatePath(`/projects/${projectId}`);
}
