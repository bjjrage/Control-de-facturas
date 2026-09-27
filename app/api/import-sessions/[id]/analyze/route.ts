import { after } from "next/server";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadImportSession } from "@/lib/certificates/import-session-store";
import { runImportSessionAnalysis } from "@/lib/certificates/import-session-analysis";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Reanalizar: vuelve a correr Luna sobre la copia de trabajo actual. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const session = await loadImportSession(supabase, profile.empresa_id, id);
  if (!session) return Response.json({ error: "Sesión no encontrada." }, { status: 404 });
  if (session.status === "CONFIRMED" || session.status === "DISCARDED") {
    return Response.json({ error: "La sesión ya fue cerrada." }, { status: 409 });
  }
  // Un análisis que lleva más que el máximo de la ruta murió por timeout:
  // se permite relanzarlo en vez de dejar la sesión trabada.
  const startedAt = session.analysisStartedAt ? Date.parse(session.analysisStartedAt) : 0;
  const stale = Date.now() - startedAt > 6 * 60 * 1000;
  if (session.status === "ANALYZING" && !stale) return Response.json({ status: "ANALYZING" });

  after(() => runImportSessionAnalysis(supabase, profile.empresa_id, id));
  return Response.json({ status: "ANALYZING" });
}
