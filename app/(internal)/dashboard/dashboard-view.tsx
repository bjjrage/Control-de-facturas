import { PortfolioTable } from "./portfolio-table";
import { AdminKpis } from "./admin-kpis";
import { LicitacionesKpis } from "./licitaciones-kpis";
import { AttentionSection } from "./attention-section";
import { DashboardViewData } from "./data";

// Composición del resumen ejecutivo — pura presentación a partir de datos ya
// serializados. La usan tanto page.tsx (carga inicial, server component)
// como dashboard-section.tsx (navegación instantánea del shell, client
// component) para que ambas rutas de render se vean siempre idénticas.
export function DashboardView({ data }: { data: DashboardViewData }) {
  const { firstName, canUseOperativo, portfolioRows, avanceProm, obrasEnRiesgo, adminKpis, licitacionesKpis, attentionItems } = data;
  const hasAnySection = canUseOperativo || adminKpis.length > 0 || licitacionesKpis.length > 0;

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold">Resumen ejecutivo</h1>
        <p className="text-[13px] text-[var(--muted)] mt-0.5">Hola, {firstName}</p>
      </div>

      {attentionItems.length > 0 ? (
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">
            Requiere atención
          </h2>
          <AttentionSection items={attentionItems} />
        </div>
      ) : null}

      {!hasAnySection ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
          Todavía no hay datos suficientes para mostrar el resumen ejecutivo.
        </div>
      ) : null}

      <div className={canUseOperativo ? "grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start" : ""}>
        {canUseOperativo ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)]">
                Portafolio de obras
              </h2>
              <span className="text-[11px] text-[var(--muted)]">
                {portfolioRows.length} activa{portfolioRows.length !== 1 ? "s" : ""} · {avanceProm}% avance prom.
                {obrasEnRiesgo > 0 ? ` · ${obrasEnRiesgo} en atención` : ""}
              </span>
            </div>
            <PortfolioTable rows={portfolioRows} />
          </div>
        ) : null}

        {adminKpis.length > 0 ? (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">
              Administración
            </h2>
            <AdminKpis kpis={adminKpis} />
          </div>
        ) : null}
      </div>

      {licitacionesKpis.length > 0 ? (
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">Licitaciones</h2>
          <LicitacionesKpis kpis={licitacionesKpis} />
        </div>
      ) : null}
    </div>
  );
}
