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

  const presupuestoTotal = budgetItems.reduce((s, i) => s + i.subtotal, 0);
  const comprasTotal = orders.filter((o) => o.currency === "PYG").reduce((s, o) => s + o.total_price, 0);

  const totalsBarData = useMemo(
    () => [{ name: project.code, presupuesto: presupuestoTotal, compras: comprasTotal }],
    [project.code, presupuestoTotal, comprasTotal]
  );

  // Curva S: avance ponderado por costo, acumulado en el tiempo. Sumar
  // quantity_executed crudo entre ítems mezclaría unidades distintas (m2, m3,
  // u) — no es una medida válida. Se pondera cada entrada por el peso en
  // costo del ítem dentro del presupuesto total.
  const sCurveData = useMemo(() => {
    if (presupuestoTotal <= 0) return [];
    const itemById = new Map(budgetItems.map((i) => [i.id, i]));
    const contribByDate = new Map<string, number>();
    for (const e of execEntries) {
      const item = itemById.get(e.budget_item_id);
      if (!item || !item.quantity || item.quantity <= 0) continue;
      const fractionOfItem = Math.min(1, e.quantity_executed / item.quantity);
      const contribution = (fractionOfItem * item.subtotal) / presupuestoTotal;
      contribByDate.set(e.entry_date, (contribByDate.get(e.entry_date) ?? 0) + contribution);
    }
    const dates = [...contribByDate.keys()].sort();
    let acc = 0;
    return dates.map((d) => {
      acc += contribByDate.get(d)!;
      return { date: formatDate(d), avance: Math.round(Math.min(1, acc) * 1000) / 10 };
    });
  }, [budgetItems, execEntries, presupuestoTotal]);

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

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[13px] font-semibold mb-3">Presupuesto vs. compras</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={totalsBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" width={70} />
              <Tooltip
                contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => Number(v).toLocaleString("es-PY")}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="presupuesto" name="Presupuesto" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="compras" name="Compras" fill="#d4711a" radius={[4, 4, 0, 0]} />
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

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 col-span-2">
          <div className="text-[13px] font-semibold mb-1">Avance acumulado (curva S)</div>
          <div className="text-[11px] text-[var(--muted)] mb-3">
            Ponderado por costo — no suma cantidades crudas entre ítems de distinta unidad.
          </div>
          {sCurveData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-[12px] text-[var(--muted)]">
              Sin avance registrado todavía.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={sCurveData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" width={40} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => `${v}%`}
                />
                <Line type="monotone" dataKey="avance" name="Avance" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
