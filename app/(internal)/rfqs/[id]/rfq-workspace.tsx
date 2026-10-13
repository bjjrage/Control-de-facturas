"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  eligibleLine,
  proposeAllocations,
  validateAllocation,
  type AllocationLine,
  type ComparativeLine,
  type DocumentFact,
  type OrderPreview,
  type RfqAllocation,
  type RfqItem,
  type RfqPurpose,
} from "@/lib/rfq/domain";
import {
  authorizeAllocationAction,
  confirmOrdersAction,
  extractQuoteDocumentAction,
  previewOrdersAction,
  reviewQuoteAction,
  saveAllocationAction,
} from "./workflow-actions";
import { setProjectCostPriceAction } from "@/app/(internal)/projects/[id]/costeo-actions";
import type { QuoteDocumentAnalysisResult } from "@/lib/rfq/document-analysis";
import styles from "./procurement-panel.module.css";
import { WorkflowJump } from "./workflow-jump";

export function RfqWorkspace({
  rfqId,
  purpose,
  projectId,
  items,
  offers,
  analyses,
  allocations,
  canAdopt,
  administrative = false,
}: {
  rfqId: string;
  purpose: RfqPurpose | null;
  projectId: string | null;
  items: RfqItem[];
  offers: ComparativeLine[];
  analyses: Record<string, QuoteDocumentAnalysisResult>;
  allocations: RfqAllocation[];
  canAdopt: boolean;
  administrative?: boolean;
}) {
  const router = useRouter();
  const latest = allocations[0];
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (latest?.lines ?? []).map((l) => [
        String(l.quote_version_item_id),
        String(l.quantity),
      ]),
    ),
  );
  const [justification, setJustification] = useState(
    latest?.justification ?? "",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [terms, setTerms] = useState<Record<string, number>>({});
  const [weights, setWeights] = useState({
    price: 0.4,
    lead: 0.3,
    availability: 0.3,
    terms: 0,
  });
  const proposalResult = useMemo(() => {
    try {
      return {
        scenarios: proposeAllocations(items, offers, {
          weights,
          termScores: Object.keys(terms).length ? terms : undefined,
          preliminary: true,
        }),
        error: null,
      };
    } catch (e) {
      return {
        scenarios: [],
        error: e instanceof Error ? e.message : "Pesos inválidos",
      };
    }
  }, [items, offers, weights, terms]);
  const scenarios = proposalResult.scenarios;
  function applyProposal(proposalLines: AllocationLine[]) {
    setQuantities(Object.fromEntries(proposalLines.map(l => [l.quote_version_item_id, String(l.quantity)])));
    setPreview(null);
    setAuthorizationConfirmed(false);
    setOrderConfirmed(false);
  }
  const lines: AllocationLine[] = Object.entries(quantities)
    .filter(([, q]) => q.trim() !== "" && Number(q) !== 0)
    .map(([id, q]) => ({ quote_version_item_id: id, quantity: Number(q) }));
  const pendingReview = offers.find(o => !o.review_id && lines.some(l => l.quote_version_item_id === o.id))
    ?? (!lines.length && !offers.some(o => o.review_id) ? offers.find(o => !o.review_id) : undefined);
  let remaining: ReturnType<typeof validateAllocation> | null = null;
  let validation = "";
  try {
    if (lines.length) remaining = validateAllocation(lines, items, offers);
  } catch (e) {
    validation = e instanceof Error ? e.message : "Asignación inválida";
  }
  async function run(
    task: () => Promise<{ error: string | null }>,
    success: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const result = await task();
      setMessage(result.error ?? success);
      if (!result.error) router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-6">
      {!administrative && <>
      <h2 className="text-lg font-semibold">
        Comparativo — señales de mercado
      </h2>
      <p>
        Las cotizaciones no reemplazan la última compra efectiva. No se comparan
        monedas distintas sin un tipo de cambio verificado.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "Ítem",
                "Proveedor / versión",
                "Precio / moneda",
                "Impuesto",
                "Flete fijo",
                "Entrega",
                "Disponible",
                "Pago / vigencia",
                "Evidencia / revisión",
              ].map((x) => (
                <th key={x} className="p-2 text-left">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="p-2">
                  {items.find((i) => i.id === o.rfq_item_id)?.descripcion}
                </td>
                <td>
                  {o.provider_name} v{o.version_number}
                </td>
                <td>
                  {o.precio_unitario ?? "No cotizado"} {o.currency}
                </td>
                <td>
                  {o.tax_rate ?? "Sin dato"}%{" "}
                  {o.vat_included ? "incluido" : "adicional"}
                </td>
                <td>
                  {o.freight ?? "Sin dato"} {o.currency}
                </td>
                <td>{o.lead_time_days ?? "Sin dato"} días</td>
                <td>{o.available_quantity}</td>
                <td>
                  {o.payment_terms ?? "Sin dato"}
                  <br />
                  {o.observations}
                  <br />
                  {o.valid_until ? formatDateTime(o.valid_until) : "Sin vigencia verificable"}
                  {o.revoked && <strong> Revocada</strong>}
                </td>
                <td>
                  {o.attachment_id ? (
                    <DocumentEvidence attachmentId={o.attachment_id} />
                  ) : (
                    "Sin documento"
                  )}
                  <br />
                  {o.review_id
                    ? "Revisión humana registrada"
                    : "Pendiente de reconciliación"}
                  {o.review_discrepancies?.map((d, index) => (
                    <p key={index}>{d.field}: {d.reason}</p>
                  ))}
                  {o.review_resolution && <p>Resolución humana: {o.review_resolution}</p>}
                  {canAdopt &&
                    o.currency === "PYG" &&
                    eligibleLine(o, undefined, false) &&
                    projectId &&
                    items.find((i) => i.id === o.rfq_item_id)?.producto_id && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              setProjectCostPriceAction({
                                projectId,
                                productoId: items.find(
                                  (i) => i.id === o.rfq_item_id,
                                )!.producto_id!,
                                precio: 0,
                                fuente: "COTIZACION",
                                quoteVersionItemId: o.id,
                              }),
                            "Precio adoptado desde DB",
                          )
                        }
                      >
                        Adoptar precio para costeo
                      </Button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
      <section className={styles.section} aria-label="Revisión documental">
        <h2 className={styles.sectionTitle}><span className={styles.number}>1</span> Revisar presupuestos</h2>
        <p className={`${styles.muted} mb-4`}>Revisá el análisis y confirmá las discrepancias antes de adjudicar. La oferta y el documento original se conservan.</p>
      {[...new Set(offers.map((o) => o.quote_version_id))].map((version) => (
        <QuoteReview
          key={version}
          rfqId={rfqId}
          versionId={version}
          items={items}
          offers={offers.filter((o) => o.quote_version_id === version)}
          initialAnalysis={analyses[version]}
        />
      ))}
      </section>
      {purpose === null ? (
        <p>
          RFQ histórica con propósito sin definir. Sus datos y documentos se conservan.
          No se puede generar OC sin resolver explícitamente su propósito; no se infiere ni se modifica el histórico.
        </p>
      ) : purpose === "COST_DISCOVERY" ? (
        <div className="rounded border p-4">
          <h2>Descubrimiento de costos</h2>
          <p>
            La comparación y la adopción humana de precios cierran este
            circuito. No hay adjudicación ni generación de OCs.
          </p>
        </div>
      ) : (
        <>
          <details className={styles.section}>
          <summary className="font-semibold text-base">Propuestas del sistema y criterios de comparación</summary>
          <div className="space-y-4 mt-4">
          <p>
            Aplicar una propuesta solamente carga el editor. Guardar, autorizar
            y confirmar son decisiones humanas separadas.
          </p>
          <div className="flex flex-wrap gap-4">
            {Object.keys(weights).map((k) => (
              <label key={k}>
                {
                  (
                    {
                      price: "Peso precio",
                      lead: "Peso entrega",
                      availability: "Peso disponibilidad",
                      terms: "Peso condiciones",
                    } as Record<string, string>
                  )[k]
                }
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={weights[k as keyof typeof weights]}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setWeights((w) => ({
                      ...w,
                      [k]: Number.isFinite(value) && value >= 0 ? value : 0,
                    }));
                  }}
                />
              </label>
            ))}
          </div>
          <div className="space-y-2">
            {[...new Set(offers.map((o) => o.quote_version_id))].map((id) => (
              <label key={id} className="block">
                Puntaje humano de condiciones (0–1):{" "}
                {offers.find((o) => o.quote_version_id === id)?.provider_name}
                <Input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={terms[id] ?? ""}
                  onChange={(e) =>
                    setTerms((t) => {
                      const next = { ...t };
                      if (e.target.value.trim() === "") delete next[id];
                      else
                        next[id] = Math.max(
                          0,
                          Math.min(1, Number(e.target.value)),
                        );
                      return next;
                    })
                  }
                />
              </label>
            ))}
          </div>
          {proposalResult.error && <p role="alert">{proposalResult.error}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {scenarios.map((s, index) => (
              <div key={index} className={styles.proposal}>
                <strong>
                  {s.label} — {s.currency}
                </strong>
                <p>{s.warnings.join(" · ")}</p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    applyProposal(s.lines);
                  }}
                >
                  Usar como propuesta editable
                </Button>
              </div>
            ))}
          </div>
          </div>
          </details>
          <section id="adjudication" tabIndex={-1} className={`${styles.section} space-y-4`}>
          <h2 className={styles.sectionTitle}><span className={styles.number}>2</span> Adjudicar oferta</h2>
          <p className={styles.muted}>Elegí un proveedor para preparar la adjudicación o repartí las cantidades entre varios. Guardar este paso todavía no autoriza ni emite una OC.</p>
          {pendingReview && <div className={styles.notice}>
            <p className="mb-2">Falta registrar la revisión del presupuesto de {pendingReview.provider_name}. Por eso todavía no podés guardar la adjudicación.</p>
            <WorkflowJump targetId={`review-${pendingReview.quote_version_id}`}>Revisar presupuesto pendiente</WorkflowJump>
          </div>}
          {!latest?.confirmed_at && <div className={styles.actions}>
            {scenarios.filter(s => s.kind === "ONE_SUPPLIER").map((s, index) => <Button key={index} variant="secondary" disabled={busy} onClick={() => applyProposal(s.lines)}>
              Elegir {offers.find(o => o.id === s.lines[0]?.quote_version_item_id)?.provider_name ?? "proveedor"} · {s.currency}
            </Button>)}
          </div>}
          {offers.map((o) => (
            <label key={o.id} className="flex gap-3 items-center">
              {items.find((i) => i.id === o.rfq_item_id)?.descripcion} —{" "}
              {o.provider_name} ({o.currency})
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={quantities[o.id] ?? ""}
                aria-label={`Asignar ${o.provider_name} ${o.rfq_item_id}`}
                onChange={(e) => {
                  setQuantities((q) => ({ ...q, [o.id]: e.target.value }));
                  setPreview(null);
                  setAuthorizationConfirmed(false);
                }}
              />
            </label>
          ))}
          {remaining?.map((r) => (
            <p key={r.itemId}>
              Sin asignar: {items.find((i) => i.id === r.itemId)?.descripcion} —{" "}
              {r.unallocated}
            </p>
          ))}
          {validation && <p role="alert">{validation}</p>}
          <Label htmlFor={`allocation-reason-${rfqId}`}>Justificación de la adjudicación (mínimo 10 caracteres)</Label>
          <Textarea
            id={`allocation-reason-${rfqId}`}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            minLength={10}
          />
          <Button
            disabled={
              busy ||
              !!validation ||
              !lines.length ||
              justification.trim().length < 10 ||
              !!latest?.confirmed_at
            }
            onClick={() =>
              run(
                () =>
                  saveAllocationAction(
                    rfqId,
                    lines,
                    justification,
                    latest?.revision ?? 0,
                  ),
                "Asignación guardada; todavía no autorizada",
              )
            }
          >
            Guardar adjudicación
          </Button>
          {!latest?.confirmed_at && <p className={styles.muted}>{validation || (!lines.length ? "Elegí un proveedor o ingresá las cantidades a adjudicar." : justification.trim().length < 10 ? "Completá la justificación para habilitar Guardar adjudicación." : "La adjudicación está lista para guardar.")}</p>}
          </section>
          {latest && !latest.confirmed_at && (
            <div id="authorization" tabIndex={-1} className={`${styles.section} space-y-4`}>
              <h2 className={styles.sectionTitle}><span className={styles.number}>3</span> Autorizar adjudicación</h2>
              <p>
                Revisión guardada {latest.revision}. Las acciones siguientes
                operan sobre esa revisión guardada.
              </p>
              {!latest.authorized_at ? (
                <>
                  <label className="block">
                    <input
                      type="checkbox"
                      checked={authorizationConfirmed}
                      onChange={(e) =>
                        setAuthorizationConfirmed(e.target.checked)
                      }
                    />{" "}
                    Autorizo explícitamente la revisión guardada y su
                    justificación
                  </label>
                  <Button
                    disabled={busy || !authorizationConfirmed}
                    onClick={() =>
                      run(
                        () =>
                          authorizeAllocationAction(
                            latest.id,
                            authorizationConfirmed,
                          ),
                        "Asignación autorizada; ninguna OC creada",
                      )
                    }
                  >
                    Autorizar adjudicación
                  </Button>
                </>
              ) : (
                <>
                  <p>Autorización registrada: {latest.authorized_at}</p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await previewOrdersAction(latest.id);
                        if (result.data) {
                          setPreview(result.data);
                          setOrderConfirmed(false);
                        }
                        return result;
                      }, "Preview preparado; ninguna OC creada")
                    }
                  >
                    Revisar órdenes antes de emitir
                  </Button>
                </>
              )}
            </div>
          )}
          {preview && (
            <div className={`${styles.section} space-y-4`}>
              <h2 className={styles.sectionTitle}>
                <span className={styles.number}>4</span> Revisar y emitir — {preview.orders.length} OC(s)
              </h2>
              {preview.orders.map((o) => (
                <div
                  className="border p-3"
                  key={`${o.provider_id}:${o.currency}`}
                >
                  <h3>
                    {o.provider_name} — {o.currency}
                  </h3>
                  <p>
                    RFQ {o.rfq_id} · versión {o.quote_version_id}
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th>Ítem</th>
                        <th>Cantidad / unidad</th>
                        <th>Precio</th>
                        <th>Impuesto</th>
                        <th>Total</th>
                        <th>Entrega</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((i) => (
                        <tr key={i.quote_version_item_id}>
                          <td>
                            {i.product}
                            <br />
                            <small>
                              Versión/línea: {i.quote_version_id} /{" "}
                              {i.quote_version_item_id}
                            </small>
                          </td>
                          <td>
                            {i.quantity} {i.unit}
                          </td>
                          <td>
                            {i.unit_price} {o.currency}
                          </td>
                          <td>
                            {i.tax_rate}%{" "}
                            {o.vat_included ? "incluido" : "adicional"}
                          </td>
                          <td>{i.total}</td>
                          <td>
                            {i.lead_time_days} días · {i.expected_delivery_date}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    Flete fijo completo: {o.freight} {o.currency} · Impuesto
                    total: {o.tax_total} · Total OC: {o.total} {o.currency}
                  </p>
                  <p>Pago: {o.payment_terms}</p>
                </div>
              ))}
              <label className="block">
                <input
                  type="checkbox"
                  checked={orderConfirmed}
                  onChange={(e) => setOrderConfirmed(e.target.checked)}
                />{" "}
                Confirmo estas OCs exactas, sus cantidades, precios y
                condiciones
              </label>
              <Button
                disabled={busy || !orderConfirmed}
                onClick={() =>
                  run(async () => {
                    const r = await confirmOrdersAction(
                      preview.allocationId,
                      preview.hash,
                      orderConfirmed,
                    );
                    if (r.data) {
                      setPreview(null);
                      setMessage(`OCs creadas: ${r.data.orderIds.join(", ")}`);
                    }
                    return r;
                  }, "OCs confirmadas")
                }
              >
                Confirmar y emitir órdenes de compra
              </Button>
            </div>
          )}
          {latest?.confirmed_at && (
            <p>
              OCs confirmadas el {latest.confirmed_at}.{" "}
              <Link className="underline" href="/orders">
                Ver órdenes
              </Link>
            </p>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
function DocumentEvidence({ attachmentId }: { attachmentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  return url ? (
    <a className="underline" href={url} target="_blank" rel="noreferrer">
      Abrir documento original
    </a>
  ) : (
    <Button
      variant="secondary"
      onClick={async () => {
        const { openQuoteAttachmentAction } = await import(
          "./workflow-actions"
        );
        const r = await openQuoteAttachmentAction(attachmentId);
        if (r.data) setUrl(r.data);
      }}
    >
      Documento original
    </Button>
  );
}
function QuoteReview({
  rfqId,
  versionId,
  items,
  offers,
  initialAnalysis,
}: {
  rfqId: string;
  versionId: string;
  items: RfqItem[];
  offers: ComparativeLine[];
  initialAnalysis: QuoteDocumentAnalysisResult | undefined;
}) {
  const router = useRouter();
  const [extraction, setExtraction] =
    useState<Awaited<ReturnType<typeof extractQuoteDocumentAction>>["data"]>(
      initialAnalysis?.data ?? null,
    );
  const [facts, setFacts] = useState<DocumentFact[]>(initialAnalysis?.data?.facts ?? []);
  const [resolution, setResolution] = useState("");
  const [message, setMessage] = useState(initialAnalysis?.error ?? "");
  const [pending, setPending] = useState(false);
  return (
    <details id={`review-${versionId}`} tabIndex={-1} className={`${styles.review} mb-3`}>
      <summary>
        {offers[0]?.review_id ? "✓ Presupuesto revisado" : "Revisar presupuesto"} · {offers[0]?.provider_name} · versión {offers[0]?.version_number}
      </summary>
      <div className={styles.reviewBody}>
      <p className={styles.muted}>
        El documento y la oferta se conservan. Diferencias o campos no extraídos
        requieren revisión humana; no se corrigen precios automáticamente.
      </p>
      {!extraction && <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const r = await extractQuoteDocumentAction(rfqId, versionId);
            if (r.data) {
              setExtraction(r.data);
              setFacts(r.data.facts);
            }
            setMessage(r.error ?? "Documento extraído; revisá las diferencias");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "No se pudo analizar el documento");
          } finally {
            setPending(false);
          }
        }}
      >
        Reintentar análisis del documento
      </Button>}
      {extraction && (
        <>
          <details>
          <summary className="text-sm font-medium">Ver contenido leído del documento original</summary>
          <pre className="whitespace-pre-wrap max-h-64 overflow-auto">
            {extraction.extraction.text ??
              extraction.extraction.structured?.sheets
                .map(
                  (s) =>
                    `${s.name}\n${s.rows
                      .map((row) =>
                        Object.entries(row)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(" · "),
                      )
                      .join("\n")}`,
                )
                .join("\n") ??
              "El lector no pudo extraer datos de este documento; requiere revisión del original"}
          </pre>
          </details>
          {extraction.extraction.warnings.length > 0 && <p className={styles.notice}>{extraction.extraction.warnings.join(" · ")}</p>}
          <div className={extraction.comparison.length ? styles.notice : styles.muted}>
          <h3 className="font-semibold mb-2">{extraction.comparison.length ? "Diferencias que necesitan tu revisión" : "Sin diferencias detectadas en los campos verificables"}</h3>
          {extraction.comparison.map((d, i) => (
            <p key={i}>
              {items.find((it) => it.id === d.itemId)?.descripcion}: {d.field} —
              oferta {String(d.structured ?? "desconocido")} / documento{" "}
              {String(d.document ?? "desconocido")} ({d.reason})
            </p>
          ))}
          {!extraction.facts.length && <p>No se identificaron datos de esta oferta en el documento. Revisá el original y justificá la falta de evidencia antes de continuar.</p>}
          </div>
          <details>
          <summary className="text-sm font-medium">Datos extraídos y excepciones verificables</summary>
          <p>
            Datos extraídos automáticamente. Revisá las diferencias y completá
            solamente las excepciones verificables en el original. Los campos
            vacíos conservan ausencia de evidencia:
          </p>
          {offers.map((o) => (
            <div key={o.id} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border border-white/10 rounded-lg p-4 mt-3">
              <p className="col-span-full font-medium">{items.find((i) => i.id === o.rfq_item_id)?.descripcion}</p>
              {(
                [
                  "precio_unitario",
                  "currency",
                  "tax_rate",
                  "available_quantity",
                  "lead_time_days",
                  "freight",
                  "payment_terms",
                  "valid_until",
                ] as const
              ).map((field) => (
                <label key={field}>
                  {
                    {
                      precio_unitario: "Precio documento",
                      currency: "Moneda documento",
                      tax_rate: "Impuesto documento %",
                      available_quantity: "Disponible documento",
                      lead_time_days: "Entrega documento días",
                      freight: "Flete documento",
                      payment_terms: "Pago documento",
                      valid_until: "Vigencia documento",
                    }[field]
                  }
                  <Input
                    value={
                      facts.find((f) => f.rfq_item_id === o.rfq_item_id)?.[
                        field
                      ] ?? ""
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setFacts((prev) => {
                        const old = prev.find(
                          (f) => f.rfq_item_id === o.rfq_item_id,
                        ) ?? { rfq_item_id: o.rfq_item_id };
                        return [
                          ...prev.filter(
                            (f) => f.rfq_item_id !== o.rfq_item_id,
                          ),
                          {
                            ...old,
                            [field]:
                              value === ""
                                ? undefined
                                : field === "currency"
                                  ? value.toUpperCase()
                                  : ["payment_terms", "valid_until"].includes(
                                        field,
                                      )
                                    ? value
                                    : Number(value),
                          },
                        ];
                      });
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
          </details>
          <Label htmlFor={`review-reason-${versionId}`}>
            Resolución de diferencias o falta de evidencia (mínimo 10 caracteres)
          </Label>
          <Textarea
            id={`review-reason-${versionId}`}
            placeholder="Dejá constancia de qué verificaste en el original y cómo resolvés las diferencias."
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
          <Button
            disabled={pending || resolution.trim().length < 10}
            onClick={async () => {
              setPending(true);
              try {
                const r = await reviewQuoteAction(
                  rfqId,
                  versionId,
                  facts,
                  resolution,
                );
                setMessage(
                  r.error ?? "Revisión registrada sin modificar la oferta",
                );
                if (!r.error) router.refresh();
              } catch (e) {
                setMessage(e instanceof Error ? e.message : "No se pudo registrar la revisión");
              } finally {
                setPending(false);
              }
            }}
          >
            Registrar revisión humana
          </Button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {offers[0]?.review_id && <WorkflowJump targetId="adjudication">Continuar a adjudicar</WorkflowJump>}
      </div>
    </details>
  );
}
