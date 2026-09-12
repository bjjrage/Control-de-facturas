import { BackButton } from "@/components/ui/back-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  listCompetitorsRadar,
  RadarCertaintyFilter,
  RadarEvidenceFilter,
  RadarOutcomeFilter,
  RadarPeriodMonths,
} from "@/lib/procurement/competitor-intelligence";
import { CompetidoresRadarClient } from "./competidores-radar-client";

export default async function CompetidoresIndexPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    period?: string;
    evidence?: string;
    minBids?: string;
    certainty?: string;
    outcome?: string;
    showExcluded?: string;
    page?: string;
  }>;
}) {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const params = await searchParams;
  const supabase = await createClient();

  // Parsing and defaults: 24 months, CON_EVIDENCIA, >=1 min bids, TODAS certainty, TODOS outcome
  const q = params.q?.trim() || "";
  const period = (params.period ? Number(params.period) : 24) as RadarPeriodMonths;
  const evidence = (params.evidence || "CON_EVIDENCIA") as RadarEvidenceFilter;
  const minBids = params.minBids ? Number(params.minBids) : 1;
  const certainty = (params.certainty || "TODAS") as RadarCertaintyFilter;
  const outcome = (params.outcome || "TODOS") as RadarOutcomeFilter;
  const showExcluded = params.showExcluded === "true";
  const page = Math.max(1, params.page ? Number(params.page) : 1);
  const limit = 50;

  const result = await listCompetitorsRadar(supabase, profile.empresa_id, {
    search: q,
    periodMonths: period,
    evidence,
    minBids,
    certainty,
    outcome,
    includeExcluded: showExcluded,
    limit,
    page,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      <div className="space-y-2">
        <BackButton label="Volver a licitaciones" />
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              Radar de Competidores
            </h1>
            <p className="text-sm text-zinc-500">
              Directorio analítico 360° de empresas constructoras y oferentes observados en licitaciones públicas (Gate 5A).
            </p>
          </div>
        </div>
      </div>

      <CompetidoresRadarClient
        competitors={result.competitors}
        totalFiltered={result.totalFiltered}
        totalHistorical={result.totalHistorical}
        page={result.page}
        limit={result.limit}
        totalPages={result.totalPages}
        currentFilters={{
          q,
          period,
          evidence,
          minBids,
          certainty,
          outcome,
          showExcluded,
        }}
      />
    </div>
  );
}