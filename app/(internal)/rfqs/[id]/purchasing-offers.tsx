"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Check } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";
import { eligibleLine, validateAllocation, type AllocationLine, type ComparativeLine, type OrderPreview, type RfqAllocation, type RfqItem } from "@/lib/rfq/domain";
import type { QuoteDocumentAnalysisResult } from "@/lib/rfq/document-analysis";
import { authorizeAllocationAction, confirmOrdersAction, extractQuoteDocumentAction, openQuoteAttachmentAction, previewOrdersAction, reviewQuoteAction, saveAllocationAction } from "./workflow-actions";
import styles from "./procurement-panel.module.css";
import { reviewDifferences, reviewKey, type ReviewDecision } from "@/lib/rfq/quote-review";

type Version = { id: string; budgetNumber: string; total: number; invoiceAvailable: boolean };
type SavedOrder = { id: string; code: string; provider_name: string; total_price: number; currency: CurrencyCode };
type OfferGroup = { id: string; offer: ComparativeLine; lines: ComparativeLine[]; version?: Version };
const money = (value: number, currency: string) => formatMoney(value, currency as CurrencyCode);
const quantity = (value: number) => Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 4).replace(/0+$/, "").replace(/,$/, "");
const payment = (value: string | null) => value && /^\d+$/.test(value.trim()) ? `Crédito a ${value.trim()} días` : value || "Sin informar";
const reasons = ["Precio conveniente", "Entrega a tiempo", "Disponibilidad confirmada"];
const fieldNames: Record<string, string> = { precio_unitario: "Precio unitario", currency: "Moneda", tax_rate: "IVA", vat_included: "IVA incluido", available_quantity: "Disponibilidad", lead_time_days: "Entrega", freight: "Flete", payment_terms: "Pago", valid_until: "Vigencia" };

function groupOffers(offers: ComparativeLine[], versions: Version[]): OfferGroup[] {
  return [...new Set(offers.map(o => o.quote_version_id))].map(id => {
    const lines = offers.filter(o => o.quote_version_id === id);
    return { id, offer: lines[0], lines, version: versions.find(v => v.id === id) };
  });
}


