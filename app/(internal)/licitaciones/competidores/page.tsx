import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { requireProfile } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listCompetitors } from "@/lib/procurement/competitor-intelligence";
import { Building2, Search, ShieldCheck } from "lucide-react";

export default async function CompetidoresIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const competitors = await listCompetitors(supabase, { search: q, limit: 100 });

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

      {/* Buscador */}
      <form method="GET" className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por nombre o RUC de competidor..."
          className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-4 text-sm text-zinc-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </form>

      {/* Tabla de Competidores */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs">
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900">
            Competidores Observados ({competitors.length})
          </h2>
          <p className="text-xs text-zinc-500">
            Métricas calculadas a partir de actas de apertura, cuadros comparativos y registros históricos DNCP
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase text-zinc-600">
              <tr>
                <th className="px-4 py-3">Empresa / RUC</th>
                <th className="px-4 py-3">Escala</th>
                <th className="px-4 py-3 text-center">Ofertas</th>
                <th className="px-4 py-3 text-center">Ganadas</th>
                <th className="px-4 py-3 text-center">Win Rate</th>
                <th className="px-4 py-3 text-right">Monto Adjudicado</th>
                <th className="px-4 py-3 text-center">Certeza</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {competitors.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-500">
                    <Building2 className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
                    No se encontraron competidores con el criterio seleccionado.
                  </td>
                </tr>
              ) : (
                competitors.map((c) => {
                  const rucParam = c.ruc_clean || c.nombre;
                  const certaintyBadge = {
                    ALTA: "bg-emerald-50 text-emerald-700 border-emerald-200",
                    MEDIA: "bg-blue-50 text-blue-700 border-blue-200",
                    BAJA: "bg-amber-50 text-amber-700 border-amber-200",
                    INSUFICIENTE: "bg-zinc-50 text-zinc-600 border-zinc-200",
                  }[c.certainty_tier];

                  return (
                    <tr key={c.supplier_id || c.ruc_clean} className="hover:bg-zinc-50/60">
                      <td className="px-4 py-3">
                        <Link
                          href={`/licitaciones/competidores/${encodeURIComponent(rucParam)}`}
                          className="font-semibold text-blue-600 hover:underline"
                        >
                          {c.nombre}
                        </Link>
                        <div className="font-mono text-xs text-zinc-400">
                          {c.ruc_clean ? `RUC: ${c.ruc_clean}${c.dv ? `-${c.dv}` : ""}` : "Sin RUC registrado"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-600">
                        {c.tamano || "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-zinc-700">
                        {c.total_bids}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-zinc-700">
                        {c.total_wins}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-800">
                          {c.win_rate_pct}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                        {c.total_awarded_amount > 0 ? formatMoney(c.total_awarded_amount, "PYG") : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${certaintyBadge}`}>
                          <ShieldCheck className="h-3 w-3" />
                          {c.certainty_tier}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}