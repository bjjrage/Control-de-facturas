import Link from "next/link";

import { requirePlan } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getLicitacionesPageData } from "../dashboard-data";
import { ImportarDialog } from "../licitaciones-section";

export default async function PrebidIndexPage() {
  const profile = await requirePlan("pro", ["comercial", "administracion", "admin"]);
  const { licitaciones } = await getLicitacionesPageData(profile);

  return (
    <main className="max-w-none space-y-4">
      <header>
        <h1 className="section-accent-licitaciones text-[12px] font-bold uppercase tracking-widest">PREBID</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Elegí una licitación existente para preparar su oferta.
        </p>
      </header>

      {licitaciones.length === 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-5 py-12 text-center">
          <h2 className="text-[15px] font-semibold">No hay licitaciones para preparar.</h2>
          <p className="mx-auto mt-2 max-w-lg text-[13px] text-[var(--muted)]">
            Primero importá un llamado de la DNCP; después vas a poder abrir su workspace PREBID.
          </p>
          <div className="mt-5 flex justify-center">
            <ImportarDialog triggerLabel="IMPORTAR DNCP" />
          </div>
        </section>
      ) : (
        <ul className="space-y-3">
          {licitaciones.map((licitacion) => {
            if (!licitacion.id) return null;

            return (
              <li key={licitacion.id} className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-[11px] text-[var(--muted)]">
                    {licitacion.dncp_nro ? `Llamado DNCP ${licitacion.dncp_nro}` : "Llamado DNCP"}
                  </p>
                  <h2 className="text-[14px] font-semibold">{licitacion.titulo ?? "Licitación sin título"}</h2>
                  {licitacion.comitente_nombre ? (
                    <p className="text-[12px] text-[var(--muted)]">{licitacion.comitente_nombre}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[12px] text-[var(--muted)]">
                    <span>Estado: {licitacion.estado_detalle ?? licitacion.estado ?? "No informado"}</span>
                    <span>
                      Entrega de ofertas: {licitacion.fecha_entrega_ofertas ? formatDate(licitacion.fecha_entrega_ofertas) : "Sin fecha informada"}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/licitaciones/${licitacion.id}/prebid`}
                  aria-label={`Abrir PREBID para ${licitacion.titulo ?? "la licitación"}`}
                  className="inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] px-4 py-2 text-[12px] font-semibold text-action hover:bg-[var(--panel-2)]"
                >
                  ABRIR PREBID
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
