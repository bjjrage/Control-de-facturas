"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

type ChartRow = { name: string; presupuesto: number; compras: number };

export function ProjectsChart({ data }: { data: ChartRow[] }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="text-[13px] font-semibold mb-3">Presupuesto vs. compras por proyecto</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" width={70} />
          <Tooltip
            cursor={{ fill: "var(--hover)" }}
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => Number(value).toLocaleString("es-PY")}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="presupuesto" name="Presupuesto" fill="#1d4ed8" radius={[4, 4, 0, 0]} maxBarSize={80} />
          <Bar dataKey="compras" name="Compras" fill="#d4711a" radius={[4, 4, 0, 0]} maxBarSize={80} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
