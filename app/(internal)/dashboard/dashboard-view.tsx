import { PortfolioTable } from "./portfolio-table";
import { MetricChips } from "./metric-chips";
import { PanoramaObras } from "./panorama-obras";
import { DashboardViewData } from "./data";

function SectionHeader({ title }: { title: string }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">{title}</h2>;
}

// Composición del resumen ejecutivo — pura presentación a partir de datos ya
// serializados. La usan tanto page.tsx (carga inicial, server component)
// como dashboard-section.tsx (navegación instantánea del shell, client
// component) para que ambas rutas de render se vean siempre idénticas.
//
// 3 secciones, una por workspace (Administración/Obras/Licitaciones), cada
// una con sus propios KPIs indispensables — no un resumen único aplanado
// que pierde los montos y cantidades que importan de cada área.
export function DashboardView({ data }: { data: DashboardViewData }) {
  const { firstName, canUseOperativo, adminKpis, licitacionesKpis, portfolioRows, portfolioTotalCount, panorama } = data;

  const hasAnyContent = adminKpis.length > 0 || (canUseOperativo && panorama) || licitacionesKpis.length > 0;

  return (
    <div className="max-w-none space-y-6">
      <div>
        <h1 className="text-[17px] font-semibold">Resumen ejecutivo</h1>
        <p className="text-[13px] text-[var(--muted)] mt-0.5">Hola, {firstName}</p>
      </div>

      {!hasAnyContent ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
          Todavía no hay datos suficientes para mostrar el resumen ejecutivo.
        </div>
      ) : null}

      {adminKpis.length > 0 ? (
        <div>
          <SectionHeader title="Administración" />
          <MetricChips chips={adminKpis} />
        </div>
      ) : null}

      {licitacionesKpis.length > 0 ? (
        <div>
          <SectionHeader title="Licitaciones" />
          <MetricChips chips={licitacionesKpis} />
        </div>
      ) : null}

      {canUseOperativo && panorama ? (
        <div>
          <SectionHeader title="Obras" />
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)] gap-4 items-stretch">
            <PortfolioTable rows={portfolioRows} totalCount={portfolioTotalCount} />
            <PanoramaObras data={panorama} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
