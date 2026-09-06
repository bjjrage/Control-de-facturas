"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { formatDate } from "@/lib/format";
import { ExecutionPhotosLightbox } from "./execution-photos-lightbox";

type Row = {
  id: string;
  date: string;
  itemLabel: string;
  unit: string;
  quantityExecuted: number;
  notes: string | null;
  photoUrls: string[];
  fromPortal: boolean;
};

type Preset = "all" | "today" | "7d" | "30d";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "today", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

function withinPreset(dateStr: string, preset: Preset): boolean {
  if (preset === "all") return true;
  const d = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  const cutoff = new Date(today.getTime() - days * 86400000);
  return d >= cutoff && d <= today;
}

const dateLabel = (r: Row) => formatDate(r.date);
const qtyLabel = (r: Row) => `${r.quantityExecuted} ${r.unit}`;
const notesLabel = (r: Row) => r.notes ?? "—";

type ColKey = "date" | "itemLabel" | "quantityExecuted" | "notes";

export function EjecucionTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    date: null,
    itemLabel: null,
    quantityExecuted: null,
    notes: null,
  });

  const uniques = useMemo(
    () => ({
      date: uniqueValues(rows, dateLabel),
      itemLabel: uniqueValues(rows, (r) => r.itemLabel),
      quantityExecuted: uniqueValues(rows, qtyLabel),
      notes: uniqueValues(rows, notesLabel),
    }),
    [rows]
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!withinPreset(r.date, preset)) return false;
      if (!passesColumnFilter(dateLabel(r), colFilters.date)) return false;
      if (!passesColumnFilter(r.itemLabel, colFilters.itemLabel)) return false;
      if (!passesColumnFilter(qtyLabel(r), colFilters.quantityExecuted)) return false;
      if (!passesColumnFilter(notesLabel(r), colFilters.notes)) return false;
      if (!term) return true;
      return r.itemLabel.toLowerCase().includes(term) || (r.notes ?? "").toLowerCase().includes(term);
    });
  }, [rows, q, preset, colFilters]);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por ítem o notas…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={`h-8 px-2.5 rounded-md text-[12px] font-medium border transition-colors ${
                  preset === p.value
                    ? "bg-[var(--primary)] text-white border-transparent"
                    : "bg-[var(--panel-2)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--foreground)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>
                Fecha
                <ColumnFilter values={uniques.date} selected={colFilters.date} onChange={(v) => setCol("date", v)} />
              </th>
              <th>
                Ítem
                <ColumnFilter
                  values={uniques.itemLabel}
                  selected={colFilters.itemLabel}
                  onChange={(v) => setCol("itemLabel", v)}
                />
              </th>
              <th className="num">
                Cant. ejecutada
                <ColumnFilter
                  values={uniques.quantityExecuted}
                  selected={colFilters.quantityExecuted}
                  onChange={(v) => setCol("quantityExecuted", v)}
                />
              </th>
              <th>
                Notas
                <ColumnFilter values={uniques.notes} selected={colFilters.notes} onChange={(v) => setCol("notes", v)} />
              </th>
              <th>Fotos</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin avance registrado." : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    {formatDate(r.date)}
                    {r.fromPortal ? (
                      <span
                        title="Cargado por el capataz desde el link, sin login"
                        className="ml-1.5 text-[10px] text-[var(--muted)]"
                      >
                        📱
                      </span>
                    ) : null}
                  </td>
                  <td>{r.itemLabel}</td>
                  <td className="num">{r.quantityExecuted} {r.unit}</td>
                  <td className="text-[var(--muted)]">{r.notes ?? "—"}</td>
                  <td><ExecutionPhotosLightbox urls={r.photoUrls} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
