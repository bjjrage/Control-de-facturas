import Link from "next/link";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Project } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectsChart } from "./projects-chart";
import { Button } from "@/components/ui/button";

const STATUS_TONE = {
  ACTIVO: "ok",
  PAUSADO: "warn",
  COMPLETADO: "neutral",
  CANCELADO: "error",
} as const;

const STATUS_LABELS: Record<string, string> = {
  ACTIVO: "Activo",
  PAUSADO: "Pausado",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
};

export default async function ProjectsPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  const list = projects ?? [];
  const projectIds = list.map((p) => p.id);
  const isCaterpillar = profile.plan === "caterpillar";

  const [{ data: budgetItems }, { data: orders }, { data: execEntries }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("budget_items").select("project_id, quantity, subtotal").in("project_id", projectIds)
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? supabase
          .from("authorized_orders")
          .select("project_id, total_price, currency")
          .in("project_id", projectIds)
          .eq("currency", "PYG")
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? supabase.from("execution_entries").select("project_id, budget_item_id, quantity_executed").in("project_id", projectIds)
      : Promise.resolve({ data: [] }),
  ]);

  const subtotalByProject = new Map<string, number>();
  const budgetQtyByProject = new Map<string, number>();
  for (const b of budgetItems ?? []) {
    const pid = b.project_id as string;
    subtotalByProject.set(pid, (subtotalByProject.get(pid) ?? 0) + (b.subtotal as number));
    if (b.quantity != null) {
      budgetQtyByProject.set(pid, (budgetQtyByProject.get(pid) ?? 0) + (b.quantity as number));
    }
  }

  const comprasByProject = new Map<string, number>();
  for (const o of orders ?? []) {
    const pid = o.project_id as string | null;
    if (!pid) continue;
    comprasByProject.set(pid, (comprasByProject.get(pid) ?? 0) + (o.total_price as number));
  }

  const execQtyByProject = new Map<string, number>();
  for (const e of execEntries ?? []) {
    const pid = e.project_id as string;
    execQtyByProject.set(pid, (execQtyByProject.get(pid) ?? 0) + (e.quantity_executed as number));
  }

  const rows = list.map((p) => {
    const presupuesto = Math.max(p.budget_total, subtotalByProject.get(p.id) ?? 0);
    const compras = comprasByProject.get(p.id) ?? 0;
    const budgetQty = budgetQtyByProject.get(p.id) ?? 0;
    const execQty = execQtyByProject.get(p.id) ?? 0;
    const avancePct = budgetQty > 0 ? Math.min(100, Math.round((execQty / budgetQty) * 100)) : 0;
    const comprasPct = presupuesto > 0 ? Math.round((compras / presupuesto) * 100) : 0;
    const enAlerta = comprasPct > 100;
    return { project: p, presupuesto, compras, comprasPct, avancePct, enAlerta };
  });

  let certificadosPendientes = 0;
  if (isCaterpillar && projectIds.length > 0) {
    const { count } = await supabase
      .from("subcontractor_certificates")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .eq("status", "PENDIENTE");
    certificadosPendientes = count ?? 0;
  }

  const proyectosActivos = list.filter((p) => p.status === "ACTIVO").length;
  const presupuestoTotal = rows.reduce((s, r) => s + r.presupuesto, 0);
  const comprasTotal = rows.reduce((s, r) => s + r.compras, 0);
  const proyectosEnAlerta = rows.filter((r) => r.enAlerta).length;
  const avanceProyectos = rows.filter((r) => r.project.status === "ACTIVO");
  const avancePromedio =
    avanceProyectos.length > 0
      ? Math.round(avanceProyectos.reduce((s, r) => s + r.avancePct, 0) / avanceProyectos.length)
      : 0;

  const chartData = rows
    .filter((r) => r.presupuesto > 0 || r.compras > 0)
    .map((r) => ({ name: r.project.code, presupuesto: r.presupuesto, compras: r.compras }));

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[17px] font-semibold">Proyectos</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            {list.length} proyecto{list.length !== 1 ? "s" : ""}
          </p>
        </div>
        <NewProjectDialog trigger={<Button>Nuevo proyecto</Button>} />
      </div>

      <div className={`grid gap-3 ${isCaterpillar ? "grid-cols-5" : "grid-cols-4"}`}>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Proyectos activos</div>
          <div className="text-[22px] font-bold mt-1">{proyectosActivos}</div>
          {proyectosEnAlerta > 0 ? (
            <div className="text-[11px] text-[var(--error)] mt-0.5">{proyectosEnAlerta} en alerta</div>
          ) : null}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Presupuesto total</div>
          <div className="text-[16px] font-bold mt-1">{formatMoney(presupuestoTotal, "PYG")}</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">todos los proyectos</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Compras realizadas</div>
          <div className="text-[16px] font-bold mt-1">{formatMoney(comprasTotal, "PYG")}</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">
            {presupuestoTotal > 0 ? Math.round((comprasTotal / presupuestoTotal) * 100) : 0}% del total
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Avance promedio</div>
          <div className="text-[22px] font-bold mt-1 text-[var(--ok)]">{avancePromedio}%</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">ejecución en campo</div>
        </div>
        {isCaterpillar ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Certificados pendientes</div>
            <div className={`text-[22px] font-bold mt-1 ${certificadosPendientes > 0 ? "text-[var(--warn)]" : ""}`}>
              {certificadosPendientes}
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">de aprobación</div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        {rows.length === 0 ? (
          <div className="text-center text-[var(--muted)] py-10 text-[13px]">
            Sin proyectos todavía. Creá el primero con &quot;Nuevo proyecto&quot;.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((r) => (
              <Link
                key={r.project.id}
                href={`/projects/${r.project.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--hover)] transition-colors"
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{
                    background: r.enAlerta ? "var(--error)" : r.project.status === "PAUSADO" ? "var(--warn)" : "var(--ok)",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{r.project.name}</div>
                  <div className="text-[11px] text-[var(--muted)] truncate">
                    {r.project.client ? `Cliente: ${r.project.client}` : "Sin cliente"}
                    {r.enAlerta ? " · ⚠ Compras superan presupuesto" : ""}
                  </div>
                </div>
                <div className="w-28 shrink-0">
                  <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, r.avancePct)}%`,
                        background: r.enAlerta ? "var(--error)" : "var(--ok)",
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">{r.avancePct}% ejecutado</div>
                </div>
                <Badge tone={STATUS_TONE[r.project.status]}>{STATUS_LABELS[r.project.status]}</Badge>
                <div className="w-24 text-right text-[12px] font-mono text-[var(--muted)] shrink-0">
                  {formatMoney(r.presupuesto, "PYG")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {chartData.length > 0 ? <ProjectsChart data={chartData} /> : null}
    </div>
  );
}
