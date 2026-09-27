import { after } from "next/server";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createImportSession } from "@/lib/certificates/import-session-store";
import { runImportSessionAnalysis } from "@/lib/certificates/import-session-analysis";

export const runtime = "nodejs";
// El análisis corre en after() — hasta el máximo de la ruta, con la
// respuesta ya enviada y la planilla ya visible para el usuario.
export const maxDuration = 300;

/**
 * Fase 4 de Excel-first — obra nueva: guarda el Excel completo en una sesión
 * (sin crear la obra) y lanza el análisis de Luna en segundo plano.
 */
export async function POST(request: Request) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Seleccioná una planilla." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "El archivo supera el límite de 10 MB." }, { status: 413 });

  const supabase = await createClient();
  const result = await createImportSession(supabase, {
    empresaId: profile.empresa_id,
    userId: profile.id,
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (result.error || !result.id) return Response.json({ error: result.error ?? "No se pudo guardar la planilla." }, { status: 400 });

  const sessionId = result.id;
  after(() => runImportSessionAnalysis(supabase, profile.empresa_id, sessionId));
  return Response.json({ sessionId });
}
