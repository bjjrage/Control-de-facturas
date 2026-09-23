"use client";

import { PieChart, Pie, Cell } from "recharts";
import { TrendingUp, AlertTriangle, Clock, ShoppingCart, Boxes } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { PanoramaObras as PanoramaObrasData } from "./data";

const ESTADO_COLORS = {
  normal: "#2dd4bf",
  atencion: "#f5a524",
  riesgo: "#f2685c",
} as const;

// Contraparte de la tabla de portafolio: mientras la tabla lee obra por
// obra, esto responde de un vistazo "¿cómo está la cartera en conjunto?" —
// plata activa, cuántas obras se desviaron y de qué tipo, avance ponderado
// por presupuesto (una obra grande pesa más que una chica en el promedio).
export function PanoramaObras({ data }: { data: PanoramaObrasData }) {
  const {
    obrasActivas,
    carteraActivaPyg,
    comprasRealizadasPyg,
    productosStockMinimo,
    desviosCosto,
    desviosPlazo,
    avanceFisicoPonderado,
    estadoBreakdown,
  } = data;
  const donutData = [
    { key: "normal", value: estadoBreakdown.normal, color: ESTADO_COLORS.normal },
    { key: "atencion", value: estadoBreakdown.atencion, color: ESTADO_COLORS.atencion },
    { key: "riesgo", value: estadoBreakdown.riesgo, color: ESTADO_COLORS.riesgo },
  ].filter((d) => d.value > 0);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 h-full flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="relative h-[92px] w-[92px] shrink-0">
          {donutData.length > 0 ? (
            <PieChart width={92} height={92} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="key"
                cx={46}
                cy={46}
                innerRadius={30}
                outerRadius={44}
                paddingAngle={donutData.length > 1 ? 3 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {donutData.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <div className="h-full w-full rounded-full border-4 border-[var(--hover)]" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[19px] font-semibold leading-none">{obrasActivas}</span>
            <span className="text-[9px] text-[var(--muted)] mt-0.5">obras</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)] truncate">Cartera activa</div>
          <div className="text-[17px] font-semibold leading-none truncate">{formatMoney(carteraActivaPyg)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="kpi-hover rounded-lg border border-transparent bg-[var(--panel-2)] p-2.5 flex items-center gap-2">
          <AlertTriangle size={14} className="text-[var(--error)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold leading-none">{desviosCosto}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">Desvíos de costo</div>
          </div>
        </div>
        <div className="kpi-hover rounded-lg border border-transparent bg-[var(--panel-2)] p-2.5 flex items-center gap-2">
          <Clock size={14} className="text-[var(--warn)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold leading-none">{desviosPlazo}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">Desvíos de plazo</div>
          </div>
        </div>
        <div className="kpi-hover rounded-lg border border-transparent bg-[var(--panel-2)] p-2.5 flex items-center gap-2">
          <ShoppingCart size={14} className="text-[var(--primary)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold leading-none truncate">{formatMoney(comprasRealizadasPyg)}</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">Compras realizadas</div>
          </div>
        </div>
        {productosStockMinimo !== null ? (
          <div
            className="kpi-hover rounded-lg border border-transparent bg-[var(--panel-2)] p-2.5 flex items-center gap-2"
          >
            <Boxes size={14} className={productosStockMinimo > 0 ? "text-[var(--error)] shrink-0" : "text-[var(--ok)] shrink-0"} />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold leading-none">{productosStockMinimo}</div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">Stock mínimo</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-auto">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="flex items-center gap-1 text-[var(--muted)]">
            <TrendingUp size={12} /> Avance físico ponderado
          </span>
          <span className="font-semibold tabular-nums">{avanceFisicoPonderado}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--hover)] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, avanceFisicoPonderado)}%`,
              background: "linear-gradient(90deg, #2563eb, #2dd4bf)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
