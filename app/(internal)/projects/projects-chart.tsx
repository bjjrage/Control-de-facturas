"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ChartRow = { name: string; presupuesto: number; compras: number; avancePct: number };

export function ProjectsChart({ data }: { data: ChartRow[] }) {
  if (data.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h2 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Avance vs presupuesto general de obras</h2>
        <p className="mt-1 text-[12px] text-[var(--muted)]">Avance fÃ­sico, presupuesto y compras por obra activa</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted)" />
          <YAxis yAxisId="money" tick={{ fontSize: 11 }} stroke="var(--muted)" width={70} />
          <YAxis yAxisId="progress" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--muted)" unit="%" width={42} />
          <Tooltip
            cursor={false}
            isAnimationActive={false}
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => Number(value).toLocaleString("es-PY")}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="money" dataKey="presupuesto" name="Presupuesto" fill="#1d4ed8" radius={[4, 4, 0, 0]} maxBarSize={80} isAnimationActive={false} />
          <Bar yAxisId="money" dataKey="compras" name="Compras" fill="#d4711a" radius={[4, 4, 0, 0]} maxBarSize={80} isAnimationActive={false} />
          <Line yAxisId="progress" type="monotone" dataKey="avancePct" name="Avance" stroke="var(--ok)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
