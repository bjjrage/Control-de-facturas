import Link from "next/link";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { ProjectListRow } from "./portfolio-data";
import { PortfolioOverlay } from "./portfolio-overlay";

const ESTADO_TONE = { Normal: "ok", Atención: "warn", Riesgo: "error" } as const;
const ESTADO_PRIORITY = { Riesgo: 0, Atención: 1, Normal: 2 } as const;

export function selectExecutivePortfolioRows(rows: ProjectListRow[]) {
  const activeRows = rows
    .filter((row) => row.project.status === "ACTIVO")
    .toSorted((a, b) => b.presupuesto - a.presupuesto);
  const selected = activeRows.slice(0, 5);
  const priorityOutsideCut = activeRows.slice(5).find((row) => row.enAlerta);
  const lowestNormalIndex = selected.map((row) => row.estado).lastIndexOf("Normal");

  if (priorityOutsideCut && lowestNormalIndex !== -1) selected[lowestNormalIndex] = priorityOutsideCut;

  return selected.toSorted((a, b) => {
    const stateDifference = ESTADO_PRIORITY[a.estado] - ESTADO_PRIORITY[b.estado];
    return stateDifference !== 0 ? stateDifference : b.presupuesto - a.presupuesto;
  });
}

function ScheduleLabel({ row }: { row: ProjectListRow }) {
  if (row.atrasoDias === null) return <span className="text-[var(--muted)]">En plazo</span>;
  return <span className={row.atrasoDias > 15 ? "text-[var(--error)]" : "text-[var(--warn)]"}>+{row.atrasoDias} días</span>;
}

export function PortfolioPreview({ rows }: { rows: ProjectListRow[] }) {
  const previewRows = selectExecutivePortfolioRows(rows);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Obras en curso</h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">Resumen de las obras activas prioritarias</p>
        </div>
        <PortfolioOverlay rows={rows} />
      </div>

      {previewRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-[var(--muted)]">No hay obras activas para mostrar.</div>
      ) : (
        <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/35">
          {previewRows.map((row) => (
            <Link key={row.project.id} href={`/projects/${row.project.id}`} className="group kpi-hover grid gap-3 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_112px_132px_96px] sm:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {row.estado !== "Normal" ? <AlertTriangle size={13} className={row.estado === "Riesgo" ? "shrink-0 text-[var(--error)]" : "shrink-0 text-[var(--warn)]"} /> : null}
                  <span className="truncate text-[13px] font-semibold text-[var(--foreground)]">{row.project.name}</span>
                  <ArrowUpRight size={13} className="shrink-0 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="mt-1 truncate text-[11px] text-[var(--muted)]"><span className="font-mono">{row.project.code}</span>{row.project.client ? ` · ${row.project.client}` : ""}</div>
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px]"><span className="text-[var(--muted)]">Avance</span><span className="font-semibold tabular-nums">{row.avancePct}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hover)]"><div className={`h-full rounded-full ${row.estado === "Riesgo" ? "bg-[var(--error)]" : row.estado === "Atención" ? "bg-[var(--warn)]" : "bg-[var(--ok)]"}`} style={{ width: `${Math.min(100, row.avancePct)}%` }} /></div>
              </div>
              <div className="min-w-0 sm:text-right"><div className="text-[11px] text-[var(--muted)]">Presupuesto</div><div className="truncate font-mono text-[12px] font-semibold">{formatMoney(row.presupuesto, "PYG")}</div></div>
              <div className="flex items-center justify-between gap-2 sm:block sm:text-right"><Badge tone={ESTADO_TONE[row.estado]}>{row.estado}</Badge><div className="mt-1 text-[11px]"><ScheduleLabel row={row} /></div></div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
