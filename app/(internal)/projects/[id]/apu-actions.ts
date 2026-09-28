"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  resolveApuMaterialImportMapping,
  resolveApuLaborImportMapping,
  resolveApuEquipmentImportMapping,
  type ApuMaterialImportRowInput,
  type ApuLaborImportRowInput,
  type ApuEquipmentImportRowInput,
  type ApuImportRowError,
} from "@/lib/procurement/apu-import";
import { matchBudgetItemsToApuTemplates } from "@/lib/procurement/apu-templates";

// ---------------------------------------------------------------------------
// CRUD + importación masiva del APU/BOM por partida: materiales, mano de
// obra, equipo. El costo de materiales se deriva SIEMPRE en vivo de
// productos.costo_promedio (nunca se guarda acá); mano de obra/equipo no
// tienen catálogo, así que el costo_hora se carga directo en la fila.
// ---------------------------------------------------------------------------

export interface ApuMaterialRow {
  id: string;
  budget_item_id: string;
  producto_id: string;
  producto_nombre: string;
  producto_sku: string | null;
  unidad_medida: string;
  cantidad_por_unidad_ejecutada: number;
  desperdicio_pct: number;
  costo_promedio: number | null;
}

export interface ApuLaborRow {
  id: string;
  budget_item_id: string;
  rol: string;
  horas_por_unidad_ejecutada: number;
  costo_hora: number;
}

export interface ApuEquipmentRow {
  id: string;
  budget_item_id: string;
  tipo_equipo: string;
  horas_por_unidad_ejecutada: number;
  costo_hora: number;
}

