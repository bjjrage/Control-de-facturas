"use client";

import { Pie, PieChart, Cell } from "recharts";
import { Boxes, FileCheck2, ShoppingCart } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { PortfolioPanorama } from "@/lib/dashboard/portfolio";

const ESTADO_COLORS = {
  normal: "#2dd4bf",
  atencion: "#f5a524",
  riesgo: "#f2685c",
} as const;

export function PanoramaObras({ data }: { data: PortfolioPanorama }) {
  const { comprasRealizadasPyg, ordenesCompra, productosStockMinimo, certificadosPendientes, estadoBreakdown } = data;
  const donutData = [
    { key: "normal", value: estadoBreakdown.normal, color: ESTADO_COLORS.normal },
    { key: "atencion", value: estadoBreakdown.atencion, color: ESTADO_COLORS.atencion },
    { key: "riesgo", value: estadoBreakdown.riesgo, color: ESTADO_COLORS.riesgo },
  ].filter((item) => item.value > 0);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-4 flex items-center gap-4">
        <div className="relative h-[92px] w-[92px] shrink-0">
          {donutData.length > 0 ? (
            <PieChart width={92} height={92} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie data={donutData} dataKey="value" nameKey="key" cx={46} cy={46} innerRadius={30} outerRadius={44} paddingAngle={donutData.length > 1 ? 3 : 0} stroke="none" isAnimationActive={false}>
                {donutData.map((item) => <Cell key={item.key} fill={item.color} />)}
              </Pie>
            </PieChart>
          ) : <div className="h-full w-full rounded-full border-4 border-[var(--hover)]" />}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--muted)]">Salud</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Estado de cartera</div>
          <div className="text-[15px] font-semibold leading-tight">Salud operativa</div>
          <div className="text-[11px] text-[var(--muted)]">Distribución de las obras activas</div>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--panel-2)] p-2.5">
          <ShoppingCart size={14} className="shrink-0 text-[var(--primary)]" />
          <div><div className="truncate text-[14px] font-semibold leading-none">{formatMoney(comprasRealizadasPyg, "PYG")}</div><div className="mt-0.5 text-[10px] text-[var(--muted)]">Compras realizadas · {ordenesCompra} OC</div></div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-[var(--panel-2)] p-2.5">
          <Boxes size={14} className="shrink-0 text-[var(--warn)]" />
          <div><div className="text-[14px] font-semibold leading-none">{productosStockMinimo}</div><div className="mt-0.5 text-[10px] text-[var(--muted)]">Bajo stock mínimo</div></div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-[var(--panel-2)] p-2.5">
          <FileCheck2 size={14} className="shrink-0 text-[var(--warn)]" />
          <div><div className="text-[14px] font-semibold leading-none">{certificadosPendientes}</div><div className="mt-0.5 text-[10px] text-[var(--muted)]">Certificados pendientes</div></div>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Distribución</div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div><div className="font-semibold text-[var(--ok)]">{estadoBreakdown.normal}</div><div className="text-[var(--muted)]">Normal</div></div>
          <div><div className="font-semibold text-[var(--warn)]">{estadoBreakdown.atencion}</div><div className="text-[var(--muted)]">Atención</div></div>
          <div><div className="font-semibold text-[var(--error)]">{estadoBreakdown.riesgo}</div><div className="text-[var(--muted)]">Riesgo</div></div>
        </div>
      </div>
    </section>
  );
}
