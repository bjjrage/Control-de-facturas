"use client";

import { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { ChartCard } from "./chart-card";
import { Project, BudgetItem, ExecutionEntry, AuthorizedOrder } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";

// Paleta con más contraste entre sí (evita dos tonos de azul o dos de rojo
// seguidos, que era parte de por qué la torta se veía "de los 90").
const PIE_COLORS = ["#2563eb", "#f97316", "#16a34a", "#a855f7", "#ef4444", "#06b6d4", "#eab308", "#ec4899", "#64748b", "#14b8a6"];

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

  // Agrupa por código raíz ("1.1", "1.2" → rubro "1"), igual que el Gantt
  // (project-gantt.tsx) — el importador de Excel no siempre completa
  // parent_id, así que agrupar por ese campo dejaba la torta desagregada
  // ítem por ítem en vez de por rubro.
  const pieData = useMemo(() => {
    const rootOf = (code: string) => code.split(".")[0];
    const totals = new Map<string, number>();
    for (const item of budgetItems) {
      if (item.subtotal <= 0) continue;
      const root = rootOf(item.code);
      totals.set(root, (totals.get(root) ?? 0) + item.subtotal);
    }
    const descOf = new Map(budgetItems.filter((i) => i.code === rootOf(i.code)).map((i) => [i.code, i.description]));
    const grandTotal = [...totals.values()].reduce((s, v) => s + v, 0);
    return [...totals.entries()]
      .map(([code, value]) => ({
        code,
        name: descOf.get(code) ?? `Rubro ${code}`,
        value,
        pct: grandTotal > 0 ? Math.round((value / grandTotal) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [budgetItems]);
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);

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

      <ChartCard
        title="Curva S — avance planificado vs real"
        smallHeight={240}
        largeHeight={420}
        extra={
          sCurve.summary ? (
            <p className={`text-[12px] mt-2 ${sCurve.summary.diff < 0 ? "text-[var(--error)]" : "text-[var(--ok)]"}`}>
              Al {formatDate(new Date().toISOString().slice(0, 10))}: planificado {formatMoney(sCurve.summary.planificado, "PYG")} ·
              {" "}ejecutado {formatMoney(sCurve.summary.real, "PYG")} ·{" "}
              {sCurve.summary.diff < 0 ? "atraso" : "adelanto"} de {formatMoney(Math.abs(sCurve.summary.diff), "PYG")}
              {" "}({Math.abs(sCurve.summary.pct)}%)
            </p>
          ) : null
        }
        renderChart={(height) =>
          sCurve.series.length === 0 ? (
            <div style={{ height }} className="flex flex-col items-center justify-center gap-2 text-[12px] text-[var(--muted)]">
              <span>Cargá fechas de inicio y fin en los ítems del presupuesto para ver la Curva S.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={height}>
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
          )
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <ChartCard
          title="Presupuesto vs. compras"
          smallHeight={220}
          largeHeight={420}
          renderChart={(height) => (
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={totalsBarData} barCategoryGap="40%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted)"
                  width={70}
                  tickFormatter={(v: number) => v.toLocaleString("es-PY")}
                />
                <Tooltip
                  cursor={false}
                  isAnimationActive={false}
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => formatMoney(Number(v), "PYG")}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="presupuesto" name="Presupuesto" fill="#1d4ed8" radius={[4, 4, 0, 0]} maxBarSize={80} isAnimationActive={false} />
                <Bar dataKey="compras" name="Compras" fill="#d4711a" radius={[4, 4, 0, 0]} maxBarSize={80} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        />

        <ChartCard
          title="Distribución del presupuesto por rubro"
          smallHeight={220}
          largeHeight={420}
          extra={
            pieData.length > 0 ? (
              <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                {pieData.map((d, idx) => (
                  <div key={d.code} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }}
                    />
                    <span className="truncate flex-1" title={`${d.code} — ${d.name}`}>
                      {d.code} — {d.name}
                    </span>
                    <span className="text-[var(--muted)] shrink-0">{d.pct}%</span>
                    <span className="font-mono font-medium shrink-0 w-28 text-right">
                      {formatMoney(d.value, "PYG")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null
          }
          renderChart={(height) =>
            pieData.length === 0 ? (
              <div style={{ height }} className="flex items-center justify-center text-[12px] text-[var(--muted)]">
                Sin rubros cargados.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={height}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    cornerRadius={4}
                    label={({ payload }) => `${payload.pct}%`}
                    labelLine={false}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="var(--panel)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v, _n, item) => [formatMoney(Number(v), "PYG"), item.payload.code + " — " + item.payload.name]}
                  />
                  <text
                    x="50%"
                    y="47%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-[var(--foreground)]"
                    style={{ fontSize: 11, fontWeight: 600 }}
                  >
                    Total
                  </text>
                  <text
                    x="50%"
                    y="57%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-[var(--muted)]"
                    style={{ fontSize: 10 }}
                  >
                    {formatMoney(pieTotal, "PYG")}
                  </text>
                </PieChart>
              </ResponsiveContainer>
            )
          }
        />
      </div>
    </div>
  );
}
