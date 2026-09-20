import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { MetricGrid } from "@/components/dashboard/metric-card";
import { MetricChips } from "./metric-chips";
import type { DashboardViewData } from "./data";

export function DashboardView({ data }: { data: DashboardViewData }) {
  const { adminCards, adminKpis, attentionAlerts } = data;
  return (
    <div className="max-w-none space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="section-accent-admin text-[12px] font-bold uppercase tracking-widest">Administración</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Salud financiera y administrativa de la empresa</p>
        </div>
        <span className="text-[11px] text-[var(--muted)]">8 KPIs ejecutivos · Datos reales ERP</span>
      </div>

      {adminCards.length > 0 ? <MetricGrid cards={adminCards} /> : <MetricChips chips={adminKpis} />}

      {attentionAlerts.length > 0 ? <AttentionPanel alerts={attentionAlerts} /> : null}
    </div>
  );
}
