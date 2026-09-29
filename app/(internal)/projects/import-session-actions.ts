"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { buildCanonicalImportCandidate, type CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { computeStructureHash, ensureSnapshotFormatting, workbookFromSnapshot, type WorkingSnapshot } from "@/lib/certificates/workbook-store";
import { loadImportSession, suggestContractRegime, type ImportSession } from "@/lib/certificates/import-session-store";

/**
 * Fase 4 de "Certificados Excel-first" — sesión de importación de obra nueva
 * (ver [[excel-first-certificados]]). La obra se crea recién al confirmar,
 * con createProjectFromWorkbook(session_id) — el mismo código que ya aplica
 * presupuesto, certificado, curva, clima y avance.
 */

export type ImportSessionView = Omit<ImportSession, "originalStoragePath"> & {
  /** El análisis corresponde a una estructura vieja: hay que reanalizar. */
  analysisStale: boolean;
};

function toView(session: ImportSession): ImportSessionView {
  const { originalStoragePath: _omit, ...rest } = session;
  void _omit;
  return {
    ...rest,
    analysisStale: Boolean(session.analyzedStructureHash && session.analyzedStructureHash !== session.structureHash),
  };
}

export async function getImportSession(sessionId: string): Promise<{ error: string | null; session: ImportSessionView | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const session = await loadImportSession(supabase, profile.empresa_id, sessionId);
  if (!session) return { error: "Sesión no encontrada.", session: null };
  const formatted = await ensureSnapshotFormatting(supabase, session.workingSnapshot, session.originalStoragePath);
  if (formatted.changed && session.status !== "CONFIRMED" && session.status !== "DISCARDED") {
    await supabase.from("workbook_import_sessions").update({ working_snapshot: formatted.snapshot }).eq("id", sessionId).eq("empresa_id", profile.empresa_id);
  }
  return { error: null, session: toView({ ...session, workingSnapshot: formatted.snapshot }) };
}

/**
 * Autoguardado de la planilla de la sesión. Si la ESTRUCTURA no cambió, el
 * mapeo de Luna sigue valiendo: se vuelve a extraer con el extractor
 * determinístico (milisegundos, sin Luna) para que la vista previa refleje
 * los valores editados. Si cambió, se marca para reanalizar.
 */
export async function saveImportSessionSnapshot(
  sessionId: string,
  snapshot: WorkingSnapshot
): Promise<{ error: string | null; structureChanged: boolean }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const session = await loadImportSession(supabase, profile.empresa_id, sessionId);
  if (!session) return { error: "Sesión no encontrada.", structureChanged: false };
  if (session.status === "CONFIRMED" || session.status === "DISCARDED") {
    return { error: "La sesión ya fue cerrada; la planilla no se puede editar acá.", structureChanged: false };
  }

  const structureHash = computeStructureHash(snapshot);
  const structureChanged = Boolean(session.analyzedStructureHash) && structureHash !== session.analyzedStructureHash;
  let candidate: CanonicalImportCandidate | null = session.candidate;
  if (session.interpretation && !structureChanged && session.status === "ANALYZED") {
    candidate = buildCanonicalImportCandidate(workbookFromSnapshot(snapshot), session.interpretation);
  }

  const { error } = await supabase
    .from("workbook_import_sessions")
    .update({
      working_snapshot: snapshot,
      structure_hash: structureHash,
      working_revision: session.workingRevision + 1,
      candidate,
      ...(candidate ? { suggested_regime: suggestContractRegime(candidate) } : {}),
    })
    .eq("id", sessionId)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: "No se pudo guardar la planilla.", structureChanged };
  return { error: null, structureChanged };
}

export async function discardImportSession(sessionId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("workbook_import_sessions")
    .update({ status: "DISCARDED" })
    .eq("id", sessionId)
    .eq("empresa_id", profile.empresa_id)
    .not("status", "in", "(CONFIRMED,DISCARDED)");
  if (error) return { error: "No se pudo descartar la sesión." };
  return { error: null };
}
