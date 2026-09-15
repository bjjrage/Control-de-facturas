import { PortfolioTable } from "./portfolio-table";
import { DomainChips } from "./domain-chips";
import { PanoramaObras } from "./panorama-obras";
import { DashboardViewData } from "./data";

// Composición del resumen ejecutivo — pura presentación a partir de datos ya
// serializados. La usan tanto page.tsx (carga inicial, server component)
// como dashboard-section.tsx (navegación instantánea del shell, client
// component) para que ambas rutas de render se vean siempre idénticas.
export function DashboardView({ data }: { data: DashboardViewData }) {
  const { firstName, canUseOperativo, domainChips, portfolioRows, panorama } = data;

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-[17px] font-semibold">Resumen ejecutivo</h1>
        <p className="text-[13px] text-[var(--muted)] mt-0.5">Hola, {firstName}</p>
      </div>

      <DomainChips chips={domainChips} />

      {domainChips.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
          Todavía no hay datos suficientes para mostrar el resumen ejecutivo.
        </div>
      ) : null}

      {canUseOperativo && panorama ? (
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-2">
            Análisis de obra
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4 items-stretch">
            <PortfolioTable rows={portfolioRows} />
            <PanoramaObras data={panorama} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
