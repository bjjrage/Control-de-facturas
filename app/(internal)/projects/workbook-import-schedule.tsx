"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** Keep planning shortcuts in sync with the existing sidebar tab event. */
export function ProjectPlanningLink({ projectId, tab, children }: { projectId: string; tab: "cronograma" | "avance-fisico"; children: ReactNode }) {
  return <Link className="text-action underline" href={`/projects/${projectId}?tab=${tab}`} onNavigate={() => {
    if (window.location.pathname === `/projects/${projectId}`) {
      window.dispatchEvent(new CustomEvent("niupack:tab", { detail: tab }));
    }
  }}>{children}</Link>;
}

/** The general workbook importer saves monthly curves, not task dates. */
export function WorkbookImportSchedule({
  budgetItems,
  curveVersions,
  projectId,
}: {
  budgetItems: number;
  curveVersions: number;
  projectId?: string;
}) {
  return (
    <section aria-label="Curva S y Gantt" className="space-y-2 rounded-xl border border-[var(--border)] p-3 text-[12px]">
      <h3 className="font-semibold">Planificación: Curva S y Gantt</h3>
      <p><strong>Curva S — porcentajes por mes:</strong> {curveVersions > 0
        ? `${curveVersions} versión(es) ${projectId ? "importadas" : "detectadas"}.`
        : projectId ? "No importada." : "No detectada para importar."} Se consulta en Avance físico.</p>
      <p><strong>Gantt — fechas por partida: pendiente de programar.</strong></p>
      <p>{budgetItems > 0
        ? `Faltan las fechas de inicio y fin de las ${budgetItems} partidas del presupuesto para armar el Gantt.`
        : "Primero incorporá las partidas del presupuesto y sus fechas de inicio y fin."}</p>
      <p>En Cronograma podés importar una tabla con <strong>Código de partida, Inicio y Fin</strong>, o usar <strong>Programar partidas</strong>. La predecesora es opcional para vincular tareas.</p>
      <p className="text-[var(--muted)]">La Curva S y las fechas generales de la obra no determinan el inicio y fin de cada partida. Esta importación general carga la curva mensual; las fechas del Gantt se completan en Cronograma.</p>
      {projectId ? <div className="flex flex-wrap gap-4 pt-1">
        <ProjectPlanningLink projectId={projectId} tab="cronograma">Completar Gantt</ProjectPlanningLink>
        {curveVersions > 0 ? <ProjectPlanningLink projectId={projectId} tab="avance-fisico">Ver Curva S importada</ProjectPlanningLink> : null}
      </div> : null}
    </section>
  );
}
