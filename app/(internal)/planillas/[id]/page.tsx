import { notFound } from "next/navigation";
import { obtenerPlanilla, PlanillaNotFoundError } from "@/lib/planillas/service";
import { getPlanillaAdapter } from "@/lib/planillas/registry";
import { PlanillaSessionClient } from "./planilla-session-client";

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

  return (
    <PlanillaSessionClient
      planillaId={planilla.id}
      estado={planilla.estado}
      columns={adapter.columns}
      initialRows={planilla.snapshot.rows}
      volverUrl={volver && volver.startsWith("/") ? volver : "/projects"}
    />
  );
}
