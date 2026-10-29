import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CERTIFICATE_WORKBOOKS_BUCKET } from "@/lib/certificates/workbook-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { id } = await params;
  const db = await createClient();
  const { data } = await db.from("workbook_import_sessions").select("original_storage_path, original_file_name, original_file_hash, candidate, working_revision")
    .eq("empresa_id", profile.empresa_id).eq("confirmed_project_id", id).eq("status", "CONFIRMED").maybeSingle();
  if (!data) return Response.json({ error: "Fuente no encontrada." }, { status: 404 });
  if (new URL(request.url).searchParams.get("evidence") === "1") return Response.json({ fileName: data.original_file_name, sha256: data.original_file_hash, revision: data.working_revision, mapping: data.candidate });
  const { data: signed, error } = await db.storage.from(CERTIFICATE_WORKBOOKS_BUCKET).createSignedUrl(data.original_storage_path, 60, { download: data.original_file_name });
  if (error || !signed) return Response.json({ error: "No se pudo descargar el original." }, { status: 502 });
  return Response.redirect(signed.signedUrl);
}
