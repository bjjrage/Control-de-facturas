"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { SalesDocType } from "@/lib/types";
import { generateTemplateFromImage } from "@/lib/template-gen";
import { revalidatePath } from "next/cache";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 20 * 1024 * 1024;

export async function updateEmpresaFields(formData: FormData) {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();

  const { error } = await supabase
    .from("empresas")
    .update({
      nombre:         String(formData.get("nombre") ?? "").trim() || undefined,
      ruc:            String(formData.get("ruc") ?? "").trim() || null,
      direccion:      String(formData.get("direccion") ?? "").trim() || null,
      telefono:       String(formData.get("telefono") ?? "").trim() || null,
      email_empresa:  String(formData.get("email_empresa") ?? "").trim() || null,
    })
    .eq("id", profile.empresa_id);

  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { error: null };
}

export async function generateTemplate(formData: FormData): Promise<{ html?: string; error?: string }> {
  await requireProfile(["admin"]);

  const file = formData.get("imagen") as File | null;
  if (!file || file.size === 0) return { error: "Seleccioná una imagen del formato." };
  if (file.size > MAX_BYTES) return { error: "La imagen no puede superar los 20MB." };
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { error: "Formato no válido. Usá JPG, PNG o WEBP." };
  }

  const docType = (formData.get("doc_type") as SalesDocType) ?? "PROFORMA";
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await generateTemplateFromImage(bytes, file.type, docType);
  if (result.error) return { error: result.error };
  return { html: result.html ?? undefined };
}

export async function saveTemplate(empresaId: string, docType: SalesDocType, html: string) {
  const profile = await requireProfile(["admin"]);
  if (profile.empresa_id !== empresaId) return { error: "Sin permiso." };

  const field =
    docType === "PROFORMA" ? "template_proforma"
    : docType === "REMISION" ? "template_remision"
    : "template_factura";

  const supabase = await createClient();
  const { error } = await supabase.from("empresas").update({ [field]: html }).eq("id", empresaId);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { error: null };
}

export async function deleteTemplate(empresaId: string, docType: SalesDocType) {
  const profile = await requireProfile(["admin"]);
  if (profile.empresa_id !== empresaId) return { error: "Sin permiso." };

  const field =
    docType === "PROFORMA" ? "template_proforma"
    : docType === "REMISION" ? "template_remision"
    : "template_factura";

  const supabase = await createClient();
  const { error } = await supabase.from("empresas").update({ [field]: null }).eq("id", empresaId);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { error: null };
}
