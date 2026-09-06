"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Project } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { ProjectRowActions } from "./project-row-actions";

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

export type ProjectRow = {
  project: Project;
  presupuesto: number;
  compras: number;
  comprasPct: number;
  avancePct: number;
  enAlerta: boolean;
};

export function ProjectsList({ rows }: { rows: ProjectRow[] }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.project.status !== statusFilter) return false;
      if (!term) return true;
      return (
        r.project.name.toLowerCase().includes(term) ||
        r.project.code.toLowerCase().includes(term) ||
        (r.project.client ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, statusFilter]);

  const hasFilters = !!(q || statusFilter);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="proj-q">Buscar</Label>
            <Input
              id="proj-q"
              type="search"
              placeholder="Nombre, código, cliente…"
              value={q}
              onChange={(e) => setQ((e.target as HTMLInputElement).value)}
              className="w-60"
            />
          </div>
          <div>
            <Label htmlFor="proj-status">Estado</Label>
            <Select
              id="proj-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
              className="w-40"
            >
              <option value="">Todos</option>
              <option value="ACTIVO">Activo</option>
              <option value="PAUSADO">Pausado</option>
              <option value="COMPLETADO">Completado</option>
              <option value="CANCELADO">Cancelado</option>
            </Select>
          </div>
          {hasFilters ? (
            <button
              onClick={() => { setQ(""); setStatusFilter(""); }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        {rows.length === 0 ? (
          <div className="text-center text-[var(--muted)] py-10 text-[13px]">
            Sin proyectos todavía. Creá el primero con &quot;Nuevo proyecto&quot;.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[var(--muted)] py-10 text-[13px]">
            Ningún proyecto coincide con los filtros.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((r) => (
              <div key={r.project.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--hover)] transition-colors">
                <Link href={`/projects/${r.project.id}`} className="flex items-center gap-3 flex-1 min-w-0">
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
                <ProjectRowActions projectId={r.project.id} projectName={r.project.name} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
