"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { UserRole } from "@/lib/types";
import { revalidatePath } from "next/cache";

const ROLES: UserRole[] = ["comercial", "administracion", "admin"];

export async function createUser(formData: FormData) {
  await requireProfile(["admin"]);

  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !fullName) return { error: "Email y nombre son obligatorios." };
  if (!ROLES.includes(role as UserRole)) return { error: "Rol inválido." };
  if (password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres." };

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return { error: createError?.message ?? "No se pudo crear el usuario." };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    email,
    full_name: fullName,
    role,
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/users");
  return { error: null };
}

export async function updateUserRole(id: string, role: UserRole) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  await supabase.from("profiles").update({ role }).eq("id", id);
  revalidatePath("/users");
}

export async function toggleUserActive(id: string, active: boolean) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  await supabase.from("profiles").update({ active }).eq("id", id);
  revalidatePath("/users");
}
