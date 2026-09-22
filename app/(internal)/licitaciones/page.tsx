import { MetricGrid } from "@/components/dashboard/metric-card";
import { getLicitacionesPageData } from "./dashboard-data";
import { LicitacionesSection } from "./licitaciones-section";

export default async function LicitacionesPage() {
  const data = await getLicitacionesPageData();

  return (
    <div className="max-w-none space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="section-accent-licitaciones text-[12px] font-bold uppercase tracking-widest">Licitaciones</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Seguimiento ejecutivo de oportunidades y procesos licitatorios</p>
        </div>
      </div>

      {data.cards.length > 0 ? (
        <section className="space-y-4">
          <MetricGrid cards={data.cards} />
        </section>
      ) : null}

      <LicitacionesSection licitaciones={data.licitaciones} perfil={data.perfil} />
    </div>
  );
}
