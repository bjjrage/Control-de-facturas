"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CashflowTrendPoint, SalesTrendPoint } from "./data";

function formatFull(value: number | string): string {
  return Number(value).toLocaleString("es-PY");
}

function formatAxis(value: number): string {
  return new Intl.NumberFormat("es-PY", { notation: "compact" }).format(Number(value));
}

const TOOLTIP_STYLE = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
} as const;

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] px-4 text-center text-[12px] text-[var(--muted)]">
      {text}
    </div>
  );
}

export function AdminCharts({ sales, cashflow }: { sales: SalesTrendPoint[]; cashflow: CashflowTrendPoint[] }) {
  const hasSales = sales.some((p) => p.facturado > 0 || p.cobrado > 0);
  const hasCashflow = cashflow.some((p) => p.cobros > 0 || p.pagos > 0);

  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <section className="kpi-accent-budget rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--foreground)]">Ventas últimos 6 meses</h3>
        <p className="mt-1 text-[12px] text-[var(--muted)]">Facturado vs cobrado · Montos en PYG</p>
        <div className="mt-3">
          {hasSales ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={sales} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" width={52} tickFormatter={formatAxis} />
                <Tooltip
                  cursor={false}
                  isAnimationActive={false}
                  contentStyle={{ ...TOOLTIP_STYLE }}
                  formatter={(value) => formatFull(Number(value ?? 0))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="facturado" name="Facturado" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                <Bar dataKey="cobrado" name="Cobrado" fill="var(--ok)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="Sin facturación ni cobros en los últimos 6 meses" />
          )}
        </div>
      </section>

      <section className="kpi-accent-progress rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--foreground)]">Caja próximos 30 días</h3>
        <p className="mt-1 text-[12px] text-[var(--muted)]">Cobros vs pagos por semana · Montos en PYG</p>
        <div className="mt-3">
          {hasCashflow ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cashflow} margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" width={52} tickFormatter={formatAxis} />
                <Tooltip
                  cursor={false}
                  isAnimationActive={false}
                  contentStyle={{ ...TOOLTIP_STYLE }}
                  formatter={(value) => formatFull(Number(value ?? 0))}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cobros" name="Cobros" fill="var(--ok)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                <Bar dataKey="pagos" name="Pagos" fill="var(--error)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="Sin cobros ni pagos proyectados a 30 días" />
          )}
        </div>
      </section>
    </div>
  );
}
