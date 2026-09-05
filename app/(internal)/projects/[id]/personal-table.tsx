"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { DailyLaborEntry } from "@/lib/types";

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

export function PersonalTable({ rows }: { rows: DailyLaborEntry[] }) {
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<Preset>("all");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!withinPreset(r.entry_date, preset)) return false;
      if (!term) return true;
      return r.worker_name.toLowerCase().includes(term) || (r.task_description ?? "").toLowerCase().includes(term);
    });
  }, [rows, q, preset]);

  const hoursTotal = filtered.reduce((s, l) => s + l.hours, 0);
  const costTotal = filtered.reduce((s, l) => s + l.labor_cost, 0);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por trabajador o tarea…"
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
              <th>Fecha</th>
              <th>Trabajador</th>
              <th className="num">Horas</th>
              <th className="num">Costo/hora</th>
              <th className="num">Total</th>
              <th>Tarea</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin partes diarios registrados." : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.entry_date)}</td>
                  <td className="font-medium">{l.worker_name}</td>
                  <td className="num">{l.hours}</td>
                  <td className="num">{formatMoney(l.hourly_cost, "PYG")}</td>
                  <td className="num font-medium">{formatMoney(l.labor_cost, "PYG")}</td>
                  <td className="text-[var(--muted)]">{l.task_description ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={2} className="text-right font-semibold">TOTAL</td>
                <td className="num font-semibold">{hoursTotal}</td>
                <td></td>
                <td className="num font-semibold">{formatMoney(costTotal, "PYG")}</td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
