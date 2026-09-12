"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { suggestMatches } from "@/lib/bim/matching";
import type { BimElement, BimModel, BimBudgetMatch, BudgetItem } from "@/lib/types";

async function assertProjectAccess(projectId: string) {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", profile.empresa_id)
    .single();
  if (!project) throw new Error("Proyecto no encontrado.");
  return { profile, supabase };
}

export async function getBimUploadSlot(
  projectId: string,
  fileName: string
): Promise<{ storagePath: string; error: string | null }> {
  await assertProjectAccess(projectId);
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
  const storagePath = `${projectId}/${randomUUID()}-${safeName}`;
  return { storagePath, error: null };
}

export interface ParsedElementInput {
  ifcGuid: string;
  ifcType: string;
  name: string | null;
  buildingStorey: string | null;
  material: string | null;
  properties: Record<string, unknown>;
  quantityType: "length" | "area" | "volume" | "count" | "weight" | null;
  quantityValue: number | null;
  quantityUnit: string | null;
  quantitySource: "IFC_QTO" | "IFC_PROPERTY" | null;
  quantityProperty: string | null;
}

// Registra el modelo ya subido a Storage (por el cliente, vía uploadClientFile
// en bim-section.tsx) junto con los elementos ya parseados en el browser
// (web-ifc corre client-side; el server solo persiste el resultado y calcula
// matches sugeridos — nunca recibe el binario IFC completo).
export async function registerBimModel(
  projectId: string,
  fileName: string,
  storagePath: string,
  schema: string | null,
  elements: ParsedElementInput[]
): Promise<{ modelId: string | null; error: string | null }> {
  const { profile, supabase } = await assertProjectAccess(projectId);

  const { data: model, error: modelError } = await supabase
    .from("bim_models")
    .insert({
      project_id: projectId,
      file_name: fileName,
      storage_path: storagePath,
      schema,
      status: elements.length > 0 ? "LISTO" : "ERROR",
      error_message: elements.length > 0 ? null : "No se encontraron elementos constructivos reconocidos en el IFC.",
      element_count: elements.length,
      uploaded_by: profile.id,
    })
    .select("id")
    .single();

  if (modelError || !model) {
    return { modelId: null, error: modelError?.message ?? "No se pudo registrar el modelo." };
  }

  const CHUNK = 200;
  for (let i = 0; i < elements.length; i += CHUNK) {
    const chunk = elements.slice(i, i + CHUNK);
    const { error } = await supabase.from("bim_elements").insert(
      chunk.map((el) => ({
        bim_model_id: model.id,
        project_id: projectId,
        ifc_guid: el.ifcGuid,
        ifc_type: el.ifcType,
        name: el.name,
        building_storey: el.buildingStorey,
        material: el.material,
        properties: el.properties,
        quantity_type: el.quantityType,
        quantity_value: el.quantityValue,
        quantity_unit: el.quantityUnit,
        quantity_source: el.quantitySource,
        quantity_property: el.quantityProperty,
      }))
    );
    if (error) {
      await supabase
        .from("bim_models")
        .update({ status: "ERROR", error_message: error.message })
        .eq("id", model.id);
      return { modelId: model.id, error: `Error guardando elementos: ${error.message}` };
    }
  }

  await logAudit(supabase, {
    action: "bim.model_uploaded",
    detail: { project_id: projectId, model_id: model.id, file_name: fileName, element_count: elements.length },
  });

  revalidatePath(`/projects/${projectId}`);
  return { modelId: model.id, error: null };
}

export async function getBimData(projectId: string): Promise<{
  models: BimModel[];
  elements: BimElement[];
  matches: BimBudgetMatch[];
  budgetItems: BudgetItem[];
  error: string | null;
}> {
  try {
    const { supabase } = await assertProjectAccess(projectId);
    const [{ data: models }, { data: elements }, { data: budgetItems }] = await Promise.all([
      supabase.from("bim_models").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).returns<BimModel[]>(),
      supabase.from("bim_elements").select("*").eq("project_id", projectId).order("created_at").returns<BimElement[]>(),
      supabase.from("budget_items").select("*").eq("project_id", projectId).order("sort_order").returns<BudgetItem[]>(),
    ]);

    const elementIds = (elements ?? []).map((e) => e.id);
    let matches: BimBudgetMatch[] = [];
    if (elementIds.length > 0) {
      const { data } = await supabase
        .from("bim_budget_matches")
        .select("*")
        .in("bim_element_id", elementIds)
        .returns<BimBudgetMatch[]>();
      matches = data ?? [];
    }

    return { models: models ?? [], elements: elements ?? [], matches, budgetItems: budgetItems ?? [], error: null };
  } catch (e) {
    return { models: [], elements: [], matches: [], budgetItems: [], error: e instanceof Error ? e.message : "Error." };
  }
}

