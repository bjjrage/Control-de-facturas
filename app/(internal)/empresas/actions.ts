"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth";
import { UserRole } from "@/lib/types";
import { revalidatePath } from "next/cache";

const ROLES: UserRole[] = ["comercial", "administracion", "admin"];

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export async function createEmpresa(formData: FormData) {
  await requireSuperAdmin();

  const nombre = String(formData.get("nombre") ?? "").trim();
  if (!nombre) return { error: "El nombre es obligatorio." };

  const slug = slugify(String(formData.get("slug") ?? "").trim() || nombre) || null;

  const admin = createAdminClient();
  const { error } = await admin.from("empresas").insert({ nombre, slug });
  if (error) {
    return { error: error.code === "23505" ? "Ya existe una empresa con ese identificador." : error.message };
  }

  revalidatePath("/empresas");
  return { error: null };
}

export async function createEmpresaAdmin(formData: FormData) {
  await requireSuperAdmin();

  const empresaId = String(formData.get("empresa_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "admin");
  const password = String(formData.get("password") ?? "");

  if (!empresaId) return { error: "Empresa inválida." };
  if (!email || !fullName) return { error: "Email y nombre son obligatorios." };
  if (!ROLES.includes(role as UserRole)) return { error: "Rol inválido." };
  if (password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres." };

  const admin = createAdminClient();

  const { data: empresa } = await admin.from("empresas").select("id").eq("id", empresaId).maybeSingle();
  if (!empresa) return { error: "Empresa no encontrada." };

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
    empresa_id: empresaId,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/empresas");
  return { error: null };
}

export async function toggleEmpresaActive(empresaId: string, active: boolean) {
  const me = await requireSuperAdmin();
  if (empresaId === me.empresa_id) return { error: "No podés desactivar tu propia empresa." };

  const admin = createAdminClient();
  const { error } = await admin.from("empresas").update({ active }).eq("id", empresaId);
  if (error) return { error: error.message };

  revalidatePath("/empresas");
  return { error: null };
}
