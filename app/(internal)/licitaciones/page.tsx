import { MetricGrid } from "@/components/dashboard/metric-card";
import { getLicitacionesPageData } from "./dashboard-data";
import { LicitacionesSection } from "./licitaciones-section";

export default async function LicitacionesPage() {
  const data = await getLicitacionesPageData();

  return (
    <div className="max-w-none space-y-6">
      {data.cards.length > 0 ? (
        <section className="space-y-4">
          <MetricGrid cards={data.cards} />
        </section>
      ) : null}

      <LicitacionesSection licitaciones={data.licitaciones} perfil={data.perfil} />
    </div>
  );
}
