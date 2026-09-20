"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ColumnFilter, passesColumnFilter, uniqueValues } from "@/components/ui/column-filter";
import { formatMoney } from "@/lib/format";
import { ProjectRowActions } from "./project-row-actions";
import type { ProjectListRow } from "./portfolio-data";

const STATUS_LABELS = {
  ACTIVO: "Activo",
  PAUSADO: "Pausado",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
} as const;

const ESTADO_TONE = {
  Normal: "ok",
  Atención: "warn",
  Riesgo: "error",
} as const;

function CostCell({ row }: { row: ProjectListRow }) {
  return (
    <div className="min-w-[120px]">
      <div className="text-right font-mono text-[12px]">{formatMoney(row.compras, "PYG")}</div>
      <div className={`text-right text-[10px] ${row.comprasPct !== null && row.comprasPct > 100 ? "text-[var(--error)]" : "text-[var(--muted)]"}`}>
        {row.comprasPct === null ? "Sin compras" : `${row.comprasPct.toFixed(1)}% del presupuesto`}
      </div>
    </div>
  );
}

function ScheduleCell({ row }: { row: ProjectListRow }) {
  if (row.atrasoDias === null) return <span className="text-[var(--muted)]">En plazo</span>;
  return <span className={row.atrasoDias > 15 ? "text-[var(--error)]" : "text-[var(--warn)]"}>+{row.atrasoDias} días</span>;
}

function avanceFilterValue(row: ProjectListRow) {
  if (row.avancePct < 25) return "0–24%";
  if (row.avancePct < 50) return "25–49%";
  if (row.avancePct < 75) return "50–74%";
  return "75–100%";
}

function costoFilterValue(row: ProjectListRow) {
  if (row.comprasPct === null) return "Sin compras";
  return row.comprasPct > 100 ? "Sobre presupuesto" : "Dentro de presupuesto";
}

function plazoFilterValue(row: ProjectListRow) {
  if (row.atrasoDias === null) return "En plazo";
  return row.atrasoDias > 15 ? "Más de 15 días" : "1–15 días";
}

export function PortfolioTable({ rows, showHeader = true }: { rows: ProjectListRow[]; showHeader?: boolean }) {
  const [obraFilter, setObraFilter] = useState<Set<string> | null>(null);
  const [avanceFilter, setAvanceFilter] = useState<Set<string> | null>(null);
  const [costoFilter, setCostoFilter] = useState<Set<string> | null>(null);
  const [plazoFilter, setPlazoFilter] = useState<Set<string> | null>(null);
  const [estadoFilter, setEstadoFilter] = useState<Set<string> | null>(null);

  const obraValues = useMemo(() => uniqueValues(rows, (row) => row.project.name), [rows]);
  const avanceValues = useMemo(() => uniqueValues(rows, avanceFilterValue), [rows]);
  const costoValues = useMemo(() => uniqueValues(rows, costoFilterValue), [rows]);
  const plazoValues = useMemo(() => uniqueValues(rows, plazoFilterValue), [rows]);
  const estadoValues = useMemo(() => uniqueValues(rows, (row) => row.estado), [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => (
      passesColumnFilter(row.project.name, obraFilter) &&
      passesColumnFilter(avanceFilterValue(row), avanceFilter) &&
      passesColumnFilter(costoFilterValue(row), costoFilter) &&
      passesColumnFilter(plazoFilterValue(row), plazoFilter) &&
      passesColumnFilter(row.estado, estadoFilter)
    ));
  }, [avanceFilter, costoFilter, estadoFilter, obraFilter, plazoFilter, rows]);

  return (
    <section id="portfolio" className="space-y-3">
      {showHeader ? (
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Portfolio de obras</h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">Seleccioná una obra para entrar a su operación contextual</p>
          </div>
          <span className="text-[11px] text-[var(--muted)]">{filtered.length} de {rows.length}</span>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">Todavía no hay obras. Creá la primera con «Nueva obra».</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">Ninguna obra coincide con los filtros.</div>
        ) : (
          <table className="min-w-[780px]">
            <thead>
              <tr>
                <th>Obra <ColumnFilter values={obraValues} selected={obraFilter} onChange={setObraFilter} /></th>
                <th>Avance <ColumnFilter values={avanceValues} selected={avanceFilter} onChange={setAvanceFilter} /></th>
                <th className="num">Costo <ColumnFilter values={costoValues} selected={costoFilter} onChange={setCostoFilter} /></th>
                <th>Plazo <ColumnFilter values={plazoValues} selected={plazoFilter} onChange={setPlazoFilter} /></th>
                <th>Estado <ColumnFilter values={estadoValues} selected={estadoFilter} onChange={setEstadoFilter} /></th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.project.id}>
                  <td>
                    <Link href={`/projects/${row.project.id}`} className="text-action font-medium">{row.project.name}</Link>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      <span className="font-mono">{row.project.code}</span>{row.project.client ? ` · ${row.project.client}` : ""}
                    </div>
                  </td>
                  <td className="min-w-[150px]">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hover)]">
                        <div className={`h-full rounded-full ${row.estado === "Riesgo" ? "bg-[var(--error)]" : row.estado === "Atención" ? "bg-[var(--warn)]" : "bg-[var(--ok)]"}`} style={{ width: `${Math.min(100, row.avancePct)}%` }} />
                      </div>
                      <span className="shrink-0 text-[12px] tabular-nums">{row.avancePct}%</span>
                    </div>
                  </td>
                  <td className="num"><CostCell row={row} /></td>
                  <td><ScheduleCell row={row} /></td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      {row.estado !== "Normal" ? <AlertTriangle size={11} className="text-[var(--warn)]" /> : null}
                      <Badge tone={ESTADO_TONE[row.estado]}>{row.estado}</Badge>
                      <span className="text-[10px] text-[var(--muted)]">{STATUS_LABELS[row.project.status]}</span>
                    </span>
                  </td>
                  <td><ProjectRowActions projectId={row.project.id} projectName={row.project.name} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
