import { ProjectsSection } from "./projects-section";
import { getProjectsPortfolioData } from "./portfolio-data";
import Link from "next/link";
import { listPendingImportWorkspaces } from "./import-workspace-actions";
import { getCurrentProfile } from "@/lib/auth";

export default async function ProjectsPage() {
  const data = await getProjectsPortfolioData();
  const profile = await getCurrentProfile();
  const pending = profile && ["admin", "administracion"].includes(profile.role) ? await listPendingImportWorkspaces() : [];
  return <>
    {pending.length ? <section className="mb-4 rounded-xl border border-sky-300/25 p-4" aria-label="Planillas en preparación"><h2 className="font-semibold">Planillas en preparación</h2><p className="mt-1 text-xs text-[var(--muted)]">Tu archivo ya está guardado. Retomá el workspace sin volver a subirlo.</p><ul className="mt-3 grid gap-2 sm:grid-cols-2">{pending.map(session => <li key={session.id}><Link href={`/projects/import/${session.id}`} className="block rounded border border-[var(--border)] p-3 text-sm hover:bg-sky-400/10">{session.original_file_name}<span className="ml-2 text-xs text-[var(--muted)]">{session.status === "ANALYZED" ? "Listo para revisar" : session.status === "ANALYSIS_FAILED" ? "Revisar análisis" : "Analizando…"}</span></Link></li>)}</ul></section> : null}
    <ProjectsSection data={data} />
  </>;
}
