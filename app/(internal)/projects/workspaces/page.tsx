import Link from "next/link";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonClassName } from "@/components/ui/button";
import { readAll } from "@/lib/cashflow/load";

export default async function ProjectWorkspacesPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const rows = await readAll<{ id: string; name: string; updated_at: string }>((from, to) => db.from("project_workspaces").select("id,name,updated_at", { count: "exact" }).eq("empresa_id", profile.empresa_id).order("updated_at", { ascending: false }).order("id").range(from, to));
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Mis trabajos</h1><Link prefetch={false} href="/projects/workspaces/new" className={buttonClassName()}>Nuevo workspace de obra</Link></div>
    <Link href="/projects" className="text-sm text-[var(--primary)]">Volver a Obras</Link>
    <div className="rounded-lg border border-[var(--border)]"><table><thead><tr><th>Trabajo</th><th>Estado</th><th>Actualizado</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>En preparación</td><td>{new Date(row.updated_at).toLocaleString("es-PY", { timeZone: "America/Asuncion" })}</td><td><Link prefetch={false} href={`/projects/workspaces/${row.id}`} className="text-[var(--primary)]">Abrir</Link></td></tr>)}</tbody></table>{!rows.length ? <p className="p-4 text-sm text-[var(--muted)]">Sin trabajos</p> : null}</div>
  </section>;
}
