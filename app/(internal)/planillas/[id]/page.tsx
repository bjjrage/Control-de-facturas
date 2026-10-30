import { notFound } from "next/navigation";
import { obtenerPlanilla, PlanillaNotFoundError } from "@/lib/planillas/service";
import { getPlanillaAdapter } from "@/lib/planillas/registry";
import { PlanillaSessionClient } from "./planilla-session-client";
import { createClient } from "@/lib/supabase/server";

export default async function PlanillaSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ volver?: string }>;
}) {
  const { id } = await params;
  const { volver } = await searchParams;

  let planilla;
  try {
    planilla = await obtenerPlanilla(id);
  } catch (e) {
    if (e instanceof PlanillaNotFoundError) notFound();
    throw e;
  }

  const adapter = getPlanillaAdapter(planilla.modulo);
  const projectId = typeof planilla.contexto.projectId === "string" ? planilla.contexto.projectId : undefined;
  let referenceQuantities = false;
  if (projectId) {
    const db = await createClient();
    const { data, error } = await db.from("workbook_import_sessions").select("candidate")
      .eq("empresa_id", planilla.empresa_id).eq("confirmed_project_id", projectId).eq("status", "CONFIRMED").maybeSingle();
    if (error) throw new Error("No se pudo verificar el estado de las cantidades de origen.");
    referenceQuantities = data?.candidate?.quantityStatus === "REFERENCE";
  }

  return (
    <PlanillaSessionClient
      planillaId={planilla.id}
      initialVersion={planilla.updated_at}
      projectId={projectId}
      referenceQuantities={referenceQuantities}
      estado={planilla.estado}
      columns={adapter.columns}
      initialRows={planilla.snapshot.rows}
      volverUrl={volver && volver.startsWith("/") ? volver : "/projects"}
    />
  );
}
