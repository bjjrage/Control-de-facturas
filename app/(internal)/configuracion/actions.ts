"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { SalesDocType } from "@/lib/types";
import { EmpresaPlan } from "@/lib/auth";
import { generateTemplateFromImage } from "@/lib/template-gen";
import { renderTemplatePreview } from "@/lib/template";
import { isTemplateHtmlWithinLimit, sanitizeTemplateHtml } from "@/lib/template-sanitizer";
import { revalidatePath } from "next/cache";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 20 * 1024 * 1024;
const TEMPLATE_DOC_TYPES = ["PROFORMA", "REMISION", "FACTURA"] as const;

function templateField(docType: unknown): "template_proforma" | "template_remision" | "template_factura" | null {
  if (docType === "PROFORMA") return "template_proforma";
  if (docType === "REMISION") return "template_remision";
  if (docType === "FACTURA") return "template_factura";
  return null;
}

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

export async function updateEmpresaPlan(plan: EmpresaPlan): Promise<{ error: string | null }> {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();

  const { error } = await supabase
    .from("empresas")
    .update({ plan })
    .eq("id", profile.empresa_id);

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null };
}

export async function generateTemplate(formData: FormData): Promise<{ html?: string; previewHtml?: string; error?: string }> {
  await requireProfile(["admin"]);

  const file = formData.get("imagen") as File | null;
  if (!file || file.size === 0) return { error: "Seleccioná una imagen del formato." };
  if (file.size > MAX_BYTES) return { error: "La imagen no puede superar los 20MB." };
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { error: "Formato no válido. Usá JPG, PNG o WEBP." };
  }

  const formDocType = formData.get("doc_type") ?? "PROFORMA";
  if (!TEMPLATE_DOC_TYPES.includes(formDocType as (typeof TEMPLATE_DOC_TYPES)[number])) {
    return { error: "Tipo de documento no válido." };
  }
  const docType = formDocType as SalesDocType;
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await generateTemplateFromImage(bytes, file.type, docType);
  if (result.error) return { error: result.error };
  if (!isTemplateHtmlWithinLimit(result.html)) return { error: "La plantilla generada está vacía o supera el tamaño permitido." };

  const html = sanitizeTemplateHtml(result.html);
  if (!html.trim()) return { error: "La IA no generó contenido imprimible seguro." };
  return { html, previewHtml: renderTemplatePreview(html) };
}

export async function saveTemplate(empresaId: string, docType: SalesDocType, html: string) {
  const profile = await requireProfile(["admin"]);
  if (profile.empresa_id !== empresaId) return { error: "Sin permiso." };
  const field = templateField(docType);
  if (!field) return { error: "Tipo de documento no válido." };
  if (!isTemplateHtmlWithinLimit(html)) return { error: "La plantilla está vacía o supera el tamaño permitido." };
  const sanitizedHtml = sanitizeTemplateHtml(html);
  if (!sanitizedHtml.trim()) return { error: "La plantilla no contiene contenido imprimible seguro." };

  const supabase = await createClient();
  const { error } = await supabase.from("empresas").update({ [field]: sanitizedHtml }).eq("id", empresaId);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { error: null };
}

export async function deleteTemplate(empresaId: string, docType: SalesDocType) {
  const profile = await requireProfile(["admin"]);
  if (profile.empresa_id !== empresaId) return { error: "Sin permiso." };
  const field = templateField(docType);
  if (!field) return { error: "Tipo de documento no válido." };

  const supabase = await createClient();
  const { error } = await supabase.from("empresas").update({ [field]: null }).eq("id", empresaId);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { error: null };
}
