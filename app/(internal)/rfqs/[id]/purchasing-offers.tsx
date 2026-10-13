"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Check } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";
import { eligibleLine, validateAllocation, type AllocationLine, type ComparativeLine, type Discrepancy, type OrderPreview, type RfqAllocation, type RfqItem } from "@/lib/rfq/domain";
import type { QuoteDocumentAnalysisResult } from "@/lib/rfq/document-analysis";
import { authorizeAllocationAction, confirmOrdersAction, extractQuoteDocumentAction, openQuoteAttachmentAction, previewOrdersAction, reviewQuoteAction, saveAllocationAction } from "./workflow-actions";
import styles from "./procurement-panel.module.css";

type Version = { id: string; budgetNumber: string; total: number; invoiceAvailable: boolean };
type SavedOrder = { id: string; code: string; provider_name: string; total_price: number; currency: CurrencyCode };
type OfferGroup = { id: string; offer: ComparativeLine; lines: ComparativeLine[]; version?: Version };
const money = (value: number, currency: string) => formatMoney(value, currency as CurrencyCode);
const quantity = (value: number) => Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 4).replace(/0+$/, "").replace(/,$/, "");
const payment = (value: string | null) => value && /^\d+$/.test(value.trim()) ? `Crédito a ${value.trim()} días` : value || "Sin informar";
const reasons = ["Precio conveniente", "Entrega a tiempo", "Disponibilidad confirmada"];
const fieldNames: Record<string, string> = { precio_unitario: "Precio unitario", currency: "Moneda", tax_rate: "IVA", available_quantity: "Disponibilidad", lead_time_days: "Entrega", freight: "Flete", payment_terms: "Pago", valid_until: "Vigencia" };

function groupOffers(offers: ComparativeLine[], versions: Version[]): OfferGroup[] {
  return [...new Set(offers.map(o => o.quote_version_id))].map(id => {
    const lines = offers.filter(o => o.quote_version_id === id);
    return { id, offer: lines[0], lines, version: versions.find(v => v.id === id) };
  });
}

