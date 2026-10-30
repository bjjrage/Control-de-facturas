import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import type { ImportSession } from "./import-session-store";

export async function createLinkedWorkbookProject(db: SupabaseClient, args: {
  session: ImportSession; candidate: CanonicalImportCandidate; name: string; code: string;
  regime: string; quantityStatus: "REFERENCE" | "CONFIRMED"; applySchedule: boolean;
}) {
  const recipes = args.candidate.linkedRecipes;
  if (!recipes?.recipes.length || recipes.issues.length) {
    return { error: recipes?.issues.join(" ") || "No hay recetas verificadas para aplicar.", projectId: undefined };
  }
  const { data, error } = await db.rpc("create_linked_workbook_project", {
    p_session: args.session.id,
    p_expected_revision: args.session.workingRevision,
    p_project: { name: args.name, code: args.code, regime: args.regime, quantityStatus: args.quantityStatus, applySchedule: args.applySchedule },
    p_candidate: args.candidate,
  });
  if (error) return { error: `No se creó la obra: ${error.message}`, projectId: undefined };
  return { error: null, projectId: String(data.projectId), applied: data.applied, pending: data.pending ?? [] };
}
