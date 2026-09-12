"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";
import {
  CompetitorListEntry,
  RadarCertaintyFilter,
  RadarEvidenceFilter,
  RadarOutcomeFilter,
  RadarPeriodMonths,
} from "@/lib/procurement/competitor-intelligence";
import {
  Building2,
  CheckSquare,
  Eye,
  EyeOff,
  Filter,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { excluirCompetidoresRadar, restaurarCompetidoresRadar } from "./actions";

interface CompetidoresRadarClientProps {
  competitors: CompetitorListEntry[];
  totalFiltered: number;
  totalHistorical: number;
  page: number;
  limit: number;
  totalPages: number;
  currentFilters: {
    q: string;
    period: RadarPeriodMonths;
    evidence: RadarEvidenceFilter;
    minBids: number;
    certainty: RadarCertaintyFilter;
    outcome: RadarOutcomeFilter;
    showExcluded: boolean;
  };
}

export function CompetidoresRadarClient({
  competitors,
  totalFiltered,
  totalHistorical,
  page,
  limit,
  totalPages,
  currentFilters,
}: CompetidoresRadarClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Selección múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    mode: "single" | "bulk";
    action: "exclude" | "restore";
    targetIds: string[];
    targetNames: string[];
  }>({
    open: false,
    mode: "bulk",
    action: "exclude",
    targetIds: [],
    targetNames: [],
  });

  // Estado local para búsqueda y filtros rápidos
  const [searchInput, setSearchInput] = useState(currentFilters.q);

  function updateQuery(newParams: Record<string, string | number | boolean | undefined>) {
    const params = new URLSearchParams();

    const merged = {
      q: currentFilters.q || undefined,
      period: currentFilters.period !== 24 ? currentFilters.period : undefined,
      evidence: currentFilters.evidence !== "CON_EVIDENCIA" ? currentFilters.evidence : undefined,
      minBids: currentFilters.minBids !== 1 ? currentFilters.minBids : undefined,
      certainty: currentFilters.certainty !== "TODAS" ? currentFilters.certainty : undefined,
      outcome: currentFilters.outcome !== "TODOS" ? currentFilters.outcome : undefined,
      showExcluded: currentFilters.showExcluded ? "true" : undefined,
      page: page > 1 ? page : undefined,
      ...newParams,
    };

    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "" && v !== null) {
        params.set(k, String(v));
      }
    }

    startTransition(() => {
      router.push(`/licitaciones/competidores?${params.toString()}`);
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateQuery({ q: searchInput.trim() || undefined, page: undefined });
  }

  function handleClearFilters() {
    setSearchInput("");
    startTransition(() => {
      router.push("/licitaciones/competidores");
    });
  }

  // Checkbox select all visible
  const allVisibleSelected =
    competitors.length > 0 && competitors.every((c) => selectedIds.has(c.supplier_id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set<string>();
      competitors.forEach((c) => next.add(c.supplier_id));
      setSelectedIds(next);
    }
  }

  function toggleSelectRow(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  }

  // Ejecutar exclusión
  async function executeExclusion(supplierIds: string[]) {
    startTransition(async () => {
      const res = await excluirCompetidoresRadar(supplierIds);
      if (res.success) {
        setSelectedIds(new Set());
        setConfirmModal((prev) => ({ ...prev, open: false }));
        router.refresh();
      } else {
        alert(res.error || "No se pudo excluir al competidor");
      }
    });
  }

  // Ejecutar restauración
  async function executeRestoration(supplierIds: string[]) {
    startTransition(async () => {
      const res = await restaurarCompetidoresRadar(supplierIds);
      if (res.success) {
        setSelectedIds(new Set());
        setConfirmModal((prev) => ({ ...prev, open: false }));
        router.refresh();
      } else {
        alert(res.error || "No se pudo restaurar al competidor");
      }
    });
  }

  const hasActiveFilters =
    Boolean(currentFilters.q) ||
    currentFilters.period !== 24 ||
    currentFilters.evidence !== "CON_EVIDENCIA" ||
    currentFilters.minBids !== 1 ||
    currentFilters.certainty !== "TODAS" ||
    currentFilters.outcome !== "TODOS" ||
    currentFilters.showExcluded;

  return (
    <div className="space-y-4">
      {/* 1. Buscador + Toggle Excluidos */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--muted)]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por empresa o RUC..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] py-2 pl-9 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] shadow-xs focus:border-[var(--nav-active)] focus:outline-none focus:ring-1 focus:ring-[var(--nav-active)]"
          />
        </form>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={currentFilters.showExcluded}
              onChange={(e) => updateQuery({ showExcluded: e.target.checked ? "true" : undefined, page: undefined })}
              className="h-4 w-4 rounded border-[var(--border)] bg-[var(--panel-2)] text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            <span>Mostrar excluidos</span>
          </label>

          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* 2. Barra de Filtros Compacta */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--foreground)] pr-1">
          <Filter className="h-3.5 w-3.5 text-[var(--muted)]" />
          <span>Filtros:</span>
        </div>

        {/* Período */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--muted)]">Período:</span>
          <select
            value={currentFilters.period}
            onChange={(e) => updateQuery({ period: Number(e.target.value) as RadarPeriodMonths, page: undefined })}
            className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--foreground)] shadow-2xs focus:border-[var(--nav-active)] focus:outline-none"
          >
            <option value={12}>12 meses</option>
            <option value={24}>24 meses (Default)</option>
            <option value={36}>36 meses</option>
            <option value={60}>5 años</option>
            <option value={0}>Todo el histórico</option>
          </select>
        </div>

        {/* Actividad / Evidencia */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--muted)]">Actividad:</span>
          <select
            value={currentFilters.evidence}
            onChange={(e) => updateQuery({ evidence: e.target.value as RadarEvidenceFilter, page: undefined })}
            className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--foreground)] shadow-2xs focus:border-[var(--nav-active)] focus:outline-none"
          >
            <option value="CON_EVIDENCIA">Con evidencia (Default)</option>
            <option value="ACTIVOS">Activos</option>
            <option value="TODOS">Todos los proveedores</option>
          </select>
        </div>

        {/* Ofertas Mínimas */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--muted)]">Ofertas mín.:</span>
          <select
            value={currentFilters.minBids}
            onChange={(e) => updateQuery({ minBids: Number(e.target.value), page: undefined })}
            className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--foreground)] shadow-2xs focus:border-[var(--nav-active)] focus:outline-none"
          >
            <option value={1}>&gt;= 1 (Default)</option>
            <option value={3}>&gt;= 3</option>
            <option value={5}>&gt;= 5</option>
            <option value={10}>&gt;= 10</option>
          </select>
        </div>

        {/* Certeza */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--muted)]">Certeza:</span>
          <select
            value={currentFilters.certainty}
            onChange={(e) => updateQuery({ certainty: e.target.value as RadarCertaintyFilter, page: undefined })}
            className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--foreground)] shadow-2xs focus:border-[var(--nav-active)] focus:outline-none"
          >
            <option value="TODAS">Todas</option>
            <option value="ALTA">ALTA (&gt;=15 obs)</option>
            <option value="MEDIA">MEDIA (5-14 obs)</option>
            <option value="BAJA">BAJA (2-4 obs)</option>
            <option value="INSUFICIENTE">INSUFICIENTE (&lt;2)</option>
          </select>
        </div>

        {/* Resultado */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--muted)]">Resultado:</span>
          <select
            value={currentFilters.outcome}
            onChange={(e) => updateQuery({ outcome: e.target.value as RadarOutcomeFilter, page: undefined })}
            className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--foreground)] shadow-2xs focus:border-[var(--nav-active)] focus:outline-none"
          >
            <option value="TODOS">Todos</option>
            <option value="CON_ADJUDICACIONES">Con adjudicaciones</option>
            <option value="SIN_ADJUDICACIONES">Sin adjudicaciones</option>
          </select>
        </div>
      </div>

      {/* 3. Barra de Acciones Masivas y Contador de Resultados */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-1">
        <div className="text-xs text-[var(--muted)]">
          <span className="font-semibold text-[var(--foreground)]">{totalFiltered.toLocaleString("es-PY")}</span> competidores encontrados{" "}
          <span className="text-[var(--muted)]/70">de {totalHistorical.toLocaleString("es-PY")} proveedores históricos</span>
        </div>

        {/* Botón de acción masiva */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-blue-950/60 border border-blue-800/60 px-2 py-1 text-xs font-semibold text-blue-400">
              {selectedIds.size} seleccionado{selectedIds.size !== 1 ? "s" : ""}
            </span>

            <button
              onClick={() => {
                const ids = Array.from(selectedIds);
                const names = competitors.filter((c) => selectedIds.has(c.supplier_id)).map((c) => c.nombre);
                setConfirmModal({
                  open: true,
                  mode: "bulk",
                  action: "exclude",
                  targetIds: ids,
                  targetNames: names,
                });
              }}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/50 shadow-2xs transition-colors"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Excluir del Radar
            </button>

            {currentFilters.showExcluded && (
              <button
                onClick={() => {
                  const ids = Array.from(selectedIds);
                  const names = competitors.filter((c) => selectedIds.has(c.supplier_id)).map((c) => c.nombre);
                  setConfirmModal({
                    open: true,
                    mode: "bulk",
                    action: "restore",
                    targetIds: ids,
                    targetNames: names,
                  });
                }}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-900/50 shadow-2xs transition-colors"
              >
                <Eye className="h-3.5 w-3.5" />
                Restaurar al Radar
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. Tabla de Competidores */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--panel-2)] text-xs font-semibold uppercase text-[var(--muted)]">
              <tr>
                <th className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Seleccionar todos los competidores visibles"
                    className="h-4 w-4 rounded border-[var(--border)] bg-[var(--panel-2)] text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                  />
                </th>
                <th className="px-4 py-3">Empresa / RUC</th>
                <th className="px-4 py-3">Escala</th>
                <th className="px-4 py-3 text-center">Ofertas</th>
                <th className="px-4 py-3 text-center">Ganadas</th>
                <th className="px-4 py-3 text-center">Win Rate</th>
                <th className="px-4 py-3 text-right">Monto Adjudicado</th>
                <th className="px-4 py-3 text-center">Certeza</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {competitors.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-[var(--muted)]">
                    <Building2 className="mx-auto h-8 w-8 text-[var(--muted)]/50 mb-2" />
                    No se encontraron competidores con el criterio seleccionado.
                  </td>
                </tr>
              ) : (
                competitors.map((c) => {
                  const rucParam = c.ruc_clean || c.nombre;
                  const isSelected = selectedIds.has(c.supplier_id);
                  const isExcluded = Boolean(c.is_excluded);

                  const certaintyBadge = {
                    ALTA: "bg-emerald-950/60 text-emerald-400 border-emerald-800/60",
                    MEDIA: "bg-blue-950/60 text-blue-400 border-blue-800/60",
                    BAJA: "bg-amber-950/60 text-amber-400 border-amber-800/60",
                    INSUFICIENTE: "bg-zinc-900/80 text-zinc-400 border-zinc-800",
                  }[c.certainty_tier];

                  return (
                    <tr
                      key={c.supplier_id}
                      className={`hover:bg-[var(--hover)] transition-colors ${isExcluded ? "bg-[var(--panel-2)]/40 opacity-60" : ""} ${isSelected ? "bg-blue-950/20" : ""}`}
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(c.supplier_id)}
                          aria-label={`Seleccionar ${c.nombre}`}
                          className="h-4 w-4 rounded border-[var(--border)] bg-[var(--panel-2)] text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/licitaciones/competidores/${encodeURIComponent(rucParam)}`}
                            className="font-semibold text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {c.nombre}
                          </Link>
                          {isExcluded && (
                            <span className="inline-flex items-center gap-1 rounded bg-[var(--panel-2)] border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                              <EyeOff className="h-3 w-3" /> Excluido
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-[var(--muted)]">
                          {c.ruc_clean ? `RUC: ${c.ruc_clean}${c.dv ? `-${c.dv}` : ""}` : "Sin RUC registrado"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {c.tamano || "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-[var(--foreground)]">
                        {c.total_bids}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-[var(--foreground)]">
                        {c.total_wins}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex rounded-full bg-[var(--panel-2)] border border-[var(--border)] px-2.5 py-0.5 text-xs font-semibold text-[var(--foreground)]">
                          {c.win_rate_pct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-[var(--foreground)]">
                        {c.total_awarded_amount > 0 ? formatMoney(c.total_awarded_amount, "PYG") : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${certaintyBadge}`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          {c.certainty_tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/licitaciones/competidores/${encodeURIComponent(rucParam)}`}
                            className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--hover)] transition-colors"
                            title="Ver perfil analítico 360°"
                          >
                            Ver 360°
                          </Link>

                          {isExcluded ? (
                            <button
                              onClick={() => {
                                setConfirmModal({
                                  open: true,
                                  mode: "single",
                                  action: "restore",
                                  targetIds: [c.supplier_id],
                                  targetNames: [c.nombre],
                                });
                              }}
                              disabled={isPending}
                              className="rounded-md border border-emerald-900/60 bg-emerald-950/40 px-2 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-900/50 transition-colors"
                              title="Restaurar al Radar"
                            >
                              Restaurar
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setConfirmModal({
                                  open: true,
                                  mode: "single",
                                  action: "exclude",
                                  targetIds: [c.supplier_id],
                                  targetNames: [c.nombre],
                                });
                              }}
                              disabled={isPending}
                              className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-xs font-medium text-[var(--muted)] hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400 transition-colors"
                              title="Excluir del Radar"
                            >
                              Excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
            <div>
              Página {page} de {totalPages}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => updateQuery({ page: page - 1 })}
                disabled={page <= 1 || isPending}
                className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--foreground)] px-2.5 py-1 text-xs font-medium disabled:opacity-30 hover:bg-[var(--hover)] transition-colors"
              >
                Anterior
              </button>
              <button
                onClick={() => updateQuery({ page: page + 1 })}
                disabled={page >= totalPages || isPending}
                className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--foreground)] px-2.5 py-1 text-xs font-medium disabled:opacity-30 hover:bg-[var(--hover)] transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Confirmación de Exclusión / Restauración */}
      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {confirmModal.action === "exclude" ? (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-950/60 border border-red-900/60 text-red-400">
                    <EyeOff className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-950/60 border border-emerald-900/60 text-emerald-400">
                    <Eye className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <h3 className="text-base font-semibold text-[var(--foreground)]">
                    {confirmModal.action === "exclude"
                      ? "Excluir del Radar"
                      : "Restaurar al Radar"}
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    {confirmModal.targetIds.length} competidor
                    {confirmModal.targetIds.length !== 1 ? "es" : ""} seleccionado
                    {confirmModal.targetIds.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
                className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs text-[var(--foreground)] space-y-2">
              {confirmModal.action === "exclude" ? (
                <p>
                  Estos competidores dejarán de aparecer en tu Radar.{" "}
                  <strong className="text-[var(--foreground)] font-semibold">
                    La evidencia histórica DNCP no se eliminará
                  </strong>
                  .
                </p>
              ) : (
                <p>
                  Estos competidores volverán a mostrarse en los listados y comparativas del Radar de tu empresa.
                </p>
              )}

              {confirmModal.targetNames.length > 0 && (
                <ul className="max-h-24 overflow-y-auto list-disc pl-4 text-[11px] text-[var(--muted)] space-y-0.5">
                  {confirmModal.targetNames.map((n, i) => (
                    <li key={i} className="truncate">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
                disabled={isPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--hover)] transition-colors"
              >
                Cancelar
              </button>
              {confirmModal.action === "exclude" ? (
                <button
                  type="button"
                  onClick={() => executeExclusion(confirmModal.targetIds)}
                  disabled={isPending}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 shadow-xs transition-colors"
                >
                  {isPending ? "Excluyendo..." : "Excluir del Radar"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => executeRestoration(confirmModal.targetIds)}
                  disabled={isPending}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 shadow-xs transition-colors"
                >
                  {isPending ? "Restaurando..." : "Restaurar al Radar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
