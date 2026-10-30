import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceOperationalData } from "@/app/(internal)/projects/import-workspace-actions";
import { projectOperations } from "@/lib/planillas/operational-projection";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { id } = await params;
  const db = await createClient();
  const { data: project } = await db.from("projects").select("id").eq("id", id).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (!project) return Response.json({ error: "Obra no encontrada." }, { status: 404 });
  try {
    const data = await getWorkspaceOperationalData(id);
    return Response.json(projectOperations(data.rows, data), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "No se pudo calcular la proyección vigente. Reintentá." }, { status: 503 }); }
}
