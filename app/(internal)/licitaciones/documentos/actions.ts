"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = await createClient();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  return { supabase, profile };
}

export type DocumentoInput = {
  tipo: string;
  descripcion?: string;
  fecha_emision?: string | null;
  fecha_vencimiento?: string | null;
  notas?: string;
};

export async function crearDocumentoEmpresa(data: DocumentoInput): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await ctx();
  if (!data.tipo.trim()) return { error: "El tipo es obligatorio" };

  const { data: row, error } = await supabase
    .from("empresa_documentos")
    .insert({
      empresa_id: profile.empresa_id,
      tipo: data.tipo.trim(),
      descripcion: data.descripcion?.trim() || null,
      fecha_emision: data.fecha_emision || null,
      fecha_vencimiento: data.fecha_vencimiento || null,
      notas: data.notas?.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/licitaciones/documentos");
  revalidatePath("/dashboard");
  return { id: row.id };
}

export async function actualizarDocumentoEmpresa(
  id: string,
  data: Partial<DocumentoInput>
): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.tipo !== undefined) patch.tipo = data.tipo.trim();
  if (data.descripcion !== undefined) patch.descripcion = data.descripcion?.trim() || null;
  if (data.fecha_emision !== undefined) patch.fecha_emision = data.fecha_emision || null;
  if (data.fecha_vencimiento !== undefined) patch.fecha_vencimiento = data.fecha_vencimiento || null;
  if (data.notas !== undefined) patch.notas = data.notas?.trim() || null;

  const { error } = await supabase.from("empresa_documentos").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/licitaciones/documentos");
  revalidatePath("/dashboard");
  return {};
}

export async function eliminarDocumentoEmpresa(id: string): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const { error } = await supabase.from("empresa_documentos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/licitaciones/documentos");
  revalidatePath("/dashboard");
  return {};
}
