import { MetricCard } from "@/components/dashboard/metric-card";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { NewProjectDialog } from "./new-project-dialog";
import { PortfolioPreview } from "./portfolio-preview";
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
    {
      key: "compras-realizadas",
      title: "Compras realizadas",
      value: formatMoney(panorama.comprasRealizadasPyg, "PYG"),
      secondaryText: `${panorama.ordenesCompra} OC autorizadas`,
      trendText: "InversiÃ³n ejecutada",
      trendTone: "neutral",
      href: "/projects#portfolio",
      iconKey: "shopping-cart",
      tone: "ok",
    },
    {
      key: "stock-critico",
      title: "Stock crÃ­tico",
      value: panorama.stockSourceUnavailable ? "N/D" : String(panorama.productosStockMinimo),
      secondaryText: panorama.stockSourceUnavailable ? "Stock canónico no disponible" : "Materiales bajo mínimo",
      trendText: panorama.stockSourceUnavailable ? "Revisar Stock e Inventario" : panorama.productosStockMinimo > 0 ? "Requiere reposición" : "Stock controlado",
      trendTone: panorama.stockSourceUnavailable || panorama.productosStockMinimo > 0 ? "down" : "up",
      href: "/inventario",
      iconKey: "boxes",
      tone: panorama.stockSourceUnavailable ? "error" : panorama.productosStockMinimo > 0 ? "warn" : "ok",
    },
    {
      key: "certificados-pendientes",
      title: "Certificados pendientes",
      value: String(panorama.certificadosPendientes),
      secondaryText: "Pendientes de certificaciÃ³n",
      trendText: panorama.certificadosPendientes > 0 ? "Requiere gestiÃ³n" : "Al dÃ­a",
      trendTone: panorama.certificadosPendientes > 0 ? "down" : "up",
      href: "/projects#portfolio",
      iconKey: "file-check",
      tone: panorama.certificadosPendientes > 0 ? "warn" : "ok",
    },
  ];

  return (
    <div className="max-w-none space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="section-accent-operativo text-[12px] font-bold uppercase tracking-widest">Operativo · Obras</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Seguimiento ejecutivo de la cartera de obras</p>
        </div>
        <NewProjectDialog trigger={<Button>Nueva obra</Button>} />
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => <MetricCard key={card.key} card={card} compact />)}
      </div>

      <ProjectsChart data={data.chartData} />

      <PortfolioPreview rows={data.rows} />
    </div>
  );
}
