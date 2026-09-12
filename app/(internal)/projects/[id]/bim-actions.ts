"use server";

import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { aggregateElementsForBudgetItem } from "@/lib/bim/matching";
import { runSemanticMatch, buildCandidatePool, toSemanticMatchInput } from "@/lib/bim/semantic-pipeline";
import { DeepSeekSemanticMatcher } from "@/lib/bim/deepseek-matcher";
import { DeepSeekBatchSemanticMatcher, type BatchMatchItem } from "@/lib/bim/deepseek-batch-matcher";
import { groupElements } from "@/lib/bim/grouping";
import { planRegroup } from "@/lib/bim/regroup-planning";
import { checkTechnicalIntegrity } from "@/lib/bim/technical-integrity";
import type { BimElement, BimModel, BimBudgetMatch, BimElementGroup, BimGroupMatch, BudgetItem } from "@/lib/types";

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
  expressId: number;
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
        express_id: el.expressId,
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

  // Filtro determinista -> retrieval por texto -> DEEPSEEK decide. El fuzzy
  // scorer ya no es la autoridad de match, solo acota candidatos (ver
  // lib/bim/semantic-pipeline.ts). Si DeepSeek falla (falta API key, error de
  // red, respuesta inválida), se corta acá con el error real — nunca se
  // sustituye por un resultado fuzzy disfrazado de decisión de IA.
  let matcher: DeepSeekSemanticMatcher;
  try {
    matcher = new DeepSeekSemanticMatcher();
  } catch (e) {
    return { suggested: 0, error: e instanceof Error ? e.message : "No se pudo inicializar el matcher semántico." };
  }

  const rows: { bim_element_id: string; budget_item_id: string; method: "DETERMINISTIC" | "SEMANTIC"; score: number }[] = [];
  for (const element of elements) {
    let result;
    try {
      result = await runSemanticMatch(matcher, element, matchableItems);
    } catch (e) {
      return {
        suggested: rows.length,
        error: `Se generaron ${rows.length} sugerencias antes de un error de DeepSeek: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (result.decision === "MATCH" && result.candidateId) {
      rows.push({
        bim_element_id: element.id,
        budget_item_id: result.candidateId,
        method: "SEMANTIC",
        score: result.confidence,
      });
    }
    // REVIEW y NO_MATCH no generan fila: el elemento queda sin sugerencia,
    // consistente con "Sin sugerencias compatibles" en la UI. No es un error,
    // es la abstención explícita que pide el diseño del matcher.
  }

  if (rows.length === 0) return { suggested: 0, error: null };

  const { error } = await supabase
    .from("bim_budget_matches")
    .upsert(rows, { onConflict: "bim_element_id,budget_item_id", ignoreDuplicates: true });
  if (error) return { suggested: 0, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { suggested: rows.length, error: null };
}

// ---------------------------------------------------------------------------
// Flujo agrupado (0073_bim_groups.sql): agrupa elementos técnicamente
// equivalentes ANTES de llamar a DeepSeek, y llama al matcher EN LOTE
// (5-10 grupos por request) en vez de una vez por elemento. Reemplaza a
// generateMatchSuggestions como flujo principal de la UI; esa función queda
// intacta para no romper nada de lo ya certificado.
// ---------------------------------------------------------------------------

const GROUP_BATCH_SIZE = 8;

export interface ProcessBimGroupsResult {
  elementCount: number;
  groupCount: number;
  suggested: number;
  review: number;
  reviewRequired: number;
  noMatch: number;
  totalTokens: number;
  latencyMs: number;
  error: string | null;
}

// Agrupa los elementos del modelo, persiste los grupos (con trazabilidad
// grupo -> elementos vía bim_elements.group_id) y corre el matching semántico
// EN LOTE sobre los grupos. Solo inserta propuestas (SUGGESTED/REVIEW/
// NO_MATCH) — nunca confirma nada; la confirmación es una acción humana
// aparte (confirmGroupMatch).
export async function processBimGroups(projectId: string, bimModelId: string): Promise<ProcessBimGroupsResult> {
  const startedAt = Date.now();
  const empty: ProcessBimGroupsResult = {
    elementCount: 0,
    groupCount: 0,
    suggested: 0,
    review: 0,
    reviewRequired: 0,
    noMatch: 0,
    totalTokens: 0,
    latencyMs: 0,
    error: null,
  };
  const { supabase } = await assertProjectAccess(projectId);

  const [{ data: elements }, { data: budgetItems }] = await Promise.all([
    supabase.from("bim_elements").select("*").eq("bim_model_id", bimModelId).returns<BimElement[]>(),
    supabase.from("budget_items").select("*").eq("project_id", projectId).returns<BudgetItem[]>(),
  ]);
  if (!elements || elements.length === 0) return { ...empty, error: "El modelo no tiene elementos." };
  if (!budgetItems || budgetItems.length === 0) {
    return { ...empty, elementCount: elements.length, error: "El proyecto todavía no tiene ítems de presupuesto para comparar." };
  }
  const parentIds = new Set(budgetItems.map((b) => b.parent_id).filter(Boolean));
  const matchableItems = budgetItems.filter((b) => !parentIds.has(b.id) && b.unit_price != null);

  // Idempotencia SIN destruir decisiones humanas:
  //   - CONFIRMED/REJECTED son decisiones de una persona -> el grupo queda
  //     "bloqueado": no se borra, no se recalcula, sus elementos NO vuelven
  //     al pool de reagrupación (nunca se reasignan silenciosamente).
  //   - SUGGESTED/REVIEW/NO_MATCH son propuestas de la IA sin confirmar ->
  //     se pueden regenerar: se borran esos grupos (el ON DELETE CASCADE de
  //     bim_group_matches solo se lleva propuestas, nunca una confirmación,
  //     porque los grupos CONFIRMED/REJECTED ni se tocan) y sus elementos
  //     vuelven a agruparse desde cero.
  const { data: existingGroups } = await supabase
    .from("bim_element_groups")
    .select("id")
    .eq("bim_model_id", bimModelId)
    .returns<{ id: string }[]>();

  let lockedGroupCount = 0;
  let elementsToGroup = elements;

  if (existingGroups && existingGroups.length > 0) {
    const existingGroupIds = existingGroups.map((g) => g.id);
    const { data: existingMatches } = await supabase
      .from("bim_group_matches")
      .select("group_id, status")
      .in("group_id", existingGroupIds)
      .returns<{ group_id: string; status: string }[]>();
    const { lockedGroupIds, staleGroupIds } = planRegroup(existingGroupIds, existingMatches ?? []);
    lockedGroupCount = lockedGroupIds.size;

    if (staleGroupIds.length > 0) {
      // Borra SOLO los grupos sin decisión humana. El CASCADE se lleva sus
      // bim_group_matches (todas SUGGESTED/REVIEW/NO_MATCH — nunca hay una
      // CONFIRMED/REJECTED entre ellas porque las excluimos arriba) y libera
      // bim_elements.group_id (ON DELETE SET NULL) solo de esos elementos.
      const { error: deleteError } = await supabase.from("bim_element_groups").delete().in("id", staleGroupIds);
      if (deleteError) return { ...empty, elementCount: elements.length, error: deleteError.message };
    }

    // Releer elementos: los de grupos bloqueados conservan su group_id (no
    // entran al pool de reagrupación); los de grupos borrados quedaron con
    // group_id NULL y sí vuelven a agruparse.
    const { data: freshElements } = await supabase
      .from("bim_elements")
      .select("*")
      .eq("bim_model_id", bimModelId)
      .returns<BimElement[]>();
    elementsToGroup = (freshElements ?? []).filter((e) => e.group_id == null);
  }

  if (elementsToGroup.length === 0) {
    // Nada para reagrupar: todo lo que había quedó bloqueado (CONFIRMED/
    // REJECTED). suggested/review/noMatch en 0 a propósito — un grupo
    // bloqueado ya está resuelto, no cuenta como "pendiente de revisión".
    return {
      elementCount: elements.length,
      groupCount: lockedGroupCount,
      suggested: 0,
      review: 0,
      reviewRequired: 0,
      noMatch: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  }

  // 1) Agrupar (puro, en memoria, solo sobre los elementos libres) y
  // persistir grupos nuevos + group_id en cada elemento.
  const drafts = groupElements(elementsToGroup);
  const groupIds: string[] = [];
  for (const draft of drafts) {
    const { data: group, error } = await supabase
      .from("bim_element_groups")
      .insert({
        bim_model_id: bimModelId,
        project_id: projectId,
        ifc_type: draft.ifcType,
        material: draft.material,
        normalized_name: draft.representative.name ?? draft.ifcType,
        quantity_type: draft.quantityType,
        quantity_unit: draft.quantityUnit,
        total_quantity: draft.totalQuantity,
        element_count: draft.elements.length,
      })
      .select("id")
      .single();
    if (error || !group) return { ...empty, elementCount: elements.length, error: error?.message ?? "No se pudo crear un grupo." };

    const { error: updateError } = await supabase
      .from("bim_elements")
      .update({ group_id: group.id })
      .in(
        "id",
        draft.elements.map((e) => e.id)
      );
    if (updateError) return { ...empty, elementCount: elements.length, error: updateError.message };

    groupIds.push(group.id);
  }

  // 2) Matching semántico EN LOTE sobre los grupos (nunca sobre el texto crudo:
  // cada grupo se representa por su elemento representante + cantidad total).
  let matcher: DeepSeekBatchSemanticMatcher;
  try {
    matcher = new DeepSeekBatchSemanticMatcher();
  } catch (e) {
    return { ...empty, elementCount: elements.length, groupCount: lockedGroupCount + drafts.length, error: e instanceof Error ? e.message : "No se pudo inicializar el matcher semántico." };
  }

  let suggested = 0;
  let review = 0;
  let reviewRequired = 0;
  let noMatch = 0;
  let totalTokens = 0;
  const rows: {
    group_id: string;
    budget_item_id: string | null;
    method: "SEMANTIC";
    score: number;
    reason: string;
    status: "SUGGESTED" | "REVIEW" | "REVIEW_REQUIRED" | "NO_MATCH";
  }[] = [];

  for (let i = 0; i < drafts.length; i += GROUP_BATCH_SIZE) {
    const batchDrafts = drafts.slice(i, i + GROUP_BATCH_SIZE);
    const batchGroupIds = groupIds.slice(i, i + GROUP_BATCH_SIZE);
    // Validación técnica ANTES de llamar a DeepSeek: si el input de un grupo
    // ya viene contradictorio (espesor/resistencia/material en conflicto
    // entre name/material/properties) o expresa un rango que deja más de un
    // candidato plausible, se marca acá — pero igual se le manda a DeepSeek
    // (ver más abajo), que sigue proponiendo un candidato informativo.
    const integrityByGroup = new Map<string, ReturnType<typeof checkTechnicalIntegrity>>();
    const items: BatchMatchItem[] = batchDrafts.map((draft, idx) => {
      const rep = draft.representative;
      const groupElement: BimElement = { ...rep, quantity_value: draft.totalQuantity ?? rep.quantity_value };
      const candidates = buildCandidatePool(groupElement, matchableItems);
      // matchableItems (no `candidates`): el chequeo de rango necesita ver el
      // catálogo completo, porque buildCandidatePool ya colapsa un rango a un
      // solo extremo de espesor y ocultaría la ambigüedad.
      integrityByGroup.set(batchGroupIds[idx], checkTechnicalIntegrity(groupElement, matchableItems));
      return { elementId: batchGroupIds[idx], input: toSemanticMatchInput(groupElement, candidates) };
    });

    let batchResults;
    try {
      batchResults = await matcher.matchBatch(items);
    } catch (e) {
      return {
        elementCount: elements.length,
        groupCount: lockedGroupCount + drafts.length,
        suggested,
        review,
        reviewRequired,
        noMatch,
        totalTokens,
        latencyMs: Date.now() - startedAt,
        error: `Se procesaron ${suggested + review + reviewRequired + noMatch} grupos antes de un error de DeepSeek: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    totalTokens += matcher.lastUsage?.totalTokens ?? 0;

    for (const groupId of batchGroupIds) {
      const result = batchResults.get(groupId);
      if (!result) continue;
      const integrity = integrityByGroup.get(groupId);

      if (integrity?.vicious) {
        // El input está viciado: nunca se auto-confirma, sin importar lo que
        // haya decidido DeepSeek. Si DeepSeek propuso un candidato, se
        // conserva como sugerencia informativa (budget_item_id permitido
        // para REVIEW_REQUIRED) — la UI exige elección manual explícita.
        const suggestedCandidateId = result.decision === "MATCH" ? result.candidateId : null;
        const reasonText = result.reason
          ? `[${integrity.reason}] ${result.reason}`
          : `[${integrity.reason}] Input técnico contradictorio o ambiguo — requiere revisión humana.`;
        rows.push({ group_id: groupId, budget_item_id: suggestedCandidateId, method: "SEMANTIC", score: result.confidence, reason: reasonText, status: "REVIEW_REQUIRED" });
        reviewRequired++;
        continue;
      }

      if (result.decision === "MATCH" && result.candidateId) {
        rows.push({ group_id: groupId, budget_item_id: result.candidateId, method: "SEMANTIC", score: result.confidence, reason: result.reason, status: "SUGGESTED" });
        suggested++;
      } else if (result.decision === "REVIEW") {
        rows.push({ group_id: groupId, budget_item_id: null, method: "SEMANTIC", score: result.confidence, reason: result.reason, status: "REVIEW" });
        review++;
      } else {
        rows.push({ group_id: groupId, budget_item_id: null, method: "SEMANTIC", score: result.confidence, reason: result.reason, status: "NO_MATCH" });
        noMatch++;
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("bim_group_matches").insert(rows);
    if (error) {
      return { elementCount: elements.length, groupCount: lockedGroupCount + drafts.length, suggested, review, reviewRequired, noMatch, totalTokens, latencyMs: Date.now() - startedAt, error: error.message };
    }
  }

  await logAudit(supabase, {
    action: "bim.groups_processed",
    detail: { project_id: projectId, bim_model_id: bimModelId, element_count: elements.length, group_count: drafts.length, suggested, review, review_required: reviewRequired, no_match: noMatch },
  });

  revalidatePath(`/projects/${projectId}`);
  return {
    elementCount: elements.length,
    groupCount: lockedGroupCount + drafts.length,
    suggested,
    review,
    reviewRequired,
    noMatch,
    totalTokens,
    latencyMs: Date.now() - startedAt,
    error: null,
  };
}

export async function getBimGroupsData(
  projectId: string,
  bimModelId: string
): Promise<{
  groups: BimElementGroup[];
  matches: BimGroupMatch[];
  elements: BimElement[];
  budgetItems: BudgetItem[];
  error: string | null;
}> {
  try {
    const { supabase } = await assertProjectAccess(projectId);
    const [{ data: groups }, { data: elements }, { data: budgetItems }] = await Promise.all([
      supabase.from("bim_element_groups").select("*").eq("bim_model_id", bimModelId).order("created_at").returns<BimElementGroup[]>(),
      supabase.from("bim_elements").select("*").eq("bim_model_id", bimModelId).returns<BimElement[]>(),
      supabase.from("budget_items").select("*").eq("project_id", projectId).returns<BudgetItem[]>(),
    ]);

    const groupIds = (groups ?? []).map((g) => g.id);
    let matches: BimGroupMatch[] = [];
    if (groupIds.length > 0) {
      const { data } = await supabase.from("bim_group_matches").select("*").in("group_id", groupIds).returns<BimGroupMatch[]>();
      matches = data ?? [];
    }

    return { groups: groups ?? [], matches, elements: elements ?? [], budgetItems: budgetItems ?? [], error: null };
  } catch (e) {
    return { groups: [], matches: [], elements: [], budgetItems: [], error: e instanceof Error ? e.message : "Error." };
  }
}

// El usuario confirma el rubro sugerido (o elige otro manualmente: method
// pasa a MANUAL). Un grupo tiene a lo sumo un match CONFIRMADO vigente
// (índice único parcial en la migración).
export async function confirmGroupMatch(
  projectId: string,
  groupId: string,
  budgetItemId: string
): Promise<{ error: string | null }> {
  const { profile, supabase } = await assertProjectAccess(projectId);

  const { data: existing } = await supabase
    .from("bim_group_matches")
    .select("id, budget_item_id")
    .eq("group_id", groupId)
    .in("status", ["SUGGESTED", "REVIEW", "REVIEW_REQUIRED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && existing.budget_item_id === budgetItemId) {
    const { error } = await supabase
      .from("bim_group_matches")
      .update({ status: "CONFIRMED", confirmed_by: profile.id, confirmed_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    // Rubro distinto al sugerido (o no había sugerencia): match manual nuevo.
    const { error } = await supabase.from("bim_group_matches").insert({
      group_id: groupId,
      budget_item_id: budgetItemId,
      method: "MANUAL",
      status: "CONFIRMED",
      confirmed_by: profile.id,
      confirmed_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
  }

  await logAudit(supabase, { action: "bim.group_match_confirmed", detail: { project_id: projectId, group_id: groupId, budget_item_id: budgetItemId } });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

// "Dejar sin asignar" — decisión humana explícita, distinta de NO_MATCH (que
// es una conclusión de la IA). Nunca se mezclan en el mismo estado.
export async function rejectGroupMatch(projectId: string, groupId: string): Promise<{ error: string | null }> {
  const { profile, supabase } = await assertProjectAccess(projectId);
  const { error } = await supabase.from("bim_group_matches").insert({
    group_id: groupId,
    budget_item_id: null,
    method: "MANUAL",
    status: "REJECTED",
    confirmed_by: profile.id,
    confirmed_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
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

// Actualiza budget_items.quantity con la suma de cantidades BIM confirmadas
// para ese rubro. SOLO por acción explícita del usuario (botón "Actualizar
// cantidad desde BIM" en la UI) — nunca se dispara automáticamente al
// confirmar un match, y nunca reconcilia en el otro sentido.
export async function applyBimQuantityToBudgetItem(
  projectId: string,
  budgetItemId: string
): Promise<{ error: string | null; appliedQuantity: number | null; warning: string | null }> {
  const { supabase } = await assertProjectAccess(projectId);

  const { data: item } = await supabase
    .from("budget_items")
    .select("*")
    .eq("id", budgetItemId)
    .eq("project_id", projectId)
    .single<BudgetItem>();
  if (!item) return { error: "Ítem de presupuesto no encontrado.", appliedQuantity: null, warning: null };

  const { data: confirmedMatches } = await supabase
    .from("bim_budget_matches")
    .select("bim_element_id")
    .eq("budget_item_id", budgetItemId)
    .eq("status", "CONFIRMADO");
  const elementIds = (confirmedMatches ?? []).map((m) => m.bim_element_id as string);
  if (elementIds.length === 0) {
    return { error: "Este rubro no tiene elementos BIM confirmados.", appliedQuantity: null, warning: null };
  }

  const { data: elements } = await supabase
    .from("bim_elements")
    .select("*")
    .in("id", elementIds)
    .returns<BimElement[]>();

  const { totalQuantity, incompatible } = aggregateElementsForBudgetItem(elements ?? [], item);
  if (totalQuantity == null) {
    return {
      error: "Ninguno de los elementos confirmados tiene una cantidad con unidad compatible.",
      appliedQuantity: null,
      warning: null,
    };
  }

  const { error } = await supabase.from("budget_items").update({ quantity: totalQuantity }).eq("id", budgetItemId);
  if (error) return { error: error.message, appliedQuantity: null, warning: null };

  revalidatePath(`/projects/${projectId}`);
  const warning =
    incompatible.length > 0
      ? `${incompatible.length} elemento(s) con unidad incompatible se excluyeron de la suma.`
      : null;
  return { error: null, appliedQuantity: totalQuantity, warning };
}

export async function getBimModelFileUrl(
  projectId: string,
  modelId: string
): Promise<{ url: string | null; error: string | null }> {
  const { supabase } = await assertProjectAccess(projectId);
  const { data: model } = await supabase
    .from("bim_models")
    .select("storage_path")
    .eq("id", modelId)
    .eq("project_id", projectId)
    .single();
  if (!model) return { url: null, error: "Modelo no encontrado." };
  const { data, error } = await supabase.storage.from("bim-models").createSignedUrl(model.storage_path, 600);
  if (error || !data) return { url: null, error: error?.message ?? "No se pudo generar la URL del archivo." };
  return { url: data.signedUrl, error: null };
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
