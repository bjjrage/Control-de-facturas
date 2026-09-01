"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function createProvider(formData: FormData) {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const { error } = await supabase.from("providers").insert({
    name,
    contact_name: str(formData, "contact_name"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    tax_id: str(formData, "tax_id"),
  });

  if (error) return { error: error.message };
  revalidatePath("/providers");
  return { error: null };
}

export async function updateProvider(id: string, formData: FormData) {
  await requireProfile(["admin"]);
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
  revalidatePath("/providers");
  return { error: null };
}

export async function toggleProviderActive(id: string, active: boolean) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  await supabase.from("providers").update({ active }).eq("id", id);
  revalidatePath("/providers");
}
