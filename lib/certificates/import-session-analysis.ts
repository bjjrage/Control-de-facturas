import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { interpretWorkbook } from "@/lib/workbook-interpretation/interpreter";
import { loadImportSession, suggestContractRegime } from "./import-session-store";
import { workbookFromSnapshot } from "./workbook-store";

/**
 * Luna analiza la copia de trabajo GUARDADA de la sesión (no el archivo
 * subido): así el análisis refleja lo que el usuario ve y edita, y se puede
 * repetir sin volver a subir nada. Se llama desde after() en los route
 * handlers — la respuesta ya volvió y la planilla ya está en pantalla.
 *
 * Luna devuelve el plan (qué es cada hoja/rango/columna); los valores los
 * copia el extractor determinístico (buildCanonicalImportCandidate), que
 * además no deja aplicar un certificado cuyos montos guardados no
 * reproduzcan el documento.
 */
export async function runImportSessionAnalysis(supabase: SupabaseClient, empresaId: string, sessionId: string): Promise<void> {
  const session = await loadImportSession(supabase, empresaId, sessionId);
  if (!session || session.status === "CONFIRMED" || session.status === "DISCARDED") return;

  await supabase
    .from("workbook_import_sessions")
    .update({ status: "ANALYZING", analysis_started_at: new Date().toISOString(), analysis_error: null })
    .eq("id", sessionId)
    .eq("empresa_id", empresaId);

  try {
    const workbook = workbookFromSnapshot(session.workingSnapshot);
    const interpretation = await interpretWorkbook(workbook);
    const candidate = buildCanonicalImportCandidate(workbook, interpretation);
    await supabase
      .from("workbook_import_sessions")
      .update({
        status: "ANALYZED",
        interpretation,
        candidate,
        analyzed_structure_hash: session.structureHash,
        analyzed_at: new Date().toISOString(),
        suggested_regime: suggestContractRegime(candidate),
      })
      .eq("id", sessionId)
      .eq("empresa_id", empresaId);
  } catch (cause) {
    console.error("[import-session] analysis failed", sessionId, cause);
    await supabase
      .from("workbook_import_sessions")
      .update({
        status: "ANALYSIS_FAILED",
        analysis_error: cause instanceof Error ? cause.message : "No se pudo analizar la planilla.",
      })
      .eq("id", sessionId)
      .eq("empresa_id", empresaId);
  }
}
