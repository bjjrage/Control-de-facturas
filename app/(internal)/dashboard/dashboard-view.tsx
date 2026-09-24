import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { DASHBOARD_ICONS } from "./icon-map";
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
  const {
    firstName,
    canUseOperativo,
    legacyStats,
    recentRfqs,
    showRecentRfqs,
    adminKpis,
    licitacionesKpis,
    portfolioRows,
    portfolioTotalCount,
    panorama,
  } = data;

  const hasModernContent = adminKpis.length > 0 || (canUseOperativo && panorama) || licitacionesKpis.length > 0;
  const hasAnyContent = legacyStats.length > 0 || showRecentRfqs || hasModernContent;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-[17px] font-semibold">Hola, {firstName}</h1>
        <p className="text-[13px] text-[var(--muted)] mt-0.5">Panel de operación</p>
      </div>

      {!hasAnyContent ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
          Todavía no hay datos suficientes para mostrar el resumen ejecutivo.
        </div>
      ) : null}

      {legacyStats.length > 0 ? (
        <div>
          <SectionHeader title="Pendientes y actividad" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {legacyStats.map((stat) => {
              const Icon = DASHBOARD_ICONS[stat.iconKey];
              const toneClass =
                stat.tone === "error"
                  ? "bg-[var(--error-bg)] text-[var(--error)]"
                  : stat.tone === "warn"
                    ? "bg-[var(--warn-bg)] text-[var(--warn)]"
                    : "bg-[var(--ok-bg)] text-[var(--ok)]";
              return (
                <Link
                  key={stat.key}
                  href={stat.href}
                  className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 hover:bg-[var(--hover)] flex items-center gap-3 transition-colors"
                >
                  <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${toneClass}`}>
                    <Icon size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[22px] font-semibold leading-none mb-1">{stat.value}</div>
                    <div className="text-[12px] text-[var(--muted)]">{stat.label}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {showRecentRfqs ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">Solicitudes recientes</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Producto</th>
                  <th>Estado</th>
                  <th>Creada</th>
                </tr>
              </thead>
              <tbody>
                {recentRfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      <Link href={`/rfqs/${rfq.id}`} className="text-action font-medium">
                        {rfq.code}
                      </Link>
                    </td>
                    <td>{rfq.product}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={rfq.isOpen ? "warn" : "neutral"}>{rfq.isOpen ? "Abierta" : "Cerrada"}</Badge>
                        {rfq.closedReason ? <span className="text-[11px] text-[var(--muted)]">{rfq.closedReason}</span> : null}
                      </span>
                    </td>
                    <td>{formatDate(rfq.createdAt)}</td>
                  </tr>
                ))}
                {recentRfqs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-[var(--muted)] py-6">
                      Todavía no hay solicitudes.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {hasModernContent ? <SectionHeader title="Indicadores actuales" /> : null}

      {adminKpis.length > 0 ? (
        <div>
          <SectionHeader title="Administración" />
          <MetricChips chips={adminKpis} />
        </div>
      ) : null}

      {canUseOperativo && panorama ? (
        <div>
          <SectionHeader title="Obras" />
          <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4 items-stretch">
            <PortfolioTable rows={portfolioRows} totalCount={portfolioTotalCount} />
            <PanoramaObras data={panorama} />
          </div>
        </div>
      ) : null}

      {licitacionesKpis.length > 0 ? (
        <div>
          <SectionHeader title="Licitaciones" />
          <MetricChips chips={licitacionesKpis} />
        </div>
      ) : null}
    </div>
  );
}
