"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
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

export function PortfolioTable({ rows }: { rows: ProjectListRow[] }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && row.project.status !== statusFilter) return false;
      if (!term) return true;
      return (
        row.project.name.toLowerCase().includes(term) ||
        row.project.code.toLowerCase().includes(term) ||
        (row.project.client ?? "").toLowerCase().includes(term)
      );
    });
  }, [q, rows, statusFilter]);

  const hasFilters = Boolean(q || statusFilter);

  return (
    <section id="portfolio" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Portfolio de obras</h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">Seleccioná una obra para entrar a su operación contextual</p>
        </div>
        <span className="text-[11px] text-[var(--muted)]">{filtered.length} de {rows.length}</span>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="proj-q">Buscar</Label>
            <Input id="proj-q" type="search" placeholder="Nombre, código, cliente…" value={q} onChange={(event) => setQ(event.target.value)} className="w-60" />
          </div>
          <div>
            <Label htmlFor="proj-status">Estado</Label>
            <Select id="proj-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-40">
              <option value="">Todos</option>
              <option value="ACTIVO">Activo</option>
              <option value="PAUSADO">Pausado</option>
              <option value="COMPLETADO">Completado</option>
              <option value="CANCELADO">Cancelado</option>
            </Select>
          </div>
          {hasFilters ? <button onClick={() => { setQ(""); setStatusFilter(""); }} className="pb-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">Limpiar</button> : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">Todavía no hay obras. Creá la primera con «Nueva obra».</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[var(--muted)]">Ninguna obra coincide con los filtros.</div>
        ) : (
          <table className="min-w-[780px]">
            <thead>
              <tr>
                <th>Obra</th>
                <th>Avance</th>
                <th className="num">Costo</th>
                <th>Plazo</th>
                <th>Estado</th>
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
