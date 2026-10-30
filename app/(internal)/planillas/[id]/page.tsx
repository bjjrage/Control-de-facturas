import { notFound } from "next/navigation";
import { obtenerPlanilla, PlanillaNotFoundError } from "@/lib/planillas/service";
import { getPlanillaAdapter } from "@/lib/planillas/registry";
import { PlanillaSessionClient } from "./planilla-session-client";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceOperationalData } from "../../projects/import-workspace-actions";
import type { CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import type { WorkspaceMaterial } from "@/lib/workbook-interpretation/import-workspace";
import { getCurrentProfile } from "@/lib/auth";
import type { OperationalInputs } from "@/lib/planillas/operational-projection";

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
  let linkedCandidate: CanonicalImportCandidate | undefined;
  let materials: WorkspaceMaterial[] = [];
  let operationalInputs: OperationalInputs | undefined;
  if (projectId) {
    const db = await createClient();
    const { data, error } = await db.from("workbook_import_sessions").select("candidate")
      .eq("empresa_id", planilla.empresa_id).eq("confirmed_project_id", projectId).eq("status", "CONFIRMED").maybeSingle();
    if (error) throw new Error("No se pudo verificar el estado de las cantidades de origen.");
    referenceQuantities = data?.candidate?.quantityStatus === "REFERENCE";
    const profile = await getCurrentProfile();
    if (data?.candidate && profile && ["admin", "administracion"].includes(profile.role)) {
      linkedCandidate = data.candidate as CanonicalImportCandidate;
      operationalInputs = await getWorkspaceOperationalData(projectId);
      materials = operationalInputs.materials;
    }
  }

  return (
    <PlanillaSessionClient
      key={planilla.id}
      planillaId={planilla.id}
      initialVersion={planilla.updated_at}
      projectId={projectId}
      referenceQuantities={referenceQuantities}
      linkedCandidate={linkedCandidate}
      initialMaterials={materials}
      initialOperationalInputs={operationalInputs}
      estado={planilla.estado}
      columns={adapter.columns}
      initialRows={planilla.snapshot.rows}
      volverUrl={volver && volver.startsWith("/") ? volver : "/projects"}
    />
  );
}