function BudgetButton({ attachmentId }: { attachmentId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  return <div>
    {url ? <a className={buttonClassName({ variant: "secondary", size: "sm" })} href={url} target="_blank" rel="noopener noreferrer"><FileText size={14} aria-hidden="true" /> Abrir presupuesto</a>
      : <Button variant="secondary" size="sm" disabled={busy || !attachmentId} onClick={async () => {
        if (!attachmentId) return;
        setBusy(true); setError("");
        try {
          const result = await openQuoteAttachmentAction(attachmentId);
          if (result.error) setError(result.error);
          else if (result.data) { setUrl(result.data); window.open(result.data, "_blank", "noopener,noreferrer"); }
        } catch { setError("No se pudo abrir el presupuesto."); }
        finally { setBusy(false); }
      }}><FileText size={14} aria-hidden="true" />{busy ? "Abriendo…" : "Ver presupuesto"}</Button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function PurchasingOffers({ rfqId, items, offers, analyses: initialAnalyses, allocations, versions, orders }: {
  rfqId: string; items: RfqItem[]; offers: ComparativeLine[]; analyses: Record<string, QuoteDocumentAnalysisResult>;
  allocations: RfqAllocation[]; versions: Version[]; orders: SavedOrder[];
}) {
  const router = useRouter();
  const lock = useRef(false);
  const [now] = useState(() => Date.now());
  const groups = groupOffers(offers, versions);
  const [sort, setSort] = useState<"price" | "delivery" | "availability">("price");
  const coversRequest = (g: OfferGroup) => items.every(i => g.lines.some(o => o.rfq_item_id === i.id && o.available_quantity >= i.cantidad && eligibleLine(o, now, false)));
  const usableOffer = (g: OfferGroup) => g.lines.some(o => eligibleLine(o, now, false));
  const deliveryDays = (g: OfferGroup) => Math.max(...g.lines.filter(o => eligibleLine(o, now, false)).map(o => o.lead_time_days), 0);
  const coverage = (g: OfferGroup) => items.reduce((sum, i) => sum + Math.min(1, Math.max(0, g.lines.find(o => o.rfq_item_id === i.id && eligibleLine(o, now, false))?.available_quantity ?? 0) / (i.cantidad || 1)), 0);
  const rankedGroups = [...groups].sort((a, b) => {
    const usableDifference = Number(usableOffer(b)) - Number(usableOffer(a));
    if (usableDifference) return usableDifference;
    if (sort === "delivery" && deliveryDays(a) !== deliveryDays(b)) return deliveryDays(a) - deliveryDays(b);
    if (sort === "availability" && coverage(a) !== coverage(b)) return coverage(b) - coverage(a);
    // Price rankings stay within a currency and compare full coverage first.
    const currencyDifference = a.offer.currency.localeCompare(b.offer.currency);
    if (currencyDifference) return currencyDifference;
    const fullDifference = Number(coversRequest(b)) - Number(coversRequest(a));
    if (fullDifference) return fullDifference;
    if (a.version && b.version && a.version.total !== b.version.total) return a.version.total - b.version.total;
    if (!!a.version !== !!b.version) return a.version ? -1 : 1;
    return a.offer.provider_name.localeCompare(b.offer.provider_name);
  });
  const [allocation, setAllocation] = useState<RfqAllocation | null>(allocations[0] ?? null);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries((allocations[0]?.lines ?? []).map(l => [String(l.quote_version_item_id), String(l.quantity)])));
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [reviewIds, setReviewIds] = useState<Record<string, string>>(() => Object.fromEntries(offers.filter(o => o.review_id).map(o => [o.quote_version_id, o.review_id!])));
  const [resolutions, setResolutions] = useState<Record<string, Record<string, ReviewDecision["decision"]>>>({});
  const [reason, setReason] = useState(allocations[0]?.justification ?? "");
  const [otherReason, setOtherReason] = useState(false);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"choose" | "authorize" | "preview">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const lines: AllocationLine[] = Object.entries(quantities).filter(([, q]) => q.trim() !== "" && Number(q) !== 0).map(([id, q]) => ({ quote_version_item_id: id, quantity: Number(q) }));
  const selected = rankedGroups.filter(g => g.lines.some(o => lines.some(l => l.quote_version_item_id === o.id)));
  const pending = selected.filter(g => !reviewIds[g.id]);
  const reviewReady = (g: OfferGroup) => {
    const data = analyses[g.id]?.data;
    return !!data && reviewDifferences(g.lines, data.facts).every(d => resolutions[g.id]?.[reviewKey(d)] === "verified_original");
  };
  const currentOffers = offers.map(o => ({ ...o, review_id: reviewIds[o.quote_version_id] || o.review_id }));
  let selectionError = "";
  let remaining: ReturnType<typeof validateAllocation> = [];
  if (lines.some(l => {
    const offer = offers.find(o => o.id === l.quote_version_item_id);
    return !Number.isFinite(l.quantity) || l.quantity <= 0 || !offer || l.quantity > offer.available_quantity || !eligibleLine(offer, now, false);
  })) selectionError = "Revisá las cantidades y la disponibilidad de las ofertas elegidas.";
  else if (items.some(item => Math.round(offers.filter(o => o.rfq_item_id === item.id).reduce((sum, o) => sum + (Number(quantities[o.id]) || 0), 0) * 10000) > Math.round(item.cantidad * 10000))) selectionError = "Las cantidades asignadas superan lo solicitado. Reducilas antes de continuar.";
  if (!selectionError && lines.length && !pending.length) {
    try { remaining = validateAllocation(lines, items, currentOffers, now); }
    catch (e) { selectionError = e instanceof Error ? e.message : "Revisá las cantidades elegidas."; }
  }
  const completed = !!allocation?.confirmed_at || createdIds.length > 0 || orders.length > 0;

  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await task(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la operación."); }
    finally { lock.current = false; setBusy(false); }
  }

  function choose(group: OfferGroup) {
    const next = Object.fromEntries(group.lines.filter(o => eligibleLine(o, Date.now(), false)).map(o => [o.id, String(Math.min(o.available_quantity, items.find(i => i.id === o.rfq_item_id)?.cantidad ?? 0))]));
    setQuantities(next); setReason(""); setOtherReason(false); setResolutions({});
    setPreview(null); setError(""); setStage("choose"); setOpen(true);
  }

  function groupTotal(group: OfferGroup) {
    // The stored quote is canonical for the default quantities. Edited quantities
    // are estimates only; final amounts always come from rfq_preview_orders.
    const complete = group.lines.every(o => Number(quantities[o.id] ?? 0) === Math.min(o.available_quantity, items.find(i => i.id === o.rfq_item_id)?.cantidad ?? 0));
    if (complete && group.version) return group.version.total;
    return group.lines.reduce((sum, o) => sum + Number(quantities[o.id] || 0) * (o.precio_unitario ?? 0) * (o.vat_included ? 1 : 1 + o.tax_rate / 100), group.offer.freight ?? 0);
  }

  async function loadPreview(id: string) {
    const result = await previewOrdersAction(id);
    if (result.error || !result.data) throw new Error(result.error || "No se pudo preparar la orden.");
    setPreview(result.data); setStage("preview");
  }

  return <section aria-label="Ofertas y adjudicación" className="space-y-5">
    {completed ? <div className={styles.purchaseStatus}>
      <div><h2><Check size={18} className="inline mr-2" aria-hidden="true" />Compra adjudicada</h2><p className={styles.muted}>La orden de compra ya fue emitida.</p></div>
      <div className={styles.actions}>
        {orders.map(o => <Link key={o.id} href={`/orders/${o.id}`} className={buttonClassName()}>Ver {o.code}</Link>)}
        {!orders.length && createdIds.map((id, index) => <Link key={id} href={`/orders/${id}`} className={buttonClassName()}>Ver orden de compra{createdIds.length > 1 ? ` ${index + 1}` : ""}</Link>)}
      </div>
    </div> : allocation && <div className={styles.purchaseStatus}>
      <div><strong>{allocation.authorized_at ? "Compra autorizada" : "Proveedor seleccionado"}</strong><p className={styles.muted}>{allocation.authorized_at ? "Revisá la orden antes de emitirla." : "Falta autorizar y emitir la orden."}</p></div>
      <Button onClick={() => { setOpen(true); setError(""); if (allocation.authorized_at) void run(() => loadPreview(allocation.id)); else setStage("authorize"); }}>Continuar compra</Button>
    </div>}
    <div className={styles.offerToolbar}><div><h2>Ofertas recibidas</h2><span className={styles.muted}>{groups.length} proveedor{groups.length === 1 ? "" : "es"}</span></div>
      {groups.length > 1 && <label className={styles.sortControl}>Ordenar por<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="price">Menor total</option><option value="delivery">Menor plazo de entrega</option><option value="availability">Mayor disponibilidad</option></select></label>}
    </div>
    {new Set(groups.map(g => g.offer.currency)).size > 1 && <p className={styles.muted}>Los totales se comparan dentro de cada moneda.</p>}
    {!groups.length && <p className={styles.muted}>Todavía no recibiste ofertas.</p>}
    {groups.length > 0 && <div className={styles.offerTableWrap}><table className={styles.offerTable}>
      <caption className="sr-only">Ofertas ordenadas por {sort === "price" ? "menor total dentro de cada moneda, con cobertura completa primero" : sort === "delivery" ? "menor plazo de entrega" : "mayor cobertura de lo solicitado"}</caption>
      <thead><tr><th scope="col">Proveedor</th><th scope="col">Total con IVA y flete</th><th scope="col">Entrega</th><th scope="col">Disponible</th><th scope="col">Pago</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
      <tbody>{rankedGroups.map((g, index) => {
        const first = g.offer;
        const lead = [...new Set(g.lines.filter(o => o.available_quantity > 0).map(o => o.lead_time_days))];
        const full = coversRequest(g);
        const usable = usableOffer(g);
        const documentAnalysis = analyses[g.id]?.data;
        const documentDifferences = documentAnalysis ? reviewDifferences(g.lines, documentAnalysis.facts) : [];
        const mismatches = documentDifferences.filter(d => d.document != null).length;
        const peers = groups.filter(p => p.offer.currency === first.currency && coversRequest(p));
        const lowest = full && usable && peers.length > 1 && g.version && peers.every(p => p.version && g.version!.total <= p.version.total);
        return <tr key={g.id}>
          <th scope="row"><div className={styles.providerCell}><span className={styles.offerRank} aria-hidden="true">{index + 1}</span><div><strong>{first.provider_name}</strong>{lowest && <span className={styles.lowestLabel}>Menor total</span>}
          <details className={styles.rowDetail}><summary>Ver detalle</summary><div className="space-y-2 mt-3">
            {g.lines.map(o => <p key={o.id}>{items.find(i => i.id === o.rfq_item_id)?.descripcion} · {o.precio_unitario == null ? "Sin cotizar" : money(o.precio_unitario, o.currency)} · {quantity(o.available_quantity)} {items.find(i => i.id === o.rfq_item_id)?.unidad} disponibles · {o.lead_time_days} días</p>)}
            <p>Válida hasta {formatDate(first.valid_until)} · {g.version?.invoiceAvailable ? "Con factura" : "Sin factura"}</p>
            {g.version?.budgetNumber && <p>Presupuesto {g.version.budgetNumber}</p>}{first.observations && <p>{first.observations}</p>}
            <p>{first.vat_included ? "IVA incluido" : "IVA adicional incluido en el total"} · Flete {money(first.freight ?? 0, first.currency)}</p>
          </div></details></div></div>
          {!completed && !reviewIds[g.id] && <p className={styles.rowWarning}>{!documentAnalysis ? "Documento sin analizar" : mismatches ? `${mismatches} diferencia${mismatches > 1 ? "s" : ""} con el presupuesto` : documentDifferences.length ? "Datos del documento por verificar" : "Documento y oferta coinciden"}</p>}
          {!usable && !completed && <p className={styles.rowWarning}>{first.revoked ? "Oferta revocada" : first.valid_until && Date.parse(first.valid_until) <= now ? "Oferta vencida" : "Oferta incompleta o sin disponibilidad"}</p>}</th>
          <td><strong className={styles.rowTotal}>{g.version ? money(g.version.total, first.currency) : "Sin importe"}</strong>
            {items.length === 1 && <small className={styles.rowSecondary}>{g.lines[0].precio_unitario == null ? "Sin cotizar" : `${money(g.lines[0].precio_unitario, first.currency)} / ${items[0].unidad}`}</small>}
            {!full && <small className={styles.rowWarning}>Cobertura parcial</small>}
          </td>
          <td>{lead.length === 1 ? lead[0] === 0 ? "Inmediata" : `${lead[0]} días` : "Según ítem"}</td>
          <td>{items.length === 1 ? `${quantity(g.lines[0].available_quantity)} ${items[0].unidad}` : full ? "Todo lo solicitado" : "Parcial"}</td>
          <td>{payment(first.payment_terms)}</td>
          <td><div className={styles.rowActions}><BudgetButton attachmentId={first.attachment_id} />{!completed && <Button size="sm" disabled={!usable} onClick={() => choose(g)}>Adjudicar<span className="sr-only"> a {first.provider_name}</span></Button>}</div></td>
        </tr>;
      })}</tbody>
    </table></div>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent title={stage === "choose" ? "Adjudicar compra" : stage === "authorize" ? "Autorizar compra" : "Confirmar orden de compra"} className={`${styles.dialog} max-w-2xl`}>
        <div className={styles.dialogBody}>
        {stage !== "preview" && selected.map(g => <div className={styles.selectionSummary} key={g.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3>{g.offer.provider_name}</h3><strong>Estimado: {money(groupTotal(g), g.offer.currency)}</strong></div>
          <ul>{g.lines.filter(o => quantities[o.id] && Number(quantities[o.id]) > 0).map(o => <li key={o.id}><span>{quantity(Number(quantities[o.id]))} {items.find(i => i.id === o.rfq_item_id)?.unidad} de {items.find(i => i.id === o.rfq_item_id)?.descripcion}</span><span>{money(o.precio_unitario ?? 0, o.currency)} / {items.find(i => i.id === o.rfq_item_id)?.unidad}</span></li>)}</ul>
          <p className={`${styles.muted} mt-3`}>Pago: {payment(g.offer.payment_terms)} · Flete: {money(g.offer.freight ?? 0, g.offer.currency)}</p>
        </div>)}
        {stage === "choose" && <>
          <fieldset className={styles.quantitySection}><legend>Cantidad a comprar</legend>
            {items.map(item => {
              const assigned = offers.filter(o => o.rfq_item_id === item.id).reduce((sum, o) => sum + (Number(quantities[o.id]) || 0), 0);
              return <p key={item.id} className={assigned > item.cantidad ? styles.businessNotice : styles.muted} role={assigned > item.cantidad ? "alert" : undefined}>{item.descripcion}: {quantity(assigned)} de {quantity(item.cantidad)} {item.unidad} asignados.{assigned > item.cantidad ? " Reducí las cantidades: superan lo solicitado." : ""}</p>;
            })}
            {rankedGroups.flatMap(g => g.lines).map(o => <label key={o.id} className={styles.quantityRow}><span>{items.find(i => i.id === o.rfq_item_id)?.descripcion} · {o.provider_name}<small className="block">Disponible: {quantity(o.available_quantity)} {items.find(i => i.id === o.rfq_item_id)?.unidad}</small></span><Input aria-label={`Cantidad de ${items.find(i => i.id === o.rfq_item_id)?.descripcion} a ${o.provider_name}`} type="number" min="0" max={o.available_quantity} step="0.0001" value={quantities[o.id] || ""} onChange={e => setQuantities(q => ({ ...q, [o.id]: e.target.value }))} /></label>)}
          </fieldset>
          {pending.map(g => {
            const analysis = analyses[g.id];
            const differences = analysis?.data ? reviewDifferences(g.lines, analysis.data.facts) : [];
            return <div className={styles.reviewCompact} key={g.id}>
              <div className="flex flex-wrap justify-between items-center gap-3"><h3>Revisar presupuesto{selected.length > 1 ? ` · ${g.offer.provider_name}` : ""}</h3><BudgetButton attachmentId={g.offer.attachment_id} /></div>
              {!analysis?.data ? <div className={styles.businessNotice}><p>No se pudo analizar este presupuesto.</p><Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => {
                const result = await extractQuoteDocumentAction(rfqId, g.id);
                if (result.error || !result.data) throw new Error(result.error || "No se pudo leer el documento.");
                setAnalyses(a => ({ ...a, [g.id]: { error: null, data: result.data } }));
                setResolutions(r => ({ ...r, [g.id]: {} }));
              })}>Reintentar análisis</Button></div> : differences.length > 0 ? <>
                <p className={styles.muted}>Compará con el original. Si la oferta o el adjunto están mal, el proveedor debe enviar una versión corregida.</p>
                <div className={styles.reconciliationWrap}><table className={styles.reconciliationTable}>
                  <caption>Diferencias y datos que no se pudieron comprobar</caption>
                  <thead><tr><th>Dato</th><th>Portal</th><th>Documento</th><th>Resolución</th></tr></thead>
                  <tbody>{differences.map(d => {
                    const key = reviewKey(d);
                    const display = (value: unknown) => value == null ? "No verificable" : typeof value === "boolean" ? (value ? "Incluido" : "Adicional") : typeof value === "number" && (d.field === "precio_unitario" || d.field === "freight") ? money(value, g.offer.currency) : d.field === "valid_until" ? formatDate(String(value)) : String(value);
                    return <tr key={key}>
                      <th scope="row">{items.find(i => i.id === d.itemId)?.descripcion}<small>{fieldNames[d.field] || d.field}</small></th>
                      <td>{display(d.structured)}</td><td>{display(d.document)}</td>
                      <td><select aria-label={`Resolución ${fieldNames[d.field] || d.field} de ${items.find(i => i.id === d.itemId)?.descripcion} — ${g.offer.provider_name}`} className={styles.reviewSelect} value={resolutions[g.id]?.[key] || ""} onChange={e => setResolutions(r => ({ ...r, [g.id]: { ...r[g.id], [key]: e.target.value as ReviewDecision["decision"] } }))}>
                        <option value="">Elegí una resolución</option>
                        <option value="verified_original">Verifiqué el original: el portal es correcto</option>
                        <option value="request_correction">El proveedor debe corregir la oferta o el adjunto</option>
                      </select></td>
                    </tr>;
                  })}</tbody>
                </table></div>
                {differences.some(d => resolutions[g.id]?.[reviewKey(d)] === "request_correction") && <p className={styles.businessNotice} role="alert">Adjudicación bloqueada. Pedile al proveedor una versión corregida desde su enlace de cotización. No se cambian precios ni condiciones automáticamente.</p>}
              </> : <p className={`${styles.muted} mt-2`}>Los datos comprobados coinciden con la oferta.</p>}
            </div>;
          })}
          {!pending.length && selected.length > 0 && <p className={`${styles.success} my-4`}>✓ Presupuesto revisado</p>}
          {selected.length > 0 && <fieldset className="space-y-3 mt-5"><legend className="font-medium mb-3">Motivo de elección</legend><div className={styles.reasonOptions}>
            {reasons.map(text => <label key={text}><input type="radio" name="purchase-reason" checked={!otherReason && reason === text} onChange={() => { setOtherReason(false); setReason(text); }} />{text}</label>)}
            <label><input type="radio" name="purchase-reason" checked={otherReason} onChange={() => { setOtherReason(true); setReason(""); }} />Otro motivo</label>
          </div>{otherReason && <Textarea aria-label="Motivo de elección" value={reason} placeholder="Contá brevemente por qué elegís esta oferta" onChange={e => setReason(e.target.value)} />}</fieldset>}
          {selectionError && <p className={styles.businessNotice} role="alert">{selectionError}</p>}
          {remaining.filter(r => r.unallocated > 0).map(r => <p className={styles.businessNotice} key={r.itemId}>Compra parcial: quedan {quantity(r.unallocated)} {items.find(i => i.id === r.itemId)?.unidad} de {items.find(i => i.id === r.itemId)?.descripcion} sin comprar.</p>)}
        </>}
        {stage === "authorize" && <p className={styles.muted}>Motivo: {allocation?.justification}</p>}
        {stage === "preview" && preview?.orders.map(o => <div key={`${o.provider_id}:${o.currency}`} className={styles.selectionSummary}>
          <h3>{o.provider_name}</h3><ul>{o.items.map(i => <li key={i.quote_version_item_id}><span>{quantity(i.quantity)} {i.unit} de {i.product}<small className={`${styles.muted} block`}>{money(i.unit_price, o.currency)} / {i.unit}</small></span><span>{money(i.total, o.currency)}</span></li>)}</ul>
          <dl className={`${styles.facts} my-4`}><div><dt>Entrega</dt><dd>{o.items.map(i => `${o.items.length > 1 ? `${i.product}: ` : ""}${i.lead_time_days} días · ${formatDate(i.expected_delivery_date)}`).join(" · ")}</dd></div><div><dt>Pago</dt><dd>{payment(o.payment_terms)}</dd></div></dl>
          <p className={styles.muted}>IVA {money(o.tax_total, o.currency)} {o.vat_included ? "incluido" : "adicional"} · Flete {money(o.freight, o.currency)}</p>
          <div className="flex justify-between items-center mt-3"><strong>Total de la orden</strong><strong className="text-2xl">{money(o.total, o.currency)}</strong></div>
        </div>)}
        {stage === "preview" && <p className={styles.muted}>Revisá los importes y condiciones. La orden se emite únicamente al pulsar «Emitir OC».</p>}
        {error && <p className={styles.businessNotice} role="alert">{error}</p>}
        </div>
        <div className={styles.modalFooter}>
          {stage === "choose" && <p className={styles.footerHelp} aria-live="polite">{pending.some(g => !analyses[g.id]?.data) ? "Reintentá el análisis del presupuesto antes de continuar." : pending.some(g => !reviewReady(g)) ? "Elegí el resultado de la revisión del presupuesto." : reason.trim().length < 10 ? "Elegí el motivo de adjudicación." : "Al continuar autorizás esta selección. Todavía no se emite la OC."}</p>}
          <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cerrar</Button>
          {stage === "choose" && <Button disabled={busy || !lines.length || !!selectionError || reason.trim().length < 10 || pending.some(g => !reviewReady(g))} onClick={() => void run(async () => {
            const ids = { ...reviewIds };
            for (const g of pending) {
              const data = analyses[g.id]?.data;
              if (!data) throw new Error("Revisá cada presupuesto elegido.");
              const decisions = reviewDifferences(g.lines, data.facts).map(d => ({
                itemId: d.itemId, field: d.field, structured: d.structured, document: d.document,
                decision: resolutions[g.id]?.[reviewKey(d)],
              }));
              if (decisions.some(d => d.decision !== "verified_original")) throw new Error("Resolve cada diferencia antes de adjudicar.");
              const result = await reviewQuoteAction(rfqId, g.id, data.facts, "Revision de cada diferencia contra el original", decisions as ReviewDecision[]);
              if (result.error || !result.data) throw new Error(result.error || "No se pudo registrar la revisión.");
              ids[g.id] = result.data; setReviewIds({ ...ids });
            }
            validateAllocation(lines, items, offers.map(o => ({ ...o, review_id: ids[o.quote_version_id] || o.review_id })));
            const result = await saveAllocationAction(rfqId, lines, reason, allocation?.revision ?? 0);
            if (result.error || !result.data) throw new Error(result.error || "No se pudo guardar la selección.");
            setAllocation({ ...result.data, justification: reason, lines: lines.map(l => ({ ...l })), authorized_at: null, confirmed_at: null });
            const authorization = await authorizeAllocationAction(result.data.id, true);
            if (authorization.error) { setStage("authorize"); throw new Error(authorization.error); }
            setAllocation(a => a ? { ...a, authorized_at: new Date().toISOString() } : a);
            setStage("authorize");
            await loadPreview(result.data.id);
          })}>{busy ? "Preparando…" : "Adjudicar y revisar OC"}</Button>}
          {stage === "authorize" && allocation && <Button disabled={busy} onClick={() => void run(async () => {
            if (!allocation.authorized_at) {
              const result = await authorizeAllocationAction(allocation.id, true);
              if (result.error) throw new Error(result.error);
              setAllocation(a => a ? { ...a, authorized_at: new Date().toISOString() } : a);
            }
            await loadPreview(allocation.id);
          })}>{busy ? "Preparando…" : allocation.authorized_at ? "Revisar orden" : "Autorizar y revisar orden"}</Button>}
          {stage === "preview" && preview && <Button disabled={busy} onClick={() => void run(async () => {
            const result = await confirmOrdersAction(preview.allocationId, preview.hash, true);
            if (result.error || !result.data) throw new Error(result.error || "No se pudo emitir la orden.");
            setCreatedIds(result.data.orderIds); setOpen(false); setPreview(null); router.refresh();
          })}>{busy ? "Emitiendo…" : preview.orders.length === 1 ? "Emitir OC" : `Emitir ${preview.orders.length} OCs`}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
