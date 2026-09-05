"use client";

import { useEffect, useRef, useState } from "react";
import { Filter } from "lucide-react";

// Filtro por columna estilo Excel: ícono de embudo en el header que abre un
// checklist de los valores únicos de esa columna. null = sin filtro activo
// (todos los valores pasan); un Set = solo esos valores pasan.
export function ColumnFilter({
  values,
  selected,
  onChange,
}: {
  values: string[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = selected !== null && selected.size < values.length;
  const effectiveSelected = selected ?? new Set(values);
  const term = q.trim().toLowerCase();
  const shown = term ? values.filter((v) => v.toLowerCase().includes(term)) : values;

  function toggle(v: string) {
    const next = new Set(effectiveSelected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next.size === values.length ? null : next);
  }

  return (
    <span className="relative inline-block ml-1 normal-case font-normal" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-center h-4 w-4 rounded align-middle ${
          active ? "text-[var(--primary)]" : "text-[var(--muted)]"
        } hover:text-[var(--foreground)]`}
        title="Filtrar"
      >
        <Filter size={11} fill={active ? "currentColor" : "none"} />
      </button>
      {open ? (
        <div className="absolute z-20 top-5 left-0 w-52 rounded-md border border-[var(--border)] bg-[var(--panel)] shadow-lg p-2 text-left">
          <input
            autoFocus
            placeholder="Buscar valor…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full h-7 px-2 rounded border border-[var(--border)] bg-[var(--panel-2)] text-[12px] mb-1.5 outline-none focus:border-[var(--primary)]"
          />
          <div className="flex items-center gap-2 text-[11px] text-[var(--primary)] mb-1">
            <button type="button" onClick={() => onChange(null)} className="hover:underline">
              Todos
            </button>
            <button type="button" onClick={() => onChange(new Set())} className="hover:underline">
              Ninguno
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {shown.length === 0 ? (
              <div className="text-[11px] text-[var(--muted)] px-1 py-1">Sin coincidencias</div>
            ) : (
              shown.map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-[var(--hover)] text-[12px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={effectiveSelected.has(v)}
                    onChange={() => toggle(v)}
                    className="accent-[var(--primary)]"
                  />
                  <span className="truncate">{v || "(vacío)"}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}

// Helper: arma la lista de valores únicos (ordenada) de una columna a partir
// de las filas completas.
export function uniqueValues<T>(rows: T[], get: (r: T) => string): string[] {
  return Array.from(new Set(rows.map(get))).sort((a, b) => a.localeCompare(b, "es"));
}

// Helper: true si la fila pasa el filtro de columna (null = sin filtro).
export function passesColumnFilter(value: string, filter: Set<string> | null): boolean {
  return filter === null || filter.has(value);
}
