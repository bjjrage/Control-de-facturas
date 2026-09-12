"use server";

// Importador de cómputo métrico (Excel/PDF) — mismo pipeline de matching
// semántico que BIM (DeepSeek + confirmación humana), para proyectos SIN
// modelo IFC. Tablas propias (computo_imports/computo_items/
// computo_item_matches, ver 0075_computo_import.sql), aisladas de bim_* — acá
// una fila ya es un ítem, no hace falta agrupar elementos técnicamente
// iguales como en BIM.
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { buildCandidatePool, toSemanticMatchInput } from "@/lib/bim/semantic-pipeline";
import { DeepSeekBatchSemanticMatcher, type BatchMatchItem } from "@/lib/bim/deepseek-batch-matcher";
import { checkTechnicalIntegrity } from "@/lib/bim/technical-integrity";
import { computoItemToBimElement } from "@/lib/computo/computo-mapper";
import { extractComputoFromPdf } from "@/lib/computo/pdf-extractor";
import type { ComputoImport, ComputoItem, ComputoItemMatch, BudgetItem } from "@/lib/types";

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

export async function getComputoUploadSlot(
  projectId: string,
  fileName: string
): Promise<{ storagePath: string; error: string | null }> {
  await assertProjectAccess(projectId);
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-120);
  const storagePath = `${projectId}/${randomUUID()}-${safeName}`;
  return { storagePath, error: null };
}

async function matchableBudgetItems(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
  const { data: budgetItems } = await supabase.from("budget_items").select("*").eq("project_id", projectId).returns<BudgetItem[]>();
  if (!budgetItems) return [];
  const parentIds = new Set(budgetItems.map((b) => b.parent_id).filter(Boolean));
  return budgetItems.filter((b) => !parentIds.has(b.id) && b.unit_price != null);
}

