import type { SupabaseClient } from "@supabase/supabase-js";

export async function WorkbookSource({ db, projectId, empresaId }: { db: SupabaseClient; projectId: string; empresaId: string }) {
  const { data } = await db.from("workbook_import_sessions").select("original_file_name, candidate")
    .eq("empresa_id", empresaId).eq("confirmed_project_id", projectId).eq("status", "CONFIRMED").maybeSingle();
  if (!data?.candidate?.linkedImportResult) return null;
  const applied = data.candidate.linkedImportResult;
  return <section className="mb-4 rounded-xl border border-sky-300/20 p-3 text-sm">
    <p><strong>Fuente: {data.original_file_name}</strong> · {applied.budgetItems} partidas · {applied.recipes} recetas APU · {applied.scheduleVersions} cronograma(s).</p>
    <p>{data.candidate.quantityStatus === "REFERENCE" ? "Cantidades referenciales: pendientes de cómputo definitivo. El total del archivo no se adoptó como monto contractual." : "Cantidades confirmadas al importar."}</p>
    <p>Consumos y precios base documentales conservados. Los costos efectivos pueden variar con compras y precios adoptados.</p>
    <a className="mr-4 underline" href={`/api/projects/${projectId}/source-workbook`}>Descargar Excel original</a>
    <a className="underline" href={`/api/projects/${projectId}/source-workbook?evidence=1`}>Ver procedencia y fórmulas de los vínculos</a>
  </section>;
}
