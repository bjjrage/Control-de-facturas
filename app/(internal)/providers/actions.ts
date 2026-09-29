"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Rubros del proveedor = categorías de producto que vende. Reemplaza el set
 * completo: lo que no viene tildado en el formulario deja de ser su rubro.
 */
async function syncProviderRubros(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  providerId: string,
  formData: FormData
): Promise<string | null> {
  const categoriaIds = [...new Set(formData.getAll("categoria_id").filter((v): v is string => typeof v === "string" && v !== ""))];
  const { error: delError } = await supabase
    .from("provider_categorias")
    .delete()
    .eq("provider_id", providerId)
    .eq("empresa_id", empresaId);
  if (delError) return delError.message;
  if (categoriaIds.length === 0) return null;
  const { error } = await supabase
    .from("provider_categorias")
    .insert(categoriaIds.map((categoria_id) => ({ provider_id: providerId, categoria_id, empresa_id: empresaId })));
  return error ? error.message : null;
}

export async function createProvider(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const { data: created, error } = await supabase
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

  if (error || !created) return { error: error?.message ?? "No se pudo crear el proveedor." };
  const rubrosError = await syncProviderRubros(supabase, profile.empresa_id, created.id, formData);
  revalidatePath("/providers");
  return { error: rubrosError ? `Proveedor creado, pero no se guardaron los rubros: ${rubrosError}` : null };
}

export async function updateProvider(id: string, formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const { error } = await supabase
    .from("providers")
    .update({
      name,
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      tax_id: str(formData, "tax_id"),
    })
    .eq("id", id);

  if (error) return { error: error.message };
  const rubrosError = await syncProviderRubros(supabase, profile.empresa_id, id, formData);
  revalidatePath("/providers");
  return { error: rubrosError ? `Proveedor guardado, pero no se guardaron los rubros: ${rubrosError}` : null };
}

export async function toggleProviderActive(id: string, active: boolean) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  await supabase.from("providers").update({ active }).eq("id", id);
  revalidatePath("/providers");
}
