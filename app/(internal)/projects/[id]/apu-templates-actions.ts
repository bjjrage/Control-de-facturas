"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  resolveApuTemplateMaterialImportMapping,
  resolveApuTemplateLaborImportMapping,
  resolveApuTemplateEquipmentImportMapping,
  type ApuTemplateMaterialImportRowInput,
  type ApuTemplateLaborImportRowInput,
  type ApuTemplateEquipmentImportRowInput,
  type ApuTemplateImportRowError,
} from "@/lib/procurement/apu-templates";

// ---------------------------------------------------------------------------
// Plantillas de APU a nivel empresa: se cargan UNA vez (por Excel) y se
// aplican solas a cualquier partida de cualquier obra que matchee por
// descripción (ver apu-actions.ts → applyApuTemplatesToProjectAction).
// ---------------------------------------------------------------------------

export interface ApuTemplateSummary {
  id: string;
  nombre: string;
  materialesCount: number;
  laborCount: number;
  equipoCount: number;
}

export async function listApuTemplatesAction(): Promise<{
  data: ApuTemplateSummary[] | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data: templates, error } = await supabase
      .from("apu_templates")
      .select("id, nombre")
      .eq("empresa_id", profile.empresa_id)
      .order("nombre");
    if (error) return { data: null, error: error.message };
    if (!templates || templates.length === 0) return { data: [], error: null };

    const ids = templates.map((t) => t.id);
    const [materialsRes, laborRes, equipmentRes] = await Promise.all([
      supabase.from("apu_template_materials").select("template_id").in("template_id", ids),
      supabase.from("apu_template_labor").select("template_id").in("template_id", ids),
      supabase.from("apu_template_equipment").select("template_id").in("template_id", ids),
    ]);
    const countBy = (rows: { template_id: string }[] | null) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) m.set(r.template_id, (m.get(r.template_id) ?? 0) + 1);
      return m;
    };
    const materialCounts = countBy(materialsRes.data as any);
    const laborCounts = countBy(laborRes.data as any);
    const equipmentCounts = countBy(equipmentRes.data as any);

    return {
      data: templates.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        materialesCount: materialCounts.get(t.id) ?? 0,
        laborCount: laborCounts.get(t.id) ?? 0,
        equipoCount: equipmentCounts.get(t.id) ?? 0,
      })),
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al listar plantillas de APU." };
  }
}

export async function deleteApuTemplateAction(id: string): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { error } = await supabase.from("apu_templates").delete().eq("id", id).eq("empresa_id", profile.empresa_id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/configuracion");
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function ensureTemplateIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  nombres: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  const { data: existing } = await supabase.from("apu_templates").select("id, nombre").eq("empresa_id", empresaId).in("nombre", unique);
  const byNombre = new Map<string, string>((existing ?? []).map((t: any) => [t.nombre, t.id]));
  const missing = unique.filter((n) => !byNombre.has(n));
  if (missing.length > 0) {
    const { data: created, error } = await supabase
      .from("apu_templates")
      .insert(missing.map((nombre) => ({ empresa_id: empresaId, nombre })))
      .select("id, nombre");
    if (error) throw new Error(`Error al crear plantillas: ${error.message}`);
    for (const t of created ?? []) byNombre.set(t.nombre, t.id);
  }
  return byNombre;
}

export async function importApuTemplateMaterialsAction(params: {
  rows: ApuTemplateMaterialImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: productsData } = await supabase.from("productos").select("id, sku").eq("empresa_id", profile.empresa_id).eq("activo", true);
  const products = (productsData ?? []).map((p: any) => ({ id: p.id, sku: p.sku }));
  const { mapped, errors } = resolveApuTemplateMaterialImportMapping(params.rows, products);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_materials").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      producto_id: m.productoId,
      cantidad_por_unidad_ejecutada: m.cantidadPorUnidad,
      desperdicio_pct: m.desperdicioPct,
    })),
    { onConflict: "template_id,producto_id" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/configuracion");
  return { creados: mapped.length, errores: errors };
}

export async function importApuTemplateLaborAction(params: {
  rows: ApuTemplateLaborImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { mapped, errors } = resolveApuTemplateLaborImportMapping(params.rows);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_labor").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      rol: m.rol,
      horas_por_unidad_ejecutada: m.horasPorUnidad,
      costo_hora: m.costoHora,
    })),
    { onConflict: "template_id,rol" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/configuracion");
  return { creados: mapped.length, errores: errors };
}

export async function importApuTemplateEquipmentAction(params: {
  rows: ApuTemplateEquipmentImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { mapped, errors } = resolveApuTemplateEquipmentImportMapping(params.rows);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_equipment").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      tipo_equipo: m.tipoEquipo,
      horas_por_unidad_ejecutada: m.horasPorUnidad,
      costo_hora: m.costoHora,
    })),
    { onConflict: "template_id,tipo_equipo" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/configuracion");
  return { creados: mapped.length, errores: errors };
}