export async function listApuAction(params: {
  projectId: string;
  budgetItemId: string;
}): Promise<{
  data: { materials: ApuMaterialRow[]; labor: ApuLaborRow[]; equipment: ApuEquipmentRow[] } | null;
  error: string | null;
}> {
  try {
    await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const [materialsRes, laborRes, equipmentRes] = await Promise.all([
      supabase
        .from("budget_item_materials")
        .select("id, budget_item_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct, productos(nombre, sku, unidad, costo_promedio)")
        .eq("project_id", params.projectId)
        .eq("budget_item_id", params.budgetItemId),
      supabase
        .from("budget_item_labor")
        .select("id, budget_item_id, rol, horas_por_unidad_ejecutada, costo_hora")
        .eq("project_id", params.projectId)
        .eq("budget_item_id", params.budgetItemId),
      supabase
        .from("budget_item_equipment")
        .select("id, budget_item_id, tipo_equipo, horas_por_unidad_ejecutada, costo_hora")
        .eq("project_id", params.projectId)
        .eq("budget_item_id", params.budgetItemId),
    ]);
    if (materialsRes.error) return { data: null, error: materialsRes.error.message };
    if (laborRes.error) return { data: null, error: laborRes.error.message };
    if (equipmentRes.error) return { data: null, error: equipmentRes.error.message };

    const materials: ApuMaterialRow[] = (materialsRes.data ?? []).map((r: any) => ({
      id: r.id,
      budget_item_id: r.budget_item_id,
      producto_id: r.producto_id,
      producto_nombre: r.productos?.nombre ?? "(producto eliminado)",
      producto_sku: r.productos?.sku ?? null,
      unidad_medida: r.productos?.unidad ?? "",
      cantidad_por_unidad_ejecutada: Number(r.cantidad_por_unidad_ejecutada),
      desperdicio_pct: Number(r.desperdicio_pct),
      costo_promedio: r.productos?.costo_promedio != null && Number(r.productos.costo_promedio) > 0
        ? Number(r.productos.costo_promedio)
        : null,
    }));
    const labor: ApuLaborRow[] = (laborRes.data ?? []).map((r: any) => ({
      id: r.id,
      budget_item_id: r.budget_item_id,
      rol: r.rol,
      horas_por_unidad_ejecutada: Number(r.horas_por_unidad_ejecutada),
      costo_hora: Number(r.costo_hora),
    }));
    const equipment: ApuEquipmentRow[] = (equipmentRes.data ?? []).map((r: any) => ({
      id: r.id,
      budget_item_id: r.budget_item_id,
      tipo_equipo: r.tipo_equipo,
      horas_por_unidad_ejecutada: Number(r.horas_por_unidad_ejecutada),
      costo_hora: Number(r.costo_hora),
    }));
    return { data: { materials, labor, equipment }, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al listar el APU de la partida." };
  }
}

/**
 * Crea o actualiza un componente material del APU/BOM (upsert por partida+producto).
 */
export async function saveBudgetItemMaterialAction(params: {
  projectId: string;
  budgetItemId: string;
  productoId: string;
  cantidadPorUnidad: number;
  desperdicioPct?: number;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const { error } = await supabase.from("budget_item_materials").upsert(
      {
        empresa_id: empresaId,
        project_id: params.projectId,
        budget_item_id: params.budgetItemId,
        producto_id: params.productoId,
        cantidad_por_unidad_ejecutada: params.cantidadPorUnidad,
        desperdicio_pct: params.desperdicioPct ?? 0,
      },
      { onConflict: "budget_item_id,producto_id" }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteBudgetItemMaterialAction(params: {
  projectId: string;
  id: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { error } = await supabase
      .from("budget_item_materials")
      .delete()
      .eq("id", params.id)
      .eq("empresa_id", profile.empresa_id);
    if (error) return { success: false, error: error.message };
    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveBudgetItemLaborAction(params: {
  projectId: string;
  budgetItemId: string;
  rol: string;
  horasPorUnidad: number;
  costoHora: number;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const rol = params.rol?.trim();
    if (!rol) return { success: false, error: "Rol requerido." };
    const { error } = await supabase.from("budget_item_labor").upsert(
      {
        empresa_id: profile.empresa_id,
        project_id: params.projectId,
        budget_item_id: params.budgetItemId,
        rol,
        horas_por_unidad_ejecutada: params.horasPorUnidad,
        costo_hora: params.costoHora,
      },
      { onConflict: "budget_item_id,rol" }
    );
    if (error) return { success: false, error: error.message };
    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteBudgetItemLaborAction(params: {
  projectId: string;
  id: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { error } = await supabase
      .from("budget_item_labor")
      .delete()
      .eq("id", params.id)
      .eq("empresa_id", profile.empresa_id);
    if (error) return { success: false, error: error.message };
    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function saveBudgetItemEquipmentAction(params: {
  projectId: string;
  budgetItemId: string;
  tipoEquipo: string;
  horasPorUnidad: number;
  costoHora: number;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const tipoEquipo = params.tipoEquipo?.trim();
    if (!tipoEquipo) return { success: false, error: "Tipo de equipo requerido." };
    const { error } = await supabase.from("budget_item_equipment").upsert(
      {
        empresa_id: profile.empresa_id,
        project_id: params.projectId,
        budget_item_id: params.budgetItemId,
        tipo_equipo: tipoEquipo,
        horas_por_unidad_ejecutada: params.horasPorUnidad,
        costo_hora: params.costoHora,
      },
      { onConflict: "budget_item_id,tipo_equipo" }
    );
    if (error) return { success: false, error: error.message };
    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteBudgetItemEquipmentAction(params: {
  projectId: string;
  id: string;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { error } = await supabase
      .from("budget_item_equipment")
      .delete()
      .eq("id", params.id)
      .eq("empresa_id", profile.empresa_id);
    if (error) return { success: false, error: error.message };
    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Catálogos (partidas del proyecto + productos de la empresa) para que la UI
 * arme el preview de importación del lado del cliente antes de confirmar.
 */
export async function getApuImportCatalogsAction(projectId: string): Promise<{
  data: { budgetItems: { id: string; code: string; unit: string | null }[]; products: { id: string; sku: string }[] } | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { budgetItems, products } = await loadApuCatalogs(supabase, profile.empresa_id, projectId);
    return {
      data: {
        budgetItems,
        products: products.filter((p) => p.sku) as { id: string; sku: string }[],
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al cargar catálogos de importación." };
  }
}

// --- Importación masiva por Excel (camino principal, mínima carga manual) --

async function loadApuCatalogs(supabase: Awaited<ReturnType<typeof createClient>>, empresaId: string, projectId: string) {
  const [itemsRes, productsRes] = await Promise.all([
    supabase.from("budget_items").select("id, code, unit").eq("project_id", projectId),
    supabase.from("productos").select("id, sku").eq("empresa_id", empresaId).eq("activo", true),
  ]);
  return {
    budgetItems: (itemsRes.data ?? []).map((r: any) => ({ id: r.id, code: r.code, unit: r.unit })),
    products: (productsRes.data ?? []).map((r: any) => ({ id: r.id, sku: r.sku })),
  };
}

export async function importApuMaterialsAction(params: {
  projectId: string;
  rows: ApuMaterialImportRowInput[];
}): Promise<{ creados: number; errores: ApuImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { budgetItems, products } = await loadApuCatalogs(supabase, profile.empresa_id, params.projectId);
  const { mapped, errors } = resolveApuMaterialImportMapping(params.rows, budgetItems, products);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const { error } = await supabase.from("budget_item_materials").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      project_id: params.projectId,
      budget_item_id: m.budgetItemId,
      producto_id: m.productoId,
      cantidad_por_unidad_ejecutada: m.cantidadPorUnidad,
      desperdicio_pct: m.desperdicioPct,
    })),
    { onConflict: "budget_item_id,producto_id" }
  );
  if (error) {
    return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  }
  revalidatePath(`/projects/${params.projectId}`);
  return { creados: mapped.length, errores: errors };
}

export async function importApuLaborAction(params: {
  projectId: string;
  rows: ApuLaborImportRowInput[];
}): Promise<{ creados: number; errores: ApuImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { budgetItems } = await loadApuCatalogs(supabase, profile.empresa_id, params.projectId);
  const { mapped, errors } = resolveApuLaborImportMapping(params.rows, budgetItems);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const { error } = await supabase.from("budget_item_labor").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      project_id: params.projectId,
      budget_item_id: m.budgetItemId,
      rol: m.rol,
      horas_por_unidad_ejecutada: m.horasPorUnidad,
      costo_hora: m.costoHora,
    })),
    { onConflict: "budget_item_id,rol" }
  );
  if (error) {
    return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  }
  revalidatePath(`/projects/${params.projectId}`);
  return { creados: mapped.length, errores: errors };
}

export async function importApuEquipmentAction(params: {
  projectId: string;
  rows: ApuEquipmentImportRowInput[];
}): Promise<{ creados: number; errores: ApuImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { budgetItems } = await loadApuCatalogs(supabase, profile.empresa_id, params.projectId);
  const { mapped, errors } = resolveApuEquipmentImportMapping(params.rows, budgetItems);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const { error } = await supabase.from("budget_item_equipment").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      project_id: params.projectId,
      budget_item_id: m.budgetItemId,
      tipo_equipo: m.tipoEquipo,
      horas_por_unidad_ejecutada: m.horasPorUnidad,
      costo_hora: m.costoHora,
    })),
    { onConflict: "budget_item_id,tipo_equipo" }
  );
  if (error) {
    return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  }
  revalidatePath(`/projects/${params.projectId}`);
  return { creados: mapped.length, errores: errors };
}

// --- Aplicar plantillas de APU de la empresa (cargadas una sola vez) -------

export interface ApplyApuTemplatesResult {
  aplicadas: number;
  yaTeniaApu: number;
  sinPlantilla: { budgetItemId: string; code: string; description: string }[];
}

/**
 * Para cada partida de la obra que TODAVÍA no tiene ningún APU cargado
 * (materiales/mano de obra/equipo), busca una plantilla de empresa cuyo
 * nombre matchee EXACTO con la descripción de la partida y copia sus
 * líneas. Partidas con match ambiguo o sin plantilla quedan listadas para
 * carga manual — nunca se inventa ni se aplica a ciegas.
 */
export async function applyApuTemplatesToProjectAction(projectId: string): Promise<{
  data: ApplyApuTemplatesResult | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const { data: budgetItems, error: itemsErr } = await supabase
      .from("budget_items")
      .select("id, code, description")
      .eq("project_id", projectId);
    if (itemsErr) return { data: null, error: itemsErr.message };
    if (!budgetItems || budgetItems.length === 0) {
      return { data: { aplicadas: 0, yaTeniaApu: 0, sinPlantilla: [] }, error: null };
    }
    const itemIds = budgetItems.map((b: any) => b.id);

    const [materialsRes, laborRes, equipmentRes, templatesRes] = await Promise.all([
      supabase.from("budget_item_materials").select("budget_item_id").in("budget_item_id", itemIds),
      supabase.from("budget_item_labor").select("budget_item_id").in("budget_item_id", itemIds),
      supabase.from("budget_item_equipment").select("budget_item_id").in("budget_item_id", itemIds),
      supabase.from("apu_templates").select("id, nombre").eq("empresa_id", empresaId),
    ]);
    const hasApu = new Set<string>([
      ...(materialsRes.data ?? []).map((r: any) => r.budget_item_id),
      ...(laborRes.data ?? []).map((r: any) => r.budget_item_id),
      ...(equipmentRes.data ?? []).map((r: any) => r.budget_item_id),
    ]);
    const pendingItems = (budgetItems as any[]).filter((b) => !hasApu.has(b.id));
    const yaTeniaApu = budgetItems.length - pendingItems.length;

    const templates = (templatesRes.data ?? []) as { id: string; nombre: string }[];
    if (templates.length === 0 || pendingItems.length === 0) {
      return {
        data: {
          aplicadas: 0,
          yaTeniaApu,
          sinPlantilla: pendingItems.map((b) => ({ budgetItemId: b.id, code: b.code, description: b.description })),
        },
        error: null,
      };
    }

    const { matched, unmatched } = matchBudgetItemsToApuTemplates(
      pendingItems.map((b) => ({ id: b.id, description: b.description })),
      templates
    );
    if (matched.length === 0) {
      return {
        data: {
          aplicadas: 0,
          yaTeniaApu,
          sinPlantilla: unmatched.map((u) => {
            const item = pendingItems.find((b) => b.id === u.budgetItemId)!;
            return { budgetItemId: item.id, code: item.code, description: item.description };
          }),
        },
        error: null,
      };
    }

    const templateIds = [...new Set(matched.map((m) => m.templateId))];
    const [tplMaterialsRes, tplLaborRes, tplEquipmentRes] = await Promise.all([
      supabase.from("apu_template_materials").select("template_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct").in("template_id", templateIds),
      supabase.from("apu_template_labor").select("template_id, rol, horas_por_unidad_ejecutada, costo_hora").in("template_id", templateIds),
      supabase.from("apu_template_equipment").select("template_id, tipo_equipo, horas_por_unidad_ejecutada, costo_hora").in("template_id", templateIds),
    ]);

    const materialRows: any[] = [];
    const laborRows: any[] = [];
    const equipmentRows: any[] = [];
    for (const m of matched) {
      for (const tm of tplMaterialsRes.data ?? []) {
        if ((tm as any).template_id !== m.templateId) continue;
        materialRows.push({
          empresa_id: empresaId,
          project_id: projectId,
          budget_item_id: m.budgetItemId,
          producto_id: (tm as any).producto_id,
          cantidad_por_unidad_ejecutada: (tm as any).cantidad_por_unidad_ejecutada,
          desperdicio_pct: (tm as any).desperdicio_pct,
        });
      }
      for (const tl of tplLaborRes.data ?? []) {
        if ((tl as any).template_id !== m.templateId) continue;
        laborRows.push({
          empresa_id: empresaId,
          project_id: projectId,
          budget_item_id: m.budgetItemId,
          rol: (tl as any).rol,
          horas_por_unidad_ejecutada: (tl as any).horas_por_unidad_ejecutada,
          costo_hora: (tl as any).costo_hora,
        });
      }
      for (const te of tplEquipmentRes.data ?? []) {
        if ((te as any).template_id !== m.templateId) continue;
        equipmentRows.push({
          empresa_id: empresaId,
          project_id: projectId,
          budget_item_id: m.budgetItemId,
          tipo_equipo: (te as any).tipo_equipo,
          horas_por_unidad_ejecutada: (te as any).horas_por_unidad_ejecutada,
          costo_hora: (te as any).costo_hora,
        });
      }
    }

    if (materialRows.length > 0) {
      const { error } = await supabase.from("budget_item_materials").upsert(materialRows, { onConflict: "budget_item_id,producto_id" });
      if (error) return { data: null, error: `Error al aplicar materiales: ${error.message}` };
    }
    if (laborRows.length > 0) {
      const { error } = await supabase.from("budget_item_labor").upsert(laborRows, { onConflict: "budget_item_id,rol" });
      if (error) return { data: null, error: `Error al aplicar mano de obra: ${error.message}` };
    }
    if (equipmentRows.length > 0) {
      const { error } = await supabase.from("budget_item_equipment").upsert(equipmentRows, { onConflict: "budget_item_id,tipo_equipo" });
      if (error) return { data: null, error: `Error al aplicar equipo: ${error.message}` };
    }

    revalidatePath(`/projects/${projectId}`);
    return {
      data: {
        aplicadas: matched.length,
        yaTeniaApu,
        sinPlantilla: unmatched.map((u) => {
          const item = pendingItems.find((b) => b.id === u.budgetItemId)!;
          return { budgetItemId: item.id, code: item.code, description: item.description };
        }),
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al aplicar plantillas de APU." };
  }
}
