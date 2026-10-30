"use server";

import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadImportSession } from "@/lib/certificates/import-session-store";
import { validateImportDraft } from "@/lib/workbook-interpretation/import-workspace";
import { crearPlanilla } from "@/lib/planillas/service";
import { actualizarSnapshot } from "@/lib/planillas/service";
import { allRowsResult } from "@/lib/supabase/all-rows-result";
import type { WorkspaceMaterial } from "@/lib/workbook-interpretation/import-workspace";
import type { PlanillaRow } from "@/lib/planillas/types";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { workbookFromSnapshot } from "@/lib/certificates/workbook-store";

export async function getImportWorkspace(id: string) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const session = await loadImportSession(await createClient(), profile.empresa_id, id);
  if (!session || session.status === "DISCARDED") return null;
  // The large source workbook is fetched only when its tab is opened.
  const { workingSnapshot: _snapshot, originalStoragePath: _path, ...view } = session;
  void _snapshot; void _path;
  const candidate = session.status === "ANALYZED" && session.interpretation
    ? buildCanonicalImportCandidate(workbookFromSnapshot(session.workingSnapshot), session.interpretation) : session.candidate;
  return { ...view, candidate, analysisStale: session.analyzedStructureHash !== session.structureHash };
}
export type ImportWorkspaceView = NonNullable<Awaited<ReturnType<typeof getImportWorkspace>>>;

export async function listPendingImportWorkspaces() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const { data, error } = await db.from("workbook_import_sessions")
    .select("id,original_file_name,status,created_at").eq("empresa_id", profile.empresa_id)
    .in("status", ["UPLOADED", "ANALYZING", "ANALYZED", "ANALYSIS_FAILED"]).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("No se pudieron consultar los borradores de importación.");
  return data ?? [];
}

export async function saveImportWorkspace(id: string, expectedRevision: number, raw: unknown) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const session = await loadImportSession(db, profile.empresa_id, id);
  if (!session?.candidate || session.status !== "ANALYZED") return { error: "El análisis no está listo o la importación ya fue confirmada." };
  if (!Number.isInteger(expectedRevision) || expectedRevision !== session.workingRevision) return { error: "Otra sesión modificó este borrador. Descargá tus cambios y volvé a abrirlo." };
  try {
    const draft = validateImportDraft(raw, session.candidate);
    const { data, error } = await db.from("workbook_import_sessions")
      .update({ workspace_draft: draft, working_revision: expectedRevision + 1 })
      .eq("id", id).eq("empresa_id", profile.empresa_id).eq("working_revision", expectedRevision).eq("status", "ANALYZED")
      .select("working_revision").maybeSingle();
    if (error || !data) return { error: "El borrador cambió o no se pudo guardar. Conservá tus cambios y reintentá." };
    return { error: null, revision: data.working_revision as number };
  } catch (cause) { return { error: cause instanceof Error ? cause.message : "Borrador inválido." }; }
}

export async function openImportedProjectWorkspace(projectId: string) {
  // crearPlanilla checks role, plan and project company, and resumes an existing draft.
  const planilla = await crearPlanilla("computo_presupuesto", { projectId });
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const { data: source } = await db.from("workbook_import_sessions").select("workspace_draft")
    .eq("empresa_id", profile.empresa_id).eq("confirmed_project_id", projectId).eq("status", "CONFIRMED").maybeSingle();
  // Seed reviewed expressions only into a just-created, untouched draft.
  // Later reopenings retain the operational workspace's own revisions.
  if (source?.workspace_draft?.rows && planilla.created_at === planilla.updated_at) {
    const sourceRows = source.workspace_draft.rows as { code: string; quantity: number | null; unit_price: number | null; _formulas?: Record<string, string> }[];
    const rows = planilla.snapshot.rows as PlanillaRow[];
    if (sourceRows.length === rows.length && sourceRows.every((row, index) => row.code === rows[index].code && row.quantity === rows[index].quantity && row.unit_price === rows[index].unit_price)) {
      await actualizarSnapshot(planilla.id, rows.map((row, index) => ({ ...row, _formulas: sourceRows[index]._formulas ?? {} })), planilla.updated_at);
    }
  }
  return `/planillas/${planilla.id}?volver=${encodeURIComponent(`/projects/${projectId}?tab=presupuesto`)}`;
}

export async function getWorkspaceMaterials(projectId: string): Promise<WorkspaceMaterial[]> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const { data: project } = await db.from("projects").select("id").eq("id", projectId).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (!project) throw new Error("Obra no encontrada.");
  type Line = { budget_item_id: string; producto_id: string; cantidad_por_unidad_ejecutada: number; desperdicio_pct: number; productos: { nombre: string; unidad: string } | null; budget_items: { code: string } | null };
  const query = db.from("budget_item_materials")
    .select("budget_item_id,producto_id,cantidad_por_unidad_ejecutada,desperdicio_pct,productos(nombre,unidad),budget_items(code)")
    .eq("empresa_id", profile.empresa_id).eq("project_id", projectId);
  const { data, error } = await allRowsResult<Line>({ order: column => ({ range: (from, to) => query.order(column).range(from, to).overrideTypes<Line[], { merge: false }>() }) });
  if (error) throw new Error("No se pudieron consultar los materiales de la obra.");
  const materials = new Map<string, WorkspaceMaterial>();
  for (const line of data ?? []) {
    const material = materials.get(line.producto_id) ?? { key: line.producto_id, description: line.productos?.nombre ?? "Material", unit: line.productos?.unidad ?? "", links: [] };
    material.links.push({ rowId: line.budget_item_id, code: line.budget_items?.code ?? "", consumption: line.cantidad_por_unidad_ejecutada * (1 + line.desperdicio_pct / 100) });
    materials.set(line.producto_id, material);
  }
  return [...materials.values()];
}
