import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { NewProjectDialog } from "./new-project-dialog";
import { PanoramaObras } from "./panorama-obras";
import { PortfolioTable } from "./portfolio-table";
import { ProjectsChart } from "./projects-chart";
import { getProjectsPortfolioData } from "./portfolio-data";
import type { MetricCardData } from "@/lib/dashboard/types";

export default async function ProjectsPage() {
  const data = await getProjectsPortfolioData();
  const { panorama } = data;
  const obrasEnAtencionRiesgo = panorama.estadoBreakdown.atencion + panorama.estadoBreakdown.riesgo;

  const cards: MetricCardData[] = [
    {
      key: "obras-activas",
      title: "Obras activas",
      value: String(panorama.obrasActivas),
      secondaryText: `${panorama.estadoBreakdown.atencion} en atención · ${panorama.estadoBreakdown.riesgo} en riesgo`,
      trendText: "Cartera en ejecución",
      trendTone: obrasEnAtencionRiesgo > 0 ? "down" : "up",
      href: "/projects#portfolio",
      iconKey: "hardhat",
      tone: obrasEnAtencionRiesgo > 0 ? "warn" : "ok",
    },
    {
      key: "cartera-activa",
      title: "Cartera activa",
      value: formatMoney(panorama.carteraActivaPyg, "PYG"),
      secondaryText: "Presupuesto de obras activas",
      trendText: `${panorama.obrasActivas} obras activas`,
      trendTone: "neutral",
      href: "/projects#portfolio",
      iconKey: "scale",
      tone: "ok",
    },
    {
      key: "avance-fisico-ponderado",
      title: "Avance físico ponderado",
      value: `${panorama.avanceFisicoPonderado}%`,
      secondaryText: "Ponderado por presupuesto",
      trendText: "Ejecución en campo",
      trendTone: "neutral",
      href: "/projects#portfolio",
      iconKey: "trending-up",
      tone: "ok",
    },
    {
      key: "obras-atencion-riesgo",
      title: "Obras en atención / riesgo",
      value: String(obrasEnAtencionRiesgo),
      secondaryText: `Atención: ${panorama.estadoBreakdown.atencion} · Riesgo: ${panorama.estadoBreakdown.riesgo}`,
      trendText: obrasEnAtencionRiesgo > 0 ? "Requiere seguimiento" : "Sin señales críticas",
      trendTone: obrasEnAtencionRiesgo > 0 ? "down" : "up",
      href: "/projects#portfolio",
      iconKey: "alert-triangle",
      tone: panorama.estadoBreakdown.riesgo > 0 ? "error" : obrasEnAtencionRiesgo > 0 ? "warn" : "ok",
    },
    {
      key: "desvios-plazo",
      title: "Desvíos de plazo",
      value: String(panorama.desviosPlazo),
      secondaryText: "Obras activas atrasadas",
      trendText: panorama.desviosPlazo > 0 ? "Revisar cronograma" : "En plazo",
      trendTone: panorama.desviosPlazo > 0 ? "down" : "up",
      href: "/projects#portfolio",
      iconKey: "calendar-clock",
      tone: panorama.desviosPlazo > 0 ? "warn" : "ok",
    },
    {
      key: "desvios-costo",
      title: "Desvíos de costo",
      value: String(panorama.desviosCosto),
      secondaryText: "Compras por encima del presupuesto",
      trendText: panorama.desviosCosto > 0 ? "Revisar compras" : "Sin desvíos",
      trendTone: panorama.desviosCosto > 0 ? "down" : "up",
      href: "/projects#portfolio",
      iconKey: "dollar-sign",
      tone: panorama.desviosCosto > 0 ? "error" : "ok",
    },
  ];

  return (
    <div className="max-w-none space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Operativo · Obras</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Salud de la cartera y selector de obra</p>
        </div>
        <NewProjectDialog trigger={<Button>Nueva obra</Button>} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => <MetricCard key={card.key} card={card} />)}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <PortfolioTable rows={data.rows} />
        <PanoramaObras data={panorama} />
      </div>

      {data.attentionAlerts.length > 0 ? <AttentionPanel alerts={data.attentionAlerts} title="Requiere atención · Obras" /> : null}

      {data.chartData.length > 0 ? <ProjectsChart data={data.chartData} /> : null}
    </div>
  );
}
