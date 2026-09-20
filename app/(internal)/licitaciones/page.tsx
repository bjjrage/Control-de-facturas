import { MetricGrid } from "@/components/dashboard/metric-card";
import { getLicitacionesPageData } from "./dashboard-data";
import { LicitacionesSection } from "./licitaciones-section";

export default async function LicitacionesPage() {
  const data = await getLicitacionesPageData();

  return (
    <div className="max-w-none space-y-6">
      {data.cards.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h1 className="section-accent-licitaciones text-[12px] font-bold uppercase tracking-widest">Licitaciones</h1>
              <p className="mt-1 text-[13px] text-[var(--muted)]">Salud y gestión del pipeline de oportunidades</p>
            </div>
            <span className="text-[11px] text-[var(--muted)]">8 KPIs ejecutivos · Document Readiness Engine</span>
          </div>
          <MetricGrid cards={data.cards} />
        </section>
      ) : null}

      <LicitacionesSection licitaciones={data.licitaciones} perfil={data.perfil} />
    </div>
  );
}
