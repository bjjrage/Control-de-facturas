import { PortfolioTable } from "./portfolio-table";
import { MetricGrid } from "./metric-card";
import { MetricChips } from "./metric-chips";
import { AttentionPanel } from "./attention-panel";
import { PanoramaObras } from "./panorama-obras";
import type { DashboardViewData } from "./data";

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const tone =
    title === "Administración"
      ? "section-accent-admin"
      : title === "Licitaciones"
        ? "section-accent-licitaciones"
        : "section-accent-operativo";

  return (
    <div className="flex items-baseline justify-between mb-2.5">
      <h2 className={`text-[12px] font-bold uppercase tracking-widest ${tone}`}>{title}</h2>
      {subtitle ? <span className="text-[11px] text-[var(--muted)]">{subtitle}</span> : null}
    </div>
  );
}

export function DashboardView({ data }: { data: DashboardViewData }) {
  const {
    canUseOperativo,
    adminCards,
    adminKpis,
    attentionAlerts,
    licitacionesCards,
    licitacionesKpis,
    portfolioRows,
    portfolioTotalCount,
    panorama,
  } = data;

  const hasAdmin = (adminCards && adminCards.length > 0) || (adminKpis && adminKpis.length > 0);
  const hasLicitaciones = (licitacionesCards && licitacionesCards.length > 0) || (licitacionesKpis && licitacionesKpis.length > 0);
  const hasObras = canUseOperativo && panorama;
  const hasAnyContent = hasAdmin || hasLicitaciones || hasObras;

  return (
    <div className="max-w-none space-y-7">
      {!hasAnyContent ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--muted)]">
          Todavía no hay datos suficientes para mostrar el resumen ejecutivo.
        </div>
      ) : null}

      {/* ================================================================= */}
      {/* 1. SECCIÓN ADMINISTRACIÓN                                         */}
      {/* ================================================================= */}
      {hasAdmin ? (
        <div className="space-y-4">
          <SectionHeader
            title="Administración"
            subtitle="8 KPIs ejecutivos · Datos reales ERP"
          />

          {adminCards && adminCards.length > 0 ? (
            <MetricGrid cards={adminCards} />
          ) : (
            <MetricChips chips={adminKpis} />
          )}

          {/* Panel de alertas prioritarias */}
          {attentionAlerts && attentionAlerts.length > 0 ? (
            <AttentionPanel alerts={attentionAlerts} />
          ) : null}
        </div>
      ) : null}

      {/* ================================================================= */}
      {/* 2. SECCIÓN LICITACIONES                                           */}
      {/* ================================================================= */}
      {hasLicitaciones ? (
        <div className="space-y-4">
          <SectionHeader
            title="Licitaciones"
            subtitle="8 KPIs ejecutivos · Document Readiness Engine"
          />

          {licitacionesCards && licitacionesCards.length > 0 ? (
            <MetricGrid cards={licitacionesCards} />
          ) : (
            <MetricChips chips={licitacionesKpis} />
          )}
        </div>
      ) : null}

      {/* ================================================================= */}
      {/* 3. SECCIÓN OBRAS (Preservado 100% fiel al diseño original)         */}
      {/* ================================================================= */}
      {hasObras ? (
        <div>
          <SectionHeader
            title="Obras"
            subtitle="Cartera de proyectos activos y control de avance"
          />
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] gap-4 items-stretch">
            <PortfolioTable rows={portfolioRows} totalCount={portfolioTotalCount} />
            <PanoramaObras data={panorama} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
