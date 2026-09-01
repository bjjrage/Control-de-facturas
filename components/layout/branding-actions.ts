"use server";

import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

import { LOGO_STORAGE_PATH } from "./branding-constants";

// PDF logos aren't accepted here: rendering one to PNG needs @napi-rs/canvas
// (a native binary), which is fragile in serverless environments like
// Vercel. Reading PDF *text* (invoices) doesn't touch that code path at all,
// so that feature is unaffected — this restriction is specific to the logo.
const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export async function uploadLogo(formData: FormData) {
  await requireProfile(["admin"]);

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Elegí una imagen." };
  if (file.size > MAX_LOGO_BYTES) return { error: "El archivo no puede superar los 5MB." };
  if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
    return { error: "Formato no soportado. Usá PNG, JPG, WEBP o SVG (PDF no está soportado para el logo)." };
  }

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("branding")
    .upload(LOGO_STORAGE_PATH, file, { contentType: file.type, upsert: true });
  if (error) return { error: "No se pudo subir el logo: " + error.message };

  revalidatePath("/", "layout");
  return { error: null };
}
