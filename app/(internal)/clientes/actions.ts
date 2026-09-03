"use server";

import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function createClientRecord(formData: FormData) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const { error } = await supabase.from("clients").insert({
    name,
    tax_id: str(formData, "tax_id"),
    contact_name: str(formData, "contact_name"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    address: str(formData, "address"),
    payment_terms: str(formData, "payment_terms"),
  });
  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { error: null };
}

export async function updateClientRecord(id: string, formData: FormData) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const name = str(formData, "name");
  if (!name) return { error: "El nombre es obligatorio." };

  const { error } = await supabase
    .from("clients")
    .update({
      name,
      tax_id: str(formData, "tax_id"),
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      address: str(formData, "address"),
      payment_terms: str(formData, "payment_terms"),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return { error: null };
}

export async function toggleClientActive(id: string, active: boolean) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  await supabase.from("clients").update({ active }).eq("id", id);
  revalidatePath("/clientes");
}