// Corre el matching en lote sobre TODOS los computo_items de un import que
// todavía no tienen match — nunca pisa una decisión humana (CONFIRMED/
// REJECTED ya existentes quedan intactos porque simplemente no se
// re-consultan). Idéntico patrón de integridad técnica que BIM: se corre
// ANTES de llamar a DeepSeek, y si el item está viciado se fuerza
// REVIEW_REQUIRED conservando la sugerencia de DeepSeek como informativa.
async function runComputoMatching(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  computoImportId: string
): Promise<{ suggested: number; review: number; reviewRequired: number; noMatch: number; error: string | null }> {
  const empty = { suggested: 0, review: 0, reviewRequired: 0, noMatch: 0, error: null };

  const { data: items } = await supabase
    .from("computo_items")
    .select("*")
    .eq("computo_import_id", computoImportId)
    .returns<ComputoItem[]>();
  if (!items || items.length === 0) return empty;

  const { data: existingMatches } = await supabase
    .from("computo_item_matches")
    .select("computo_item_id")
    .in("computo_item_id", items.map((i) => i.id))
    .returns<{ computo_item_id: string }[]>();
  const alreadyMatched = new Set((existingMatches ?? []).map((m) => m.computo_item_id));
  const pendingItems = items.filter((i) => !alreadyMatched.has(i.id));
  if (pendingItems.length === 0) return empty;

  const matchable = await matchableBudgetItems(supabase, projectId);
  if (matchable.length === 0) {
    return { ...empty, error: "El proyecto todavía no tiene ítems de presupuesto para comparar." };
  }

  let matcher: DeepSeekBatchSemanticMatcher;
  try {
    matcher = new DeepSeekBatchSemanticMatcher();
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "No se pudo inicializar el matcher semántico." };
  }

  const BATCH_SIZE = 8;
  let suggested = 0;
  let review = 0;
  let reviewRequired = 0;
  let noMatch = 0;
  const rows: {
    computo_item_id: string;
    budget_item_id: string | null;
    method: "SEMANTIC";
    score: number;
    reason: string;
    status: "SUGGESTED" | "REVIEW" | "REVIEW_REQUIRED" | "NO_MATCH";
  }[] = [];

  for (let i = 0; i < pendingItems.length; i += BATCH_SIZE) {
    const chunk = pendingItems.slice(i, i + BATCH_SIZE);
    const integrityByItem = new Map<string, ReturnType<typeof checkTechnicalIntegrity>>();
    const batchInput: BatchMatchItem[] = chunk.map((item) => {
      const element = computoItemToBimElement(item);
      const candidates = buildCandidatePool(element, matchable);
      integrityByItem.set(item.id, checkTechnicalIntegrity(element, matchable));
      return { elementId: item.id, input: toSemanticMatchInput(element, candidates) };
    });

    let batchResults;
    try {
      batchResults = await matcher.matchBatch(batchInput);
    } catch (e) {
      return {
        suggested,
        review,
        reviewRequired,
        noMatch,
        error: `Se procesaron ${suggested + review + reviewRequired + noMatch} ítems antes de un error de DeepSeek: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    for (const item of chunk) {
      const result = batchResults.get(item.id);
      if (!result) continue;
      const integrity = integrityByItem.get(item.id);

      if (integrity?.vicious) {
        const suggestedCandidateId = result.decision === "MATCH" ? result.candidateId : null;
        const reasonText = result.reason ? `[${integrity.reason}] ${result.reason}` : `[${integrity.reason}] Input contradictorio o ambiguo — requiere revisión humana.`;
        rows.push({ computo_item_id: item.id, budget_item_id: suggestedCandidateId, method: "SEMANTIC", score: result.confidence, reason: reasonText, status: "REVIEW_REQUIRED" });
        reviewRequired++;
      } else if (result.decision === "MATCH" && result.candidateId) {
        rows.push({ computo_item_id: item.id, budget_item_id: result.candidateId, method: "SEMANTIC", score: result.confidence, reason: result.reason, status: "SUGGESTED" });
        suggested++;
      } else if (result.decision === "REVIEW") {
        rows.push({ computo_item_id: item.id, budget_item_id: null, method: "SEMANTIC", score: result.confidence, reason: result.reason, status: "REVIEW" });
        review++;
      } else {
        rows.push({ computo_item_id: item.id, budget_item_id: null, method: "SEMANTIC", score: result.confidence, reason: result.reason, status: "NO_MATCH" });
        noMatch++;
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("computo_item_matches").insert(rows);
    if (error) return { suggested, review, reviewRequired, noMatch, error: error.message };
  }

  return { suggested, review, reviewRequired, noMatch, error: null };
}

export interface ImportComputoExcelResult {
  computoImportId: string | null;
  suggested: number;
  review: number;
  reviewRequired: number;
  noMatch: number;
  error: string | null;
}

// Cómputo desde Excel: datos ya estructurados por el usuario (mismo patrón de
// import-budget-dialog.tsx, HEADER_VARIANTS + auto-detección de columnas
// hecha client-side) — no hace falta gate de confianza, la ambigüedad de
// "¿es una tabla real?" no existe cuando el propio usuario mapeó las columnas.
export async function importComputoExcel(
  projectId: string,
  fileName: string,
  rows: { description: string; quantity: number | null; unit: string | null }[]
): Promise<ImportComputoExcelResult> {
  const { profile, supabase } = await assertProjectAccess(projectId);
  const empty: ImportComputoExcelResult = { computoImportId: null, suggested: 0, review: 0, reviewRequired: 0, noMatch: 0, error: null };
  if (rows.length === 0) return { ...empty, error: "El archivo no tiene filas para importar." };

  const { data: importRow, error: importError } = await supabase
    .from("computo_imports")
    .insert({
      project_id: projectId,
      source_type: "EXCEL",
      file_name: fileName,
      storage_path: "", // Excel no se sube a Storage — ya llega parseado a filas
      status: "LISTO",
      uploaded_by: profile.id,
    })
    .select("id")
    .single();
  if (importError || !importRow) return { ...empty, error: importError?.message ?? "No se pudo registrar la importación." };

  const itemRows = rows.map((r, idx) => ({
    computo_import_id: importRow.id,
    project_id: projectId,
    row_index: idx,
    description: r.description,
    quantity_value: r.quantity,
    quantity_unit: r.unit,
    raw_row: r,
  }));
  const { error: itemsError } = await supabase.from("computo_items").insert(itemRows);
  if (itemsError) return { ...empty, computoImportId: importRow.id, error: itemsError.message };

  const matchResult = await runComputoMatching(supabase, projectId, importRow.id);
  await logAudit(supabase, {
    action: "computo.imported",
    detail: { project_id: projectId, computo_import_id: importRow.id, source_type: "EXCEL", row_count: rows.length, ...matchResult },
  });
  revalidatePath(`/projects/${projectId}`);
  return { computoImportId: importRow.id, ...matchResult };
}

export interface ImportComputoPdfResult extends ImportComputoExcelResult {
  vicious: boolean;
  confidenceSummary: unknown;
}

// Cómputo desde PDF: el binario ya está en Storage (subido client-side vía
// getComputoUploadSlot, mismo patrón que BIM sube el IFC). Acá se descarga
// server-side, se corre el gate de 3 capas, y SOLO si no está viciado se
// dispara el matching automático — si está viciado, las filas quedan
// cargadas (nada se pierde) pero en status BAJA_CONFIANZA, esperando que un
// humano las revise/corrija antes de pedir el matching (retryComputoMatching).
export async function importComputoPdf(projectId: string, fileName: string, storagePath: string): Promise<ImportComputoPdfResult> {
  const { profile, supabase } = await assertProjectAccess(projectId);
  const empty: ImportComputoPdfResult = {
    computoImportId: null,
    suggested: 0,
    review: 0,
    reviewRequired: 0,
    noMatch: 0,
    error: null,
    vicious: false,
    confidenceSummary: null,
  };

  const { data: fileData, error: downloadError } = await supabase.storage.from("computo-imports").download(storagePath);
  if (downloadError || !fileData) return { ...empty, error: downloadError?.message ?? "No se pudo leer el PDF subido." };

  const bytes = Buffer.from(await fileData.arrayBuffer());
  let extraction;
  try {
    extraction = await extractComputoFromPdf(bytes);
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "No se pudo procesar el PDF." };
  }

  const { data: importRow, error: importError } = await supabase
    .from("computo_imports")
    .insert({
      project_id: projectId,
      source_type: "PDF",
      file_name: fileName,
      storage_path: storagePath,
      status: extraction.vicious ? "BAJA_CONFIANZA" : "LISTO",
      confidence_summary: extraction.confidenceSummary,
      uploaded_by: profile.id,
    })
    .select("id")
    .single();
  if (importError || !importRow) return { ...empty, error: importError?.message ?? "No se pudo registrar la importación." };

  if (extraction.rows.length > 0) {
    const itemRows = extraction.rows.map((r, idx) => ({
      computo_import_id: importRow.id,
      project_id: projectId,
      row_index: idx,
      description: r.description,
      quantity_value: r.quantityRaw,
      quantity_unit: r.unitRaw,
      raw_row: r,
      row_confidence: r.confidence,
    }));
    const { error: itemsError } = await supabase.from("computo_items").insert(itemRows);
    if (itemsError) return { ...empty, computoImportId: importRow.id, error: itemsError.message };
  }

  let matchResult = { suggested: 0, review: 0, reviewRequired: 0, noMatch: 0, error: null as string | null };
  if (!extraction.vicious) {
    matchResult = await runComputoMatching(supabase, projectId, importRow.id);
  }

  await logAudit(supabase, {
    action: "computo.imported",
    detail: {
      project_id: projectId,
      computo_import_id: importRow.id,
      source_type: "PDF",
      row_count: extraction.rows.length,
      vicious: extraction.vicious,
      ...matchResult,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  return { computoImportId: importRow.id, vicious: extraction.vicious, confidenceSummary: extraction.confidenceSummary, ...matchResult };
}

// El humano revisó filas BAJA_CONFIANZA (o decide igual seguir) y pide correr
// el matching que quedó pendiente por el gate.
export async function retryComputoMatching(projectId: string, computoImportId: string): Promise<ImportComputoExcelResult> {
  const { supabase } = await assertProjectAccess(projectId);
  const matchResult = await runComputoMatching(supabase, projectId, computoImportId);
  if (!matchResult.error) {
    await supabase.from("computo_imports").update({ status: "LISTO" }).eq("id", computoImportId);
  }
  revalidatePath(`/projects/${projectId}`);
  return { computoImportId, ...matchResult };
}

export async function getComputoData(
  projectId: string
): Promise<{ imports: ComputoImport[]; items: ComputoItem[]; matches: ComputoItemMatch[]; budgetItems: BudgetItem[]; error: string | null }> {
  try {
    const { supabase } = await assertProjectAccess(projectId);
    const [{ data: imports }, { data: items }, { data: budgetItems }] = await Promise.all([
      supabase.from("computo_imports").select("*").eq("project_id", projectId).order("created_at").returns<ComputoImport[]>(),
      supabase.from("computo_items").select("*").eq("project_id", projectId).returns<ComputoItem[]>(),
      supabase.from("budget_items").select("*").eq("project_id", projectId).returns<BudgetItem[]>(),
    ]);

    const itemIds = (items ?? []).map((i) => i.id);
    let matches: ComputoItemMatch[] = [];
    if (itemIds.length > 0) {
      const { data } = await supabase.from("computo_item_matches").select("*").in("computo_item_id", itemIds).returns<ComputoItemMatch[]>();
      matches = data ?? [];
    }

    return { imports: imports ?? [], items: items ?? [], matches, budgetItems: budgetItems ?? [], error: null };
  } catch (e) {
    return { imports: [], items: [], matches: [], budgetItems: [], error: e instanceof Error ? e.message : "Error." };
  }
}

export async function confirmComputoMatch(projectId: string, computoItemId: string, budgetItemId: string): Promise<{ error: string | null }> {
  const { profile, supabase } = await assertProjectAccess(projectId);

  const { data: existing } = await supabase
    .from("computo_item_matches")
    .select("id, budget_item_id")
    .eq("computo_item_id", computoItemId)
    .in("status", ["SUGGESTED", "REVIEW", "REVIEW_REQUIRED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && existing.budget_item_id === budgetItemId) {
    const { error } = await supabase
      .from("computo_item_matches")
      .update({ status: "CONFIRMED", confirmed_by: profile.id, confirmed_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("computo_item_matches").insert({
      computo_item_id: computoItemId,
      budget_item_id: budgetItemId,
      method: "MANUAL",
      status: "CONFIRMED",
      confirmed_by: profile.id,
      confirmed_at: new Date().toISOString(),
    });
    if (error) return { error: error.message };
  }

  await logAudit(supabase, { action: "computo.match_confirmed", detail: { project_id: projectId, computo_item_id: computoItemId, budget_item_id: budgetItemId } });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function rejectComputoMatch(projectId: string, computoItemId: string): Promise<{ error: string | null }> {
  const { profile, supabase } = await assertProjectAccess(projectId);
  const { error } = await supabase.from("computo_item_matches").insert({
    computo_item_id: computoItemId,
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

export interface ComputoExportRow {
  code: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
}

// Cierra el círculo: el costeador se lleva el mismo Excel que ya maneja, con
// las cantidades confirmadas ya cruzadas contra su catálogo. Solo lectura —
// el cálculo de costo real sigue viviendo en Presupuesto, esto es un export.
export async function getComputoExportRows(projectId: string, computoImportId: string): Promise<{ rows: ComputoExportRow[]; error: string | null }> {
  try {
    const { supabase } = await assertProjectAccess(projectId);
    const { data: items } = await supabase.from("computo_items").select("*").eq("computo_import_id", computoImportId).returns<ComputoItem[]>();
    if (!items || items.length === 0) return { rows: [], error: null };

    const { data: matches } = await supabase
      .from("computo_item_matches")
      .select("*")
      .in("computo_item_id", items.map((i) => i.id))
      .eq("status", "CONFIRMED")
      .returns<ComputoItemMatch[]>();

    const budgetItemIds = [...new Set((matches ?? []).map((m) => m.budget_item_id).filter((id): id is string => !!id))];
    const { data: budgetItems } = budgetItemIds.length > 0
      ? await supabase.from("budget_items").select("*").in("id", budgetItemIds).returns<BudgetItem[]>()
      : { data: [] as BudgetItem[] };
    const budgetItemById = new Map((budgetItems ?? []).map((b) => [b.id, b]));
    const matchByItemId = new Map((matches ?? []).map((m) => [m.computo_item_id, m]));

    const rows: ComputoExportRow[] = items
      .map((item) => {
        const match = matchByItemId.get(item.id);
        if (!match?.budget_item_id) return null;
        const budgetItem = budgetItemById.get(match.budget_item_id);
        if (!budgetItem || item.quantity_value == null) return null;
        const total = budgetItem.unit_price != null ? item.quantity_value * budgetItem.unit_price : null;
        return { code: budgetItem.code, description: budgetItem.description, quantity: item.quantity_value, unit: budgetItem.unit, unit_price: budgetItem.unit_price, total };
      })
      .filter((r): r is ComputoExportRow => r !== null);

    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "Error." };
  }
}
