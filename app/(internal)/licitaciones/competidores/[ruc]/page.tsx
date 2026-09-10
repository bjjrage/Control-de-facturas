import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/ui/back-button";
import { requireProfile } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getCompetitorProfile } from "@/lib/procurement/competitor-intelligence";
import { Building2, Users2, Award, Percent, AlertCircle, ShieldCheck } from "lucide-react";

export default async function CompetidorProfilePage({
  params,
}: {
  params: Promise<{ ruc: string }>;
}) {
  const { ruc } = await params;
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const profile = await getCompetitorProfile(decodeURIComponent(ruc), supabase);

  if (!profile) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-8">
        <BackButton label="Volver a licitaciones" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-amber-600" />
            <h2 className="text-lg font-semibold">Competidor no encontrado</h2>
          </div>
          <p className="mt-2 text-sm text-amber-800">
            No se registran ofertas históricas en la base para el identificador o RUC:{" "}
            <strong className="font-mono">{decodeURIComponent(ruc)}</strong>.
          </p>
        </div>
      </div>
    );
  }

  const certaintyColors = {
    ALTA: "bg-emerald-50 text-emerald-700 border-emerald-200",
    MEDIA: "bg-blue-50 text-blue-700 border-blue-200",
    BAJA: "bg-amber-50 text-amber-700 border-amber-200",
    INSUFICIENTE: "bg-zinc-50 text-zinc-600 border-zinc-200",
  }[profile.certainty_tier];

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <div className="space-y-3">
        <BackButton label="Volver al radar de licitaciones" />
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {profile.nombre}
              </h1>
              <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-800">
                {profile.tipo_entidad}
              </span>
            </div>
            <p className="mt-1 font-mono text-sm text-zinc-500">
              RUC: {profile.ruc_clean}
              {profile.dv ? `-${profile.dv}` : ""} {profile.tamano ? `• Escala: ${profile.tamano}` : ""}
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${certaintyColors}`}>
            <ShieldCheck className="h-4 w-4" />
            Certeza Estadística: {profile.certainty_tier} ({profile.total_bids} obs.)
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Tasa de Éxito (Win Rate)</span>
            <Award className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-3xl font-bold text-zinc-900">{profile.win_rate_pct}%</p>
          <p className="mt-1 text-xs text-zinc-500">
            {profile.total_wins} ganadas de {profile.total_bids} presentadas
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Adjudicado</span>
            <Building2 className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-zinc-900">
            {formatMoney(profile.total_awarded_amount, "PYG")}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Volumen histórico adjudicado</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Agresividad de Precio</span>
            <Percent className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-2 text-3xl font-bold text-zinc-900">
            {profile.global_avg_discount_pct > 0 ? `-${profile.global_avg_discount_pct}%` : `${profile.global_avg_discount_pct}%`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Descuento promedio vs presupuesto referencial</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-zinc-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Red de Consorcios</span>
            <Users2 className="h-4 w-4 text-orange-600" />
          </div>
          <p className="mt-2 text-3xl font-bold text-zinc-900">
            {profile.consortium_network.length}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Aliados habituales identificados</p>
        </div>
      </div>

      {/* Main Grid: Top Convocantes & Consorcios */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Convocantes Principales */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <h2 className="text-base font-semibold text-zinc-900">Organismos Convocantes Principales</h2>
          <p className="text-xs text-zinc-500">Entidades a las que más suele ofertar y adjudicar contratos</p>

          <div className="mt-4 divide-y divide-zinc-100">
            {profile.top_convocantes.length === 0 ? (
              <p className="py-4 text-xs text-zinc-400">Sin historial de convocantes discriminado.</p>
            ) : (
              profile.top_convocantes.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="max-w-[65%] truncate font-medium text-zinc-800" title={c.name}>
                    {c.name}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-zinc-900">{formatMoney(c.amount_won, "PYG")}</div>
                    <div className="text-xs text-zinc-500">
                      {c.wins_count}/{c.bids_count} ganadas ({c.win_rate_pct}%)
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Aliados y Consorcios */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <h2 className="text-base font-semibold text-zinc-900">Aliados y Consorcios Habituales</h2>
          <p className="text-xs text-zinc-500">Socios detectados en UTEs y acuerdos consorciales</p>

          <div className="mt-4 divide-y divide-zinc-100">
            {profile.consortium_network.length === 0 ? (
              <p className="py-4 text-xs text-zinc-400">Este competidor licita habitualmente de manera individual.</p>
            ) : (
              profile.consortium_network.slice(0, 6).map((net, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-zinc-800">{net.partner_name}</span>
                  <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                    {net.shared_tenders_count} licitaciones juntos
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Historial Reciente de Licitaciones */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs">
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900">Historial Reciente de Ofertas en Licitaciones</h2>
          <p className="text-xs text-zinc-500">Comportamiento competitivo en los últimos llamados públicos auditados</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase text-zinc-600">
              <tr>
                <th className="px-4 py-3">Licitación</th>
                <th className="px-4 py-3">Convocante</th>
                <th className="px-4 py-3">Monto Ofertado</th>
                <th className="px-4 py-3">Descuento</th>
                <th className="px-4 py-3">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {profile.recent_bids.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">
                    No se registran ofertas recientes cargadas.
                  </td>
                </tr>
              ) : (
                profile.recent_bids.map((b, i) => (
                  <tr key={i} className="hover:bg-zinc-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900">{b.title}</div>
                      <div className="text-xs text-zinc-500">ID DNCP: {b.dncp_nro}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">{b.buyer}</td>
                    <td className="px-4 py-3 font-semibold text-zinc-900">
                      {b.monto_ofertado ? formatMoney(b.monto_ofertado, "PYG") : "No publicado"}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {b.discount_pct !== null ? (
                        <span className={b.discount_pct > 0 ? "font-medium text-emerald-600" : "text-zinc-600"}>
                          {b.discount_pct > 0 ? `-${b.discount_pct}%` : `${b.discount_pct}%`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {b.gano ? (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          Ganadora
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                          {b.estado_oferta}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