function differenceText(d: Discrepancy, items: RfqItem[], currency: string) {
  const item = items.find(i => i.id === d.itemId)?.descripcion || "Ítem";
  if (d.field === "document") return `${item}: el documento no permite comprobar esta oferta.`;
  if (d.document == null) return `${item}: no se pudo comprobar ${fieldNames[d.field]?.toLowerCase() || "este dato"} en el documento.`;
  const display = (value: unknown) => d.field === "precio_unitario" || d.field === "freight" ? money(Number(value), currency)
    : d.field === "valid_until" ? formatDate(String(value)) : d.field === "lead_time_days" ? `${value} días` : String(value);
  return `${item} · ${fieldNames[d.field] || "Dato"}: oferta ${display(d.structured)}; presupuesto ${display(d.document)}.`;
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
  const [allocation, setAllocation] = useState<RfqAllocation | null>(allocations[0] ?? null);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries((allocations[0]?.lines ?? []).map(l => [String(l.quote_version_item_id), String(l.quantity)])));
  const [analyses, setAnalyses] = useState(initialAnalyses);
  const [reviewIds, setReviewIds] = useState<Record<string, string>>(() => Object.fromEntries(offers.filter(o => o.review_id).map(o => [o.quote_version_id, o.review_id!])));
  const [reviewChecks, setReviewChecks] = useState<Record<string, boolean>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(allocations[0]?.justification ?? "");
  const [otherReason, setOtherReason] = useState(false);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"choose" | "authorize" | "preview">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const lines: AllocationLine[] = Object.entries(quantities).filter(([, q]) => q.trim() !== "" && Number(q) !== 0).map(([id, q]) => ({ quote_version_item_id: id, quantity: Number(q) }));
  const selected = groups.filter(g => g.lines.some(o => lines.some(l => l.quote_version_item_id === o.id)));
  const pending = selected.filter(g => !reviewIds[g.id]);
  const currentOffers = offers.map(o => ({ ...o, review_id: reviewIds[o.quote_version_id] || o.review_id }));
  let selectionError = "";
  let remaining: ReturnType<typeof validateAllocation> = [];
  if (lines.length && !pending.length) {
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
    setQuantities(next); setReason(""); setOtherReason(false); setReviewChecks({}); setResolutions({});
    setAuthorized(false); setConfirmed(false); setPreview(null); setError(""); setStage("choose"); setOpen(true);
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
    setPreview(result.data); setConfirmed(false); setStage("preview");
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
      <Button onClick={() => { setOpen(true); setError(""); setAuthorized(false); if (allocation.authorized_at) void run(() => loadPreview(allocation.id)); else setStage("authorize"); }}>Continuar compra</Button>
    </div>}
    <div className="flex items-center justify-between gap-3"><h2>Ofertas recibidas</h2><span className={styles.muted}>{groups.length} proveedor{groups.length === 1 ? "" : "es"}</span></div>
    {!groups.length && <p className={styles.muted}>Todavía no recibiste ofertas.</p>}
    <div className={styles.offerGrid}>
      {groups.map(g => {
        const first = g.offer;
        const lead = [...new Set(g.lines.filter(o => o.available_quantity > 0).map(o => o.lead_time_days))];
        const full = items.every(i => g.lines.some(o => o.rfq_item_id === i.id && o.available_quantity >= i.cantidad && o.precio_unitario != null));
        const usable = g.lines.some(o => eligibleLine(o, now, false));
        const peers = groups.filter(p => p.offer.currency === first.currency && items.every(i => p.lines.some(o => o.rfq_item_id === i.id && o.available_quantity >= i.cantidad && eligibleLine(o, now, false))));
        const lowest = full && usable && peers.length > 1 && g.version && peers.every(p => p.version && g.version!.total <= p.version.total);
        return <article key={g.id} className={styles.offerCard}>
          <div className={styles.offerHeader}><h3>{first.provider_name}</h3>{lowest && <span className={styles.success}>Menor total · {first.currency}</span>}</div>
          <span className={styles.totalLabel}>Total con IVA y flete{!full ? " · oferta parcial" : ""}</span>
          <p className={styles.total}>{g.version ? money(g.version.total, first.currency) : "Sin importe"}</p>
          <p className={`${styles.muted} mb-5`}>{first.vat_included ? "IVA incluido" : "Incluye el IVA adicional"} · Flete {money(first.freight ?? 0, first.currency)}</p>
          <dl className={styles.facts}>
            {items.length === 1 && <div><dt>Precio unitario</dt><dd>{g.lines[0].precio_unitario == null ? "Sin cotizar" : `${money(g.lines[0].precio_unitario, first.currency)} / ${items[0].unidad}`}</dd></div>}
            <div><dt>Entrega</dt><dd>{lead.length === 1 ? lead[0] === 0 ? "Inmediata" : `${lead[0]} días` : "Según ítem"}</dd></div>
            <div><dt>Disponible</dt><dd>{items.length === 1 ? `${quantity(g.lines[0].available_quantity)} ${items[0].unidad}` : full ? "Todo lo solicitado" : "Cobertura parcial"}</dd></div>
            <div><dt>Pago</dt><dd>{payment(first.payment_terms)}</dd></div>
          </dl>
          <details className={styles.detail}><summary>Detalle de la oferta</summary><div className="space-y-2 mt-3">
            {g.lines.map(o => <p key={o.id}>{items.find(i => i.id === o.rfq_item_id)?.descripcion} · {o.precio_unitario == null ? "Sin cotizar" : money(o.precio_unitario, o.currency)} · {quantity(o.available_quantity)} {items.find(i => i.id === o.rfq_item_id)?.unidad} disponibles · {o.lead_time_days} días</p>)}
            <p>Válida hasta {formatDate(first.valid_until)} · {g.version?.invoiceAvailable ? "Con factura" : "Sin factura"}</p>
            {g.version?.budgetNumber && <p>Presupuesto {g.version.budgetNumber}</p>}{first.observations && <p>{first.observations}</p>}
          </div></details>
          <div className={styles.offerFooter}><BudgetButton attachmentId={first.attachment_id} />{!completed && <Button disabled={!usable} onClick={() => choose(g)}>Adjudicar</Button>}</div>
          {!usable && !completed && <p className={`${styles.muted} mt-2`}>{first.revoked ? "Oferta revocada" : first.valid_until && Date.parse(first.valid_until) <= now ? "Oferta vencida" : "Oferta incompleta o sin disponibilidad"}</p>}
        </article>;
      })}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent title={stage === "choose" ? "Adjudicar compra" : stage === "authorize" ? "Autorizar compra" : "Confirmar orden de compra"} className={`${styles.dialog} max-w-2xl`}>
        {stage !== "preview" && selected.map(g => <div className={styles.selectionSummary} key={g.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3>{g.offer.provider_name}</h3><strong>Estimado: {money(groupTotal(g), g.offer.currency)}</strong></div>
          <ul>{g.lines.filter(o => quantities[o.id] && Number(quantities[o.id]) > 0).map(o => <li key={o.id}><span>{quantity(Number(quantities[o.id]))} {items.find(i => i.id === o.rfq_item_id)?.unidad} de {items.find(i => i.id === o.rfq_item_id)?.descripcion}</span><span>{money(o.precio_unitario ?? 0, o.currency)} / {items.find(i => i.id === o.rfq_item_id)?.unidad}</span></li>)}</ul>
          <p className={`${styles.muted} mt-3`}>Pago: {payment(g.offer.payment_terms)} · Flete: {money(g.offer.freight ?? 0, g.offer.currency)}</p>
        </div>)}
        {stage === "choose" && <>
          <details className={styles.detail}><summary>{groups.length > 1 ? "Cambiar cantidades o repartir entre proveedores" : "Cambiar cantidad"}</summary>
            {offers.map(o => <label key={o.id} className={styles.quantityRow}><span>{items.find(i => i.id === o.rfq_item_id)?.descripcion} · {o.provider_name}<small className="block">Disponible: {quantity(o.available_quantity)} {items.find(i => i.id === o.rfq_item_id)?.unidad}</small></span><Input aria-label={`Cantidad de ${items.find(i => i.id === o.rfq_item_id)?.descripcion} a ${o.provider_name}`} type="number" min="0" max={o.available_quantity} step="0.0001" value={quantities[o.id] || ""} onChange={e => setQuantities(q => ({ ...q, [o.id]: e.target.value }))} /></label>)}
          </details>
          {pending.map(g => {
            const analysis = analyses[g.id];
            const differences = analysis?.data?.comparison ?? [];
            return <div className={styles.reviewCompact} key={g.id}>
              <div className="flex flex-wrap justify-between items-center gap-3"><h3>Revisar presupuesto{selected.length > 1 ? ` · ${g.offer.provider_name}` : ""}</h3><BudgetButton attachmentId={g.offer.attachment_id} /></div>
              {!analysis?.data ? <div className={styles.businessNotice}><p>No se pudo analizar este presupuesto.</p><Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => {
                const result = await extractQuoteDocumentAction(rfqId, g.id);
                if (result.error || !result.data) throw new Error(result.error || "No se pudo leer el documento.");
                setAnalyses(a => ({ ...a, [g.id]: { error: null, data: result.data } }));
              })}>Reintentar análisis</Button></div> : differences.length > 0 ? <>
                <div className={styles.businessNotice}>{differences.slice(0, 3).map((d, i) => <p key={i}>{differenceText(d, items, g.offer.currency)}</p>)}{differences.length > 3 && <details><summary>Ver otras {differences.length - 3} observaciones</summary>{differences.slice(3).map((d, i) => <p key={i}>{differenceText(d, items, g.offer.currency)}</p>)}</details>}</div>
                <Label htmlFor={`resolution-${g.id}`}>¿Qué verificaste en el presupuesto?</Label><Textarea id={`resolution-${g.id}`} value={resolutions[g.id] || ""} placeholder="Aclaración sobre la diferencia o el documento adjunto" onChange={e => setResolutions(r => ({ ...r, [g.id]: e.target.value }))} />
              </> : <p className={`${styles.muted} mt-2`}>Los datos comprobados coinciden con la oferta.</p>}
              <label className={styles.check}><input type="checkbox" checked={reviewChecks[g.id] || false} onChange={e => setReviewChecks(c => ({ ...c, [g.id]: e.target.checked }))} />Revisé el presupuesto y confirmo las condiciones de esta oferta.</label>
            </div>;
          })}
          {!pending.length && selected.length > 0 && <p className={`${styles.success} my-4`}>✓ Presupuesto revisado</p>}
          {!pending.length && <fieldset className="space-y-3 mt-5"><legend className="font-medium mb-3">Motivo de elección</legend><div className={styles.reasonOptions}>
            {reasons.map(text => <label key={text}><input type="radio" name="purchase-reason" checked={!otherReason && reason === text} onChange={() => { setOtherReason(false); setReason(text); }} />{text}</label>)}
            <label><input type="radio" name="purchase-reason" checked={otherReason} onChange={() => { setOtherReason(true); setReason(""); }} />Otro motivo</label>
          </div>{otherReason && <Textarea aria-label="Motivo de elección" value={reason} placeholder="Contá brevemente por qué elegís esta oferta" onChange={e => setReason(e.target.value)} />}</fieldset>}
          {selectionError && <p className={styles.businessNotice} role="alert">{selectionError}</p>}
          {remaining.filter(r => r.unallocated > 0).map(r => <p className={styles.businessNotice} key={r.itemId}>Compra parcial: quedan {quantity(r.unallocated)} {items.find(i => i.id === r.itemId)?.unidad} de {items.find(i => i.id === r.itemId)?.descripcion} sin comprar.</p>)}
        </>}
        {stage === "authorize" && <><p className={styles.muted}>Motivo: {allocation?.justification}</p>{allocation?.authorized_at ? <p className={styles.success}>Compra autorizada. Falta revisar y emitir la orden.</p> : <label className={styles.check}><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} />Autorizo esta compra con el proveedor, cantidades y condiciones indicados.</label>}</>}
        {stage === "preview" && preview?.orders.map(o => <div key={`${o.provider_id}:${o.currency}`} className={styles.selectionSummary}>
          <h3>{o.provider_name}</h3><ul>{o.items.map(i => <li key={i.quote_version_item_id}><span>{quantity(i.quantity)} {i.unit} de {i.product}<small className={`${styles.muted} block`}>{money(i.unit_price, o.currency)} / {i.unit}</small></span><span>{money(i.total, o.currency)}</span></li>)}</ul>
          <dl className={`${styles.facts} my-4`}><div><dt>Entrega</dt><dd>{o.items.map(i => `${o.items.length > 1 ? `${i.product}: ` : ""}${i.lead_time_days} días · ${formatDate(i.expected_delivery_date)}`).join(" · ")}</dd></div><div><dt>Pago</dt><dd>{payment(o.payment_terms)}</dd></div></dl>
          <p className={styles.muted}>IVA {money(o.tax_total, o.currency)} {o.vat_included ? "incluido" : "adicional"} · Flete {money(o.freight, o.currency)}</p>
          <div className="flex justify-between items-center mt-3"><strong>Total de la orden</strong><strong className="text-2xl">{money(o.total, o.currency)}</strong></div>
        </div>)}
        {stage === "preview" && preview && <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo las cantidades, importes y condiciones de {preview.orders.length === 1 ? "esta orden" : "estas órdenes"}.</label>}
        {error && <p className={styles.businessNotice} role="alert">{error}</p>}
        <div className={styles.modalFooter}>
          <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cerrar</Button>
          {stage === "choose" && pending.length > 0 && <Button disabled={busy || pending.some(g => !reviewChecks[g.id] || !analyses[g.id]?.data || ((analyses[g.id]?.data?.comparison.length ?? 0) > 0 && (resolutions[g.id] || "").trim().length < 10))} onClick={() => void run(async () => {
            const ids = { ...reviewIds };
            for (const g of pending) {
              const data = analyses[g.id]?.data;
              if (!data || !reviewChecks[g.id]) throw new Error("Revisá y confirmá cada presupuesto elegido.");
              const resolution = data.comparison.length ? resolutions[g.id] : "Revisé el presupuesto y confirmo las condiciones de esta oferta.";
              const result = await reviewQuoteAction(rfqId, g.id, data.facts, resolution);
              if (result.error || !result.data) throw new Error(result.error || "No se pudo registrar la revisión.");
              ids[g.id] = result.data; setReviewIds({ ...ids });
            }
          })}>{busy ? "Guardando…" : "Confirmar revisión"}</Button>}
          {stage === "choose" && !pending.length && <Button disabled={busy || !lines.length || !!selectionError || reason.trim().length < 10} onClick={() => void run(async () => {
            validateAllocation(lines, items, currentOffers);
            const result = await saveAllocationAction(rfqId, lines, reason, allocation?.revision ?? 0);
            if (result.error || !result.data) throw new Error(result.error || "No se pudo guardar la selección.");
            setAllocation({ ...result.data, justification: reason, lines: lines.map(l => ({ ...l })), authorized_at: null, confirmed_at: null });
            setAuthorized(false); setStage("authorize");
          })}>{busy ? "Guardando…" : "Guardar selección"}</Button>}
          {stage === "authorize" && allocation && <Button disabled={busy || (!allocation.authorized_at && !authorized)} onClick={() => void run(async () => {
            if (!allocation.authorized_at) {
              const result = await authorizeAllocationAction(allocation.id, authorized);
              if (result.error) throw new Error(result.error);
              setAllocation(a => a ? { ...a, authorized_at: new Date().toISOString() } : a);
            }
            await loadPreview(allocation.id);
          })}>{busy ? "Preparando…" : allocation.authorized_at ? "Revisar orden" : "Autorizar y revisar orden"}</Button>}
          {stage === "preview" && preview && <Button disabled={busy || !confirmed} onClick={() => void run(async () => {
            const result = await confirmOrdersAction(preview.allocationId, preview.hash, confirmed);
            if (result.error || !result.data) throw new Error(result.error || "No se pudo emitir la orden.");
            setCreatedIds(result.data.orderIds); setOpen(false); setPreview(null); router.refresh();
          })}>{busy ? "Emitiendo…" : preview.orders.length === 1 ? "Confirmar y emitir OC" : `Confirmar y emitir ${preview.orders.length} OCs`}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
