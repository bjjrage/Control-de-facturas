import Link from "next/link";
import { notFound } from "next/navigation";

import { BackButton } from "@/components/ui/back-button";
import { requireProfile } from "@/lib/auth";
import { matchProducto, type ProductoLite } from "@/lib/dncp/match-productos";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type {
  CurrencyCode,
  Licitacion,
  LicitacionDocumento,
  LicitacionItem,
  LicitacionLote,
  LicitacionOferente,
} from "@/lib/types";

import { ReimportarButton } from "./reimportar-button";

export default async function LicitacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const { data: lic } = await supabase
    .from("licitaciones")
    .select("*")
    .eq("id", id)
    .maybeSingle<Licitacion>();
  if (!lic) notFound();

  const [{ data: lotes }, { data: items }, { data: oferentes }, { data: docs }, { data: productos }, { data: snapshots }] = await Promise.all([
    supabase.from("licitacion_lotes").select("*").eq("licitacion_id", id).order("numero").returns<LicitacionLote[]>(),
    supabase.from("licitacion_items").select("*").eq("licitacion_id", id).order("sort_order").returns<LicitacionItem[]>(),
    supabase
      .from("licitacion_oferentes")
      .select("*")
      .eq("licitacion_id", id)
      .order("gano", { ascending: false })
      .returns<LicitacionOferente[]>(),
    supabase.from("licitacion_documentos").select("*").eq("licitacion_id", id).order("tipo_detalle").returns<LicitacionDocumento[]>(),
    supabase
      .from("productos")
      .select("id, nombre, unidad, costo_promedio")
      .eq("activo", true)
      .gt("costo_promedio", 0)
      .returns<ProductoLite[]>(),
    supabase
      .from("bid_analysis_runs")
      .select("id, decision, overall_score, snapshot_hash, blockers, justifications, precio_oferta_recomendado_pyg, margen_neto_estimado_pct, probabilidad_ganar_pct, created_at")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
  ]);

  const latestSnapshot = snapshots && snapshots.length > 0 ? snapshots[0] : null;

  // Gate 7: Item Matching Engine con lematización, stopwords y calibres paraguayos
  const { matchTenderItem } = await import("@/lib/procurement/item-matching");
  const catalogForMatching = (productos ?? []).map(p => ({
    id: p.id,
    descripcion: p.nombre,
    unidad: p.unidad,
  }));

  // Sugerencia de costo según Costo Promedio Ponderado de inventario por ítem
  const costoPorItem = new Map<string, { nombre: string; costoPromedioInventario: number; score: number; confidence: string }>();
  for (const it of items ?? []) {
    const match = matchTenderItem(it.descripcion, it.unidad || "UN", catalogForMatching);
    if (match.bestMatch) {
      const prodOriginal = (productos ?? []).find(p => p.id === match.bestMatch!.item.id);
      if (prodOriginal) {
        costoPorItem.set(it.id, {
          nombre: prodOriginal.nombre,
          costoPromedioInventario: prodOriginal.costo_promedio,
          score: match.bestMatch.similarityScore,
          confidence: match.bestMatch.confidence
        });
        continue;
      }
    }

    // Fallback liviano
    const m = matchProducto(it.descripcion, productos ?? []);
    if (m) {
      costoPorItem.set(it.id, {
        nombre: m.producto.nombre,
        costoPromedioInventario: m.producto.costo_promedio,
        score: m.score,
        confidence: m.score >= 0.65 ? 'MATCH_AUTOMATICO' : 'REQUIERE_REVISION'
      });
    }
  }
  const hayCatalogo = (productos ?? []).length > 0;

  const moneda = (lic.moneda ?? "PYG") as CurrencyCode;
  const loteById = new Map((lotes ?? []).map((l) => [l.id, l]));

  return (
    <div className="max-w-5xl space-y-6">
      <BackButton label="Volver a Licitaciones" />

      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[17px] font-semibold">{lic.titulo}</h1>
            {lic.invitada ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ok)] bg-[var(--ok-bg)] px-1.5 py-0.5 rounded">
                Invitada
              </span>
            ) : null}
          </div>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            {lic.dncp_nro} · {lic.comitente_nombre ?? "—"} · {lic.procurement_method_detalle ?? lic.procurement_method ?? "—"}
          </p>
        </div>
        <ReimportarButton nro={lic.dncp_nro} id={lic.id} />
      </div>

      {/* Datos clave */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Dato label="Referencial" valor={lic.monto_referencial ? formatMoney(lic.monto_referencial, moneda) : "—"} />
        <Dato label="Monto disponible" valor={lic.monto_disponible ? formatMoney(lic.monto_disponible, moneda) : "—"} />
        <Dato label="Criterio" valor={lic.award_criteria_detalle ?? "—"} />
        <Dato label="Estado" valor={lic.estado_detalle ?? lic.estado ?? "—"} />
        <Dato label="Fin de consultas" valor={lic.fecha_consultas_fin ? formatDate(lic.fecha_consultas_fin) : "—"} />
        <Dato label="Entrega de ofertas" valor={lic.fecha_entrega_ofertas ? formatDateTime(lic.fecha_entrega_ofertas) : "—"} />
        <Dato label="Apertura" valor={lic.fecha_apertura ? formatDateTime(lic.fecha_apertura) : "—"} />
        <Dato label="Sincronizado" valor={formatDateTime(lic.synced_at)} />
      </div>
      {lic.lugar_apertura ? (
        <p className="text-[12px] text-[var(--muted)]">Lugar de apertura: {lic.lugar_apertura}</p>
      ) : null}

      {/* Panel Bid Engine: Análisis Comercial */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold">Evaluación Comercial (Bid Engine)</h2>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
              latestSnapshot
                ? latestSnapshot.decision === "COMPETIR"
                  ? "bg-[var(--ok-bg)] text-[var(--ok)]"
                  : latestSnapshot.decision === "REVISAR"
                  ? "bg-amber-500/10 text-amber-600"
                  : "bg-red-500/10 text-red-600"
                : "bg-[var(--panel-2)] text-[var(--muted)]"
            }`}>
              {latestSnapshot ? `${latestSnapshot.decision} (SCORE: ${latestSnapshot.overall_score}/100)` : "SIN EVALUACIÓN"}
            </span>
            {latestSnapshot ? (
              <span className="text-[10px] mono text-[var(--muted)]" title={`Hash SHA-256 completo: ${latestSnapshot.snapshot_hash}`}>
                SHA: {latestSnapshot.snapshot_hash.slice(0, 12)}...
              </span>
            ) : null}
          </div>
          {lic.decision ? (
            <span className="text-[12px] font-medium text-[var(--primary)]">
              Decisión: {lic.decision}
            </span>
          ) : null}
        </div>

        {latestSnapshot && Array.isArray(latestSnapshot.blockers) && latestSnapshot.blockers.length > 0 ? (
          <div className="rounded border border-red-500/20 bg-red-500/5 p-2.5 space-y-1">
            <div className="text-[11px] font-semibold text-red-600 uppercase tracking-wide">
              Bloqueadores detectados en pliego / cómputo:
            </div>
            <ul className="list-disc list-inside text-[12px] text-red-700/90 space-y-0.5">
              {latestSnapshot.blockers.map((b: string, i: number) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3 text-[13px]">
          <div className="rounded border border-[var(--border)] p-2.5 bg-[var(--panel-2)]">
            <div className="text-[11px] text-[var(--muted)]">Presupuesto Convocante</div>
            <div className="text-[15px] font-semibold mt-0.5">
              {lic.monto_referencial ? formatMoney(lic.monto_referencial, moneda) : "—"}
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-1">
              Base oficial del pliego
            </div>
          </div>

          <div className="rounded border border-[var(--border)] p-2.5 bg-[var(--panel-2)]">
            <div className="text-[11px] text-[var(--muted)]">Costo Directo Estimado (Inventario)</div>
            <div className="text-[15px] font-semibold mt-0.5">
              {(() => {
                let totalCostoPropio = 0;
                let itemsConCosto = 0;
                for (const it of items ?? []) {
                  const c = costoPorItem.get(it.id);
                  if (c && it.cantidad) {
                    totalCostoPropio += c.costoPromedioInventario * it.cantidad;
                    itemsConCosto++;
                  }
                }
                return totalCostoPropio > 0 ? formatMoney(totalCostoPropio, moneda) : "Sin catálogo";
              })()}
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-1">
              Calculado desde costo promedio de stock
            </div>
          </div>

          <div className="rounded border border-[var(--border)] p-2.5 bg-[var(--panel-2)]">
            <div className="text-[11px] text-[var(--muted)]">Ítems Emparejados</div>
            <div className="text-[15px] font-semibold mt-0.5">
              {costoPorItem.size} de {(items ?? []).length} ítems
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-1">
              {items && items.length > 0 && costoPorItem.size === items.length
                ? "100% de ítems con costo"
                : "Se requiere calibrar insumos faltantes"}
            </div>
          </div>
        </div>
      </section>

      {/* Lotes */}
      {(lotes ?? []).length > 0 ? (
        <section>
          <h2 className="text-[14px] font-semibold mb-2">Lotes ({lotes!.length})</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead><tr><th>N°</th><th>Título</th><th className="num">Referencial</th></tr></thead>
              <tbody>
                {lotes!.map((l) => (
                  <tr key={l.id}>
                    <td>{l.numero ?? "—"}</td>
                    <td>{l.titulo ?? "—"}</td>
                    <td className="num">{l.monto_referencial ? formatMoney(l.monto_referencial, moneda) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Planilla de ítems */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Planilla de ítems ({(items ?? []).length})</h2>
          {hayCatalogo && costoPorItem.size > 0 ? (
            <span className="text-[11px] text-[var(--muted)]">
              {costoPorItem.size} ítem{costoPorItem.size !== 1 ? "s" : ""} con costo sugerido de tu catálogo
            </span>
          ) : null}
        </div>
        {(items ?? []).length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-8 text-center text-[13px] text-[var(--muted)]">
            La DNCP no trajo planilla itemizada para esta licitación.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th className="num">Cantidad</th>
                  <th>Unidad</th>
                  <th className="num">P. unit. referencial</th>
                  {hayCatalogo ? <th className="num">Costo Promedio (Inventario)</th> : null}
                  {(lotes ?? []).length > 0 ? <th>Lote</th> : null}
                </tr>
              </thead>
              <tbody>
                {items!.map((it) => {
                  const c = costoPorItem.get(it.id);
                  return (
                    <tr key={it.id}>
                      <td>
                        {it.descripcion}
                        {it.codigo_catalogo ? (
                          <span className="ml-1.5 mono text-[10px] text-[var(--muted)]">{it.codigo_catalogo}</span>
                        ) : null}
                      </td>
                      <td className="num">{it.cantidad ?? "—"}</td>
                      <td>{it.unidad ?? "—"}</td>
                      <td className="num">
                        {it.precio_unitario_referencial ? formatMoney(it.precio_unitario_referencial, moneda) : "—"}
                      </td>
                      {hayCatalogo ? (
                        <td className="num">
                          {c ? (
                            <div className="flex flex-col items-end">
                              <span title={`${c.nombre} · similitud ${(c.score * 100).toFixed(0)}%`}>
                                {formatMoney(c.costoPromedioInventario, moneda)}
                              </span>
                              <span className={`text-[9px] px-1 rounded ${
                                c.confidence === 'MATCH_AUTOMATICO'
                                  ? 'bg-[var(--ok-bg)] text-[var(--ok)] font-medium'
                                  : 'bg-[var(--panel-2)] text-[var(--muted)]'
                              }`}>
                                {c.confidence === 'MATCH_AUTOMATICO' ? 'Exacto' : `${(c.score * 100).toFixed(0)}%`}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                      ) : null}
                      {(lotes ?? []).length > 0 ? (
                        <td className="text-[12px] text-[var(--muted)]">
                          {it.lote_id ? loteById.get(it.lote_id)?.numero ?? "—" : "—"}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Oferentes */}
      {(oferentes ?? []).length > 0 ? (
        <section>
          <h2 className="text-[14px] font-semibold mb-2">Oferentes ({oferentes!.length})</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead>
                <tr><th>Empresa</th><th>RUC</th><th>Tamaño</th><th className="num">Ofertó</th><th>Resultado</th><th>Fuente</th></tr>
              </thead>
              <tbody>
                {oferentes!.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">{o.nombre}</td>
                    <td className="mono text-[12px] text-[var(--muted)]">{o.ruc ?? "—"}</td>
                    <td className="text-[12px] text-[var(--muted)]">{o.tamano ?? "—"}</td>
                    <td className="num">{o.monto_ofertado ? formatMoney(o.monto_ofertado, moneda) : "—"}</td>
                    <td>
                      {o.gano ? (
                        <span className="text-[12px] text-[var(--ok)] font-medium">Ganó</span>
                      ) : (
                        <span className="text-[12px] text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="text-[11px] text-[var(--muted)]">{o.fuente}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            Los montos de los oferentes que no ganaron salen del Acta de Apertura (parser pendiente).
          </p>
        </section>
      ) : null}

      {/* Documentos */}
      {(docs ?? []).length > 0 ? (
        <section>
          <h2 className="text-[14px] font-semibold mb-2">Documentos ({docs!.length})</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)]">
            {docs!.map((d) => (
              <div key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] truncate">{d.tipo_detalle ?? d.tipo ?? "Documento"}</div>
                  {d.titulo ? <div className="text-[11px] text-[var(--muted)] truncate">{d.titulo}</div> : null}
                </div>
                {d.url_dncp ? (
                  <a
                    href={d.url_dncp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-action shrink-0"
                  >
                    Abrir en DNCP ↗
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="text-[11px] text-[var(--muted)]">
        <Link href={`https://www.contrataciones.gov.py/licitaciones/convocatoria/${lic.dncp_nro}`} target="_blank" className="text-action">
          Ver la licitación completa en el portal de la DNCP ↗
        </Link>
      </p>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="text-[13px] font-medium mt-0.5">{valor}</div>
    </div>
  );
}
