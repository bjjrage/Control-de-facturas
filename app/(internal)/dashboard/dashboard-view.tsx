import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { MetricGrid } from "@/components/dashboard/metric-card";
import { AdminCharts } from "./admin-charts";
import { MetricChips } from "./metric-chips";
import type { DashboardViewData } from "./data";

export function DashboardView({ data }: { data: DashboardViewData }) {
  const { adminCards, secondaryAdminCards, salesTrend, cashflowTrend, adminKpis, attentionAlerts } = data;
  return (
    <div className="max-w-none space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="section-accent-admin text-[12px] font-bold uppercase tracking-widest">Administración</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Salud financiera y administrativa de la empresa</p>
        </div>
        <span className="text-[11px] text-[var(--muted)]">8 KPIs ejecutivos · Datos reales ERP</span>
      </div>

      {adminCards.length > 0 ? <MetricGrid cards={adminCards} /> : <MetricChips chips={adminKpis} />}
      {data.cashflowSummary?.length>0 && <div className="rounded-lg border border-[var(--border)] p-3 text-[12px]" aria-label="Fuentes del flujo de caja">{data.cashflowSummary.map(line=><p key={line}>{line}</p>)}</div>}

      {secondaryAdminCards.length > 0 ? (
        <section aria-label="Indicadores financieros de seguimiento" className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--accent-finanzas)]">Seguimiento financiero</h2>
          <AdminCharts sales={salesTrend} cashflow={cashflowTrend} />
        </section>
      ) : null}

      {attentionAlerts.length > 0 ? (
        <AttentionPanel alerts={attentionAlerts} />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[12px] text-[var(--muted)]">
          Sin alertas críticas
        </div>
      )}
    </div>
  );
}