// Genera (o regenera) las sugerencias de match para todos los elementos de un
// modelo. Solo INSERTA propuestas — status PROPUESTO. Nunca confirma nada.
export async function generateMatchSuggestions(
  projectId: string,
  bimModelId: string
): Promise<{ suggested: number; error: string | null }> {
  const { supabase } = await assertProjectAccess(projectId);

  const [{ data: elements }, { data: budgetItems }] = await Promise.all([
    supabase.from("bim_elements").select("*").eq("bim_model_id", bimModelId).returns<BimElement[]>(),
    supabase.from("budget_items").select("*").eq("project_id", projectId).returns<BudgetItem[]>(),
  ]);
  if (!elements || elements.length === 0) return { suggested: 0, error: "El modelo no tiene elementos." };
  if (!budgetItems || budgetItems.length === 0) {
    return { suggested: 0, error: "El proyecto todavía no tiene ítems de presupuesto para comparar." };
  }

  // Solo se comparan rubros "hoja" (sin hijos) con precio cargado: no tiene
  // sentido matchear contra un capítulo agrupador, y sin unit_price la línea
  // igual quedaría "PRECIO NO DISPONIBLE".
  const parentIds = new Set(budgetItems.map((b) => b.parent_id).filter(Boolean));
  const matchableItems = budgetItems.filter((b) => !parentIds.has(b.id) && b.unit_price != null);

  const rows: { bim_element_id: string; budget_item_id: string; method: "DETERMINISTIC" | "SEMANTIC"; score: number }[] = [];
  for (const element of elements) {
    const candidates = suggestMatches(element, matchableItems);
    for (const c of candidates) {
      rows.push({
        bim_element_id: element.id,
        budget_item_id: c.budgetItem.id,
        method: "SEMANTIC",
        score: c.score,
      });
    }
  }

  if (rows.length === 0) return { suggested: 0, error: null };

  const { error } = await supabase
    .from("bim_budget_matches")
    .upsert(rows, { onConflict: "bim_element_id,budget_item_id", ignoreDuplicates: true });
  if (error) return { suggested: 0, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { suggested: rows.length, error: null };
}

// El usuario CONFIRMA un match propuesto (o crea uno manual). Descarta
// cualquier otra propuesta pendiente para el mismo elemento — un elemento BIM
// tiene a lo sumo un match confirmado vigente (constraint en la migración).
export async function confirmBimMatch(
  projectId: string,
  bimElementId: string,
  budgetItemId: string
): Promise<{ error: string | null }> {
  const { profile, supabase } = await assertProjectAccess(projectId);

  const { data: existing } = await supabase
    .from("bim_budget_matches")
    .select("id")
    .eq("bim_element_id", bimElementId)
    .eq("budget_item_id", budgetItemId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("bim_budget_matches")
      .update({ status: "CONFIRMADO", confirmed_by: profile.id, confirmed_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("bim_budget_matches").insert({
      bim_element_id: bimElementId,
      budget_item_id: budgetItemId,
      method: "MANUAL",
      status: "CONFIRMADO",
      confirmed_by: profile.id,
      confirmed_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
  }

  await supabase
    .from("bim_budget_matches")
    .update({ status: "DESCARTADO" })
    .eq("bim_element_id", bimElementId)
    .neq("budget_item_id", budgetItemId)
    .eq("status", "PROPUESTO");

  await logAudit(supabase, {
    action: "bim.match_confirmed",
    detail: { project_id: projectId, bim_element_id: bimElementId, budget_item_id: budgetItemId },
  });

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function discardBimMatch(projectId: string, matchId: string): Promise<{ error: string | null }> {
  const { supabase } = await assertProjectAccess(projectId);
  const { error } = await supabase.from("bim_budget_matches").update({ status: "DESCARTADO" }).eq("id", matchId);
  revalidatePath(`/projects/${projectId}`);
  return { error: error?.message ?? null };
}

export async function deleteBimModel(projectId: string, modelId: string): Promise<{ error: string | null }> {
  const { supabase } = await assertProjectAccess(projectId);
  const { data: model } = await supabase.from("bim_models").select("storage_path").eq("id", modelId).single();
  const { error } = await supabase.from("bim_models").delete().eq("id", modelId);
  if (error) return { error: error.message };
  if (model?.storage_path) {
    await supabase.storage.from("bim-models").remove([model.storage_path]);
  }
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
