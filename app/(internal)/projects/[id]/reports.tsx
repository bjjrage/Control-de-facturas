"use client";

import { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Project, BudgetItem, ExecutionEntry, AuthorizedOrder } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";

const PIE_COLORS = ["#1d4ed8", "#d4711a", "#16a34a", "#7c3aed", "#dc2626", "#0891b2", "#ca8a04", "#db2777"];

export function ProjectReports({
  project,
  budgetItems,
  execEntries,
  orders,
}: {
  project: Project;
  budgetItems: BudgetItem[];
  execEntries: ExecutionEntry[];
  orders: AuthorizedOrder[];
}) {
  const [exportingPdf, setExportingPdf] = useState(false);

  // "El mayor" entre el presupuesto estimado al crear el proyecto y la suma
  // real de ítems cargados — mismo criterio que el dashboard general, para
  // no mostrar 0 cuando todavía no se cargó el cómputo métrico pero sí hay
  // una estimación inicial.
  const itemsSubtotal = budgetItems.reduce((s, i) => s + i.subtotal, 0);
  const presupuestoTotal = Math.max(project.budget_total, itemsSubtotal);
  const comprasTotal = orders.filter((o) => o.currency === "PYG").reduce((s, o) => s + o.total_price, 0);

  const totalsBarData = useMemo(
    () => [{ name: project.code, presupuesto: presupuestoTotal, compras: comprasTotal }],
    [project.code, presupuestoTotal, comprasTotal]
  );

  // Curva S real: planificado (derivado de las fechas del Gantt, repartido
  // linealmente entre start_date y end_date de cada ítem) vs real (costo de
  // lo efectivamente ejecutado, quantity_executed * unit_price). La distancia
  // vertical entre las dos curvas es el atraso o adelanto de obra — esa
  // comparación es lo que hace que sea una Curva S de verdad, no solo un
  // acumulado de avance.
  const DAY_MS = 86400000;
  const sCurve = useMemo(() => {
    const withDates = budgetItems.filter((i) => i.start_date && i.end_date);
    if (withDates.length === 0) return { series: [] as { date: string; planificado: number; real: number | null }[], summary: null };

    const parseDate = (s: string) => new Date(`${s}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minStart = withDates.reduce<Date>((min, i) => {
      const d = parseDate(i.start_date!);
      return d < min ? d : min;
    }, parseDate(withDates[0].start_date!));
    const maxEndRaw = withDates.reduce<Date>((max, i) => {
      const d = parseDate(i.end_date!);
      return d > max ? d : max;
    }, parseDate(withDates[0].end_date!));
    const axisEnd = maxEndRaw > today ? maxEndRaw : today;

    const axisDates: Date[] = [];
    for (let t = minStart.getTime(); t <= axisEnd.getTime(); t += 7 * DAY_MS) {
      axisDates.push(new Date(t));
    }
    if (axisDates.length === 0 || axisDates[axisDates.length - 1].getTime() !== axisEnd.getTime()) {
      axisDates.push(axisEnd);
    }

    function planificadoAt(d: Date): number {
      let total = 0;
      for (const item of withDates) {
        const s = parseDate(item.start_date!);
        const e = parseDate(item.end_date!);
        const diasTotales = Math.max(1, Math.round((e.getTime() - s.getTime()) / DAY_MS));
        const diasCorridos = Math.min(diasTotales, Math.max(0, Math.round((d.getTime() - s.getTime()) / DAY_MS)));
        total += item.subtotal * (diasCorridos / diasTotales);
      }
      return total;
    }

    const itemById = new Map(budgetItems.map((i) => [i.id, i]));
    const realEvents = execEntries
      .map((e) => {
        const item = itemById.get(e.budget_item_id);
        if (!item || item.unit_price == null) return null;
        return { date: parseDate(e.entry_date), cost: e.quantity_executed * item.unit_price };
      })
      .filter((x): x is { date: Date; cost: number } => x !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    function realAt(d: Date): number {
      let total = 0;
      for (const ev of realEvents) {
        if (ev.date > d) break;
        total += ev.cost;
      }
      return total;
    }

    // La línea Real se corta en hoy — no se proyecta hacia adelante.
    const series = axisDates.map((d) => ({
      date: formatDate(d.toISOString().slice(0, 10)),
      planificado: Math.round(planificadoAt(d)),
      real: d <= today ? Math.round(realAt(d)) : null,
    }));

    const lastReal = [...series].reverse().find((p) => p.real !== null);
    const summary = lastReal
      ? {
          planificado: lastReal.planificado,
          real: lastReal.real as number,
          diff: (lastReal.real as number) - lastReal.planificado,
          pct: lastReal.planificado > 0 ? Math.round((((lastReal.real as number) - lastReal.planificado) / lastReal.planificado) * 1000) / 10 : 0,
        }
      : null;

    return { series, summary };
  }, [budgetItems, execEntries]);

  const pieData = useMemo(
    () =>
      budgetItems
        .filter((i) => !i.parent_id && i.subtotal > 0)
        .map((i) => ({ name: `${i.code}`, value: i.subtotal })),
    [budgetItems]
  );

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const presupuestoSheet = XLSX.utils.json_to_sheet(
      budgetItems.map((i) => ({
        Código: i.code,
        Descripción: i.description,
        Unidad: i.unit ?? "",
        Cantidad: i.quantity ?? "",
        "Precio unitario": i.unit_price ?? "",
        Subtotal: i.subtotal,
      }))
    );
    XLSX.utils.book_append_sheet(wb, presupuestoSheet, "Presupuesto");

    const ejecucionSheet = XLSX.utils.json_to_sheet(
      execEntries.map((e) => {
        const item = budgetItems.find((i) => i.id === e.budget_item_id);
        return {
          Fecha: e.entry_date,
          Ítem: item ? `${item.code} — ${item.description}` : "",
          "Cantidad ejecutada": e.quantity_executed,
          Unidad: item?.unit ?? "",
          Notas: e.notes ?? "",
        };
      })
    );
    XLSX.utils.book_append_sheet(wb, ejecucionSheet, "Ejecución");

    const comprasSheet = XLSX.utils.json_to_sheet(
      orders.map((o) => ({
        "Código OC": o.code,
        Producto: o.product,
        Proveedor: o.provider_name,
        Total: o.total_price,
        Moneda: o.currency,
        Autorizada: o.authorized_at,
      }))
    );
    XLSX.utils.book_append_sheet(wb, comprasSheet, "Compras");

    XLSX.writeFile(wb, `${project.code}-informe.xlsx`);
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/report`);
      if (!res.ok) throw new Error("No se pudo generar el PDF.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.code}-informe.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo generar el PDF. Probá de nuevo.");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={exportExcel}>Exportar Excel</Button>
        <Button variant="secondary" onClick={exportPdf} disabled={exportingPdf}>
          {exportingPdf ? "Generando…" : "Exportar PDF"}
        </Button>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="text-[13px] font-semibold mb-3">Curva S — avance planificado vs real</div>
        {sCurve.series.length === 0 ? (
          <div className="h-[240px] flex flex-col items-center justify-center gap-2 text-[12px] text-[var(--muted)]">
            <span>Cargá fechas de inicio y fin en los ítems del presupuesto para ver la Curva S.</span>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={sCurve.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted)"
                  width={60}
                  tickFormatter={(v: number) => `Gs ${(v / 1_000_000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => [v == null ? "—" : formatMoney(Number(v), "PYG"), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="planificado" name="Planificado" stroke="#8a8278" strokeDasharray="5 4" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="real" name="Real" stroke="#1d4ed8" strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            {sCurve.summary ? (
              <p className={`text-[12px] mt-2 ${sCurve.summary.diff < 0 ? "text-[var(--error)]" : "text-[var(--ok)]"}`}>
                Al {formatDate(new Date().toISOString().slice(0, 10))}: planificado {formatMoney(sCurve.summary.planificado, "PYG")} ·
                {" "}ejecutado {formatMoney(sCurve.summary.real, "PYG")} ·{" "}
                {sCurve.summary.diff < 0 ? "atraso" : "adelanto"} de {formatMoney(Math.abs(sCurve.summary.diff), "PYG")}
                {" "}({Math.abs(sCurve.summary.pct)}%)
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[13px] font-semibold mb-3">Presupuesto vs. compras</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={totalsBarData} barCategoryGap="40%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" width={70} />
              <Tooltip
                cursor={false}
                isAnimationActive={false}
                contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => Number(v).toLocaleString("es-PY")}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="presupuesto" name="Presupuesto" fill="#1d4ed8" radius={[4, 4, 0, 0]} maxBarSize={80} isAnimationActive={false} />
              <Bar dataKey="compras" name="Compras" fill="#d4711a" radius={[4, 4, 0, 0]} maxBarSize={80} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[13px] font-semibold mb-3">Distribución del presupuesto por rubro</div>
          {pieData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-[12px] text-[var(--muted)]">
              Sin rubros cargados.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={{ fontSize: 11 }}>
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => formatMoney(Number(v), "PYG")}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  );
}
