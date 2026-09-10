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

  // Sync to Company Bid Vault (Gate 9)
  try {
    const tipoLower = data.tipo.toLowerCase();
    let categoria: 'LEGAL' | 'FISCAL' | 'FINANCIERO' | 'EXPERIENCIA' | 'PERSONAL' | 'MAQUINARIA' | 'OTRO' = 'OTRO';
    if (tipoLower.includes('tributario') || tipoLower.includes('set') || tipoLower.includes('dnit') || tipoLower.includes('ips') || tipoLower.includes('deudor') || tipoLower.includes('seguridad social')) {
      categoria = 'FISCAL';
    } else if (tipoLower.includes('poder') || tipoLower.includes('estatuto') || tipoLower.includes('ruc') || tipoLower.includes('patente') || tipoLower.includes('art. 40') || tipoLower.includes('proveedores del estado')) {
      categoria = 'LEGAL';
    } else if (tipoLower.includes('balance') || tipoLower.includes('audita') || tipoLower.includes('financier')) {
      categoria = 'FINANCIERO';
    } else if (tipoLower.includes('obra') || tipoLower.includes('experiencia') || tipoLower.includes('certificado de obra')) {
      categoria = 'EXPERIENCIA';
    } else if (tipoLower.includes('maquinaria') || tipoLower.includes('equipo') || tipoLower.includes('motoniveladora') || tipoLower.includes('camion')) {
      categoria = 'MAQUINARIA';
    } else if (tipoLower.includes('personal') || tipoLower.includes('cv') || tipoLower.includes('curriculum') || tipoLower.includes('matricula')) {
      categoria = 'PERSONAL';
    }

    const esInferencia = categoria !== 'OTRO';
    // Sincronización unidireccional con la proyección company_bid_vault_items
    // NOTA DE ARQUITECTURA: La fuente canónica de verdad es empresa_documentos
    await supabase.from("company_bid_vault_items").insert({
      empresa_id: profile.empresa_id,
      categoria,
      tipo_documento: data.tipo.trim(),
      titulo: data.tipo.trim(),
      descripcion: data.descripcion?.trim() || null,
      fecha_emision: data.fecha_emision || null,
      fecha_vencimiento: data.fecha_vencimiento || null,
      es_vencible: !!data.fecha_vencimiento,
      estado: data.fecha_vencimiento && new Date(data.fecha_vencimiento).getTime() < Date.now() ? 'VENCIDO' : 'VIGENTE',
      metadatos: {
        origen: "empresa_documentos",
        ref_id: row.id,
        clasificacion: esInferencia ? "AUTO_SUGGESTED" : "MANUAL_REQUIRED",
        review_required: esInferencia
      }
    });
  } catch (vaultErr) {
    console.warn("[BidVault Sync] Error al enriquecer en company_bid_vault_items tras inserción en empresa_documentos:", vaultErr);
  }

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

  try {
    const vaultPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.tipo !== undefined) {
      vaultPatch.tipo_documento = data.tipo.trim();
      vaultPatch.titulo = data.tipo.trim();
    }
    if (data.descripcion !== undefined) vaultPatch.descripcion = data.descripcion?.trim() || null;
    if (data.fecha_emision !== undefined) vaultPatch.fecha_emision = data.fecha_emision || null;
    if (data.fecha_vencimiento !== undefined) {
      vaultPatch.fecha_vencimiento = data.fecha_vencimiento || null;
      vaultPatch.es_vencible = !!data.fecha_vencimiento;
      vaultPatch.estado = data.fecha_vencimiento && new Date(data.fecha_vencimiento).getTime() < Date.now() ? 'VENCIDO' : 'VIGENTE';
    }
    await supabase.from("company_bid_vault_items").update(vaultPatch).contains("metadatos", { ref_id: id });
  } catch (vaultErr) {
    console.warn("[BidVault Sync] Error al actualizar proyección company_bid_vault_items:", vaultErr);
  }

  revalidatePath("/licitaciones/documentos");
  revalidatePath("/dashboard");
  return {};
}

export async function eliminarDocumentoEmpresa(id: string): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const { error } = await supabase.from("empresa_documentos").delete().eq("id", id);
  if (error) return { error: error.message };

  try {
    await supabase.from("company_bid_vault_items").delete().contains("metadatos", { ref_id: id });
  } catch (vaultErr) {
    console.warn("[BidVault Sync] Error al limpiar proyección company_bid_vault_items tras eliminación:", vaultErr);
  }

  revalidatePath("/licitaciones/documentos");
  revalidatePath("/dashboard");
  return {};
}
