import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppOrigin } from "@/lib/app-origin";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  Attachment,
  AuthorizedOrder,
  Provider,
  QuoteVersion,
  Rfq,
  RfqProvider,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { isRfqOpen, canReopenRfq, rfqClosedReason } from "@/lib/rfq-status";
import { orderRemaining } from "@/lib/reconciliation";
import { InviteDialog } from "./invite-dialog";
import { SelectOfferDialog } from "./select-offer-dialog";
import { AttachmentLink } from "./attachment-link";
import { QuoteShareButtons } from "./quote-share-buttons";
import { ManualQuoteDialog } from "./manual-quote-dialog";
import { AddAttachmentDialog } from "./add-attachment-dialog";
import { cancelRfq, reopenRfq, deleteRfq } from "./actions";
import { InternalQuoteDialog } from "./internal-quote-dialog";
import { RfqWorkspace } from "./rfq-workspace";
import { WorkflowJump } from "./workflow-jump";
import styles from "./procurement-panel.module.css";
import type { loadRfqWorkspace } from "@/lib/rfq/service";
import type { QuoteDocumentAnalysisResult } from "@/lib/rfq/document-analysis";

export async function AdministrativeRfqDetail({ params, canonical, analyses }: {
  params: Promise<{ id: string }>;
  canonical: Awaited<ReturnType<typeof loadRfqWorkspace>>;
  analyses: Record<string, QuoteDocumentAnalysisResult>;
}) {
  const { id } = await params;
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const { data: rfq } = await supabase.from("rfqs").select("*").eq("id", id).eq("empresa_id", profile.empresa_id).single<Rfq>();
  if (!rfq) notFound();

  const { data: rfqProvidersRaw } = await supabase
    .from("rfq_providers")
    .select("*, providers(*)")
    .eq("rfq_id", id)
    .order("invited_at")
    .returns<(RfqProvider & { providers: Provider })[]>();
  const rfqProviders = rfqProvidersRaw ?? [];

  const { data: activeProviders } = await supabase
    .from("providers")
    .select("*")
    .eq("active", true)
    .order("name")
    .returns<Provider[]>();
  const invitedIds = new Set(rfqProviders.map((rp) => rp.provider_id));
  const availableProviders = (activeProviders ?? []).filter((p) => !invitedIds.has(p.id));

  const canSeeQuotes = ["comercial", "administracion", "admin"].includes(profile.role);
  const canManage = ["comercial", "administracion", "admin"].includes(profile.role);

  const latestByRfqProvider = new Map<string, QuoteVersion & { attachment: Attachment | null }>();
  if (canSeeQuotes && rfqProviders.length > 0) {
    const rfqProviderIds = rfqProviders.map((rp) => rp.id);
    const { data: quotes } = await supabase
      .from("quotes")
      .select("id, rfq_provider_id")
      .in("rfq_provider_id", rfqProviderIds);
    const quoteIdToRfqProvider = new Map((quotes ?? []).map((q) => [q.id, q.rfq_provider_id]));

    if (quotes && quotes.length > 0) {
      const { data: versions } = await supabase
        .from("quote_versions")
        .select("*")
        .in(
          "quote_id",
          quotes.map((q) => q.id)
        )
        .order("version_number", { ascending: false })
        .returns<QuoteVersion[]>();

      const { data: attachments } = await supabase
        .from("attachments")
        .select("*")
        .in("id", (versions ?? []).map((v) => v.pdf_attachment_id))
        .returns<Attachment[]>();
      const attachmentById = new Map((attachments ?? []).map((a) => [a.id, a]));

      for (const v of versions ?? []) {
        const rpId = quoteIdToRfqProvider.get(v.quote_id);
        if (!rpId) continue;
        if (!latestByRfqProvider.has(rpId)) {
          latestByRfqProvider.set(rpId, {
            ...v,
            attachment: v.pdf_attachment_id ? attachmentById.get(v.pdf_attachment_id) ?? null : null,
          });
        }
      }
    }
  }

  const { data: rfqAttachments } = await supabase
    .from("attachments")
    .select("*")
    .eq("rfq_id", id)
    .order("created_at")
    .returns<Attachment[]>();

  // RFQ multi-ítem (costeo): precios por línea de la última versión de cada
  // proveedor, y los adjuntos que subió cada uno (para cargar precios a mano).
  const { data: rfqItemsData } = await supabase
    .from("rfq_items")
    .select("id, descripcion, cantidad, unidad")
    .eq("rfq_id", id)
    .order("sort_order");
  const rfqItems = (rfqItemsData ?? []).map((it) => ({ ...it, cantidad: Number(it.cantidad) }));
  const isMultiItem = rfqItems.length > 0;

  const itemPricesByVersion = new Map<string, Map<string, number | null>>();
  if (isMultiItem && latestByRfqProvider.size > 0) {
    const versionIds = [...latestByRfqProvider.values()].map((v) => v.id);
    const { data: versionItems } = await supabase
      .from("quote_version_items")
      .select("quote_version_id, rfq_item_id, precio_unitario")
      .in("quote_version_id", versionIds);
    for (const vi of versionItems ?? []) {
      const m = itemPricesByVersion.get(vi.quote_version_id) ?? new Map<string, number | null>();
      m.set(vi.rfq_item_id, vi.precio_unitario == null ? null : Number(vi.precio_unitario));
      itemPricesByVersion.set(vi.quote_version_id, m);
    }
  }

  const providerAttachments = new Map<string, Attachment[]>();
  if (isMultiItem && rfqProviders.length > 0) {
    const { data: provAtt } = await supabase
      .from("attachments")
      .select("*")
      .in("rfq_provider_id", rfqProviders.map((rp) => rp.id))
      .order("created_at", { ascending: false })
      .returns<Attachment[]>();
    for (const a of provAtt ?? []) {
      const key = (a as Attachment & { rfq_provider_id: string | null }).rfq_provider_id;
      if (!key) continue;
      providerAttachments.set(key, [...(providerAttachments.get(key) ?? []), a]);
    }
  }
  const canEnterPrices = ["comercial", "administracion", "admin"].includes(profile.role ?? "");

  let authorizedOrder: AuthorizedOrder | null = null;
  if (rfq.selected_rfq_provider_id) {
    const { data } = await supabase
      .from("authorized_orders")
      .select("*")
      .eq("rfq_id", id)
      .maybeSingle<AuthorizedOrder>();
    authorizedOrder = data ?? null;
  }

  // Cheapest quote received per currency, purely a visual suggestion — the
  // final call (and the required justification if picking something else)
  // still happens in SelectOfferDialog when someone actually authorizes.
  const cheapestByCurrency = new Map<string, { rfqProviderId: string; total: number }>();
  for (const [rpId, q] of latestByRfqProvider) {
    const current = cheapestByCurrency.get(q.currency);
    if (!current || q.total_price < current.total) {
      cheapestByCurrency.set(q.currency, { rfqProviderId: rpId, total: q.total_price });
    }
  }
  const suggestedRfqProviderIds = new Set(
    [...cheapestByCurrency.values()].map((c) => c.rfqProviderId)
  );

  const appUrl = await getAppOrigin();
  const open = isRfqOpen(rfq);
  const closedReason = rfqClosedReason(rfq);
  const canInvite = canManage && open;
  // Legacy one-step authorization cannot satisfy the current review/preview contract.
  const canSelect = false;
  const canCancel = canManage && ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"].includes(rfq.status);
  const canDelete = profile.role === "admin" && ["CANCELADO", "BORRADOR"].includes(rfq.status);
  const canReopen = canManage && canReopenRfq(rfq);
  const actuallyExpired = closedReason === "Vencida";
  const pendingReview = canonical.offers.find(o => !o.review_id);
  const latestAllocation = canonical.allocations[0];
  const currentStep = latestAllocation?.confirmed_at ? 5 : latestAllocation?.authorized_at ? 4 : latestAllocation ? 3 : pendingReview ? 1 : 2;

  const respondedQuotes = Array.from(latestByRfqProvider.entries()).map(([rpId, quote]) => {
    const rp = rfqProviders.find((p) => p.id === rpId);
    return {
      rfqProviderId: rpId,
      providerName: rp?.providers.name ?? "Proveedor",
      quote,
      isSuggested: !rfq.selected_rfq_provider_id && suggestedRfqProviderIds.has(rpId),
    };
  });

  return (
    <div className={`${styles.page} space-y-6`}>
      <Link href="/rfqs" className="text-action text-[12px] text-[var(--muted)]">
        ← Volver a Cotizaciones
      </Link>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{rfq.code}</h1>
            <Badge tone={open ? "warn" : "neutral"}>{open ? "Abierta" : "Cerrada"}</Badge>
            {closedReason ? <span className="text-[11px] text-[var(--muted)]">{closedReason}</span> : null}
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {rfq.product} · {rfqItems.length === 1
              ? `${formatNumber(rfqItems[0].cantidad, 4)} ${rfqItems[0].unidad}`
              : rfqItems.length > 1
                ? `${rfqItems.length} ítems`
                : `${formatNumber(rfq.quantity, 4)} ${rfq.unit}`}
          </p>
          {open || actuallyExpired ? (
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              {open ? `Vence: ${formatDateTime(rfq.expires_at)}` : `Venció: ${formatDateTime(rfq.expires_at)}`}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {canReopen ? (
            <form
              action={async () => {
                "use server";
                await reopenRfq(rfq.id);
              }}
            >
              <Button variant="secondary" type="submit">
                Reabrir solicitud (72hs)
              </Button>
            </form>
          ) : null}
          {canCancel ? (
            <form
              action={async () => {
                "use server";
                await cancelRfq(rfq.id);
              }}
            >
              <Button variant="danger" type="submit">
                Cancelar solicitud
              </Button>
            </form>
          ) : null}
          {canDelete ? (
            <form
              action={async () => {
                "use server";
                await deleteRfq(rfq.id);
              }}
            >
              <Button variant="danger" type="submit">
                Eliminar
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {canonical.offers.length > 0 && <section className={styles.progress} aria-label="Estado de adjudicación">
        <ol className={styles.steps}>
          {["1. Revisar documentos", "2. Adjudicar", "3. Autorizar", "4. Emitir OC"].map((step, index) =>
            <li key={step} className={`${styles.step} ${currentStep === index + 1 ? styles.current : ""}`} aria-current={currentStep === index + 1 ? "step" : undefined}>{step}</li>)}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2>{latestAllocation?.confirmed_at ? "Orden de compra emitida" : pendingReview ? "Revisá el presupuesto para poder adjudicar" : latestAllocation?.authorized_at ? "La adjudicación está autorizada" : latestAllocation ? "Adjudicación guardada: falta autorizar" : "Ofertas revisadas: podés adjudicar"}</h2>
            <p className={styles.muted}>{latestAllocation?.confirmed_at ? "La compra continúa en Órdenes de compra." : pendingReview ? "El sistema preparó el análisis. Confirmá las diferencias o la falta de evidencia; no hace falta volver a transcribir toda la oferta." : "La selección, autorización y emisión de la orden son pasos explícitos."}</p>
          </div>
          {!latestAllocation?.confirmed_at && <WorkflowJump targetId={pendingReview ? `review-${pendingReview.quote_version_id}` : latestAllocation ? "authorization" : "adjudication"}>
            {pendingReview ? "Revisar para adjudicar" : latestAllocation?.authorized_at ? "Ir a emitir OC" : latestAllocation ? "Autorizar adjudicación" : "Adjudicar oferta"}
          </WorkflowJump>}
        </div>
      </section>}

      <details className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <summary className="text-sm font-medium">Datos de la solicitud y archivos de referencia</summary>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Especificaciones</div>
          <div>{rfq.specifications ?? "-"}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Referencia interna</div>
          <div>{rfq.internal_reference ?? "-"}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Fecha requerida</div>
          <div>{formatDate(rfq.required_date)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Mostrar cliente al proveedor</div>
          <div>{rfq.mostrar_cliente_al_proveedor ? "Sí" : "No"}</div>
        </div>
        <div className="col-span-2">
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Observaciones</div>
          <div>{rfq.observations ?? "-"}</div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Archivos de referencia</h2>
          {canManage ? (
            <AddAttachmentDialog rfqId={rfq.id} trigger={<Button variant="secondary" className="h-7 px-2 text-[12px]">Agregar archivo</Button>} />
          ) : null}
        </div>
        {(rfqAttachments ?? []).length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            Sin archivos cargados. Subí, por ejemplo, la ficha del producto a cotizar (onzas, colores, etc.)
            para que los proveedores la vean al cotizar.
          </p>
        ) : (
          <ul className="space-y-1">
            {(rfqAttachments ?? []).map((a) => (
              <li key={a.id} className="text-[13px]">
                <AttachmentLink bucket={a.bucket} path={a.path} fileName={a.file_name} />
              </li>
            ))}
          </ul>
        )}
      </div>
      </details>

      {authorizedOrder ? (
        <Link
          href={`/orders/${authorizedOrder.id}`}
          className="block rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px] hover:border-[var(--ok)]/60"
        >
          <div className="font-medium mb-1">Orden autorizada →</div>
          <p>
            {authorizedOrder.provider_name} · {formatMoney(authorizedOrder.total_price, authorizedOrder.currency)}
            {authorizedOrder.is_cheapest ? " · oferta más económica" : ` · motivo: ${authorizedOrder.selection_reason}`}
          </p>
          <p className="text-[12px] mt-1">
            Facturado: {formatMoney(authorizedOrder.facturado_amount, authorizedOrder.currency)} · Saldo:{" "}
            {formatMoney(
              orderRemaining(authorizedOrder.total_price, authorizedOrder.facturado_amount),
              authorizedOrder.currency
            )}
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            Autorizada el {formatDateTime(authorizedOrder.authorized_at)}
          </p>
        </Link>
      ) : null}

      {isMultiItem ? (
        <div className={`${styles.section} space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className={styles.sectionTitle}><span className={styles.number}>↔</span> Comparativa por ítem</h2>
            <span className="text-[12px] text-[var(--muted)]">
              {rfqItems.length} ítems · {respondedQuotes.length} cotización{respondedQuotes.length === 1 ? "" : "es"}
            </span>
          </div>
          <p className="text-[12px] text-[var(--muted)]">
            {rfq.purpose === "COST_DISCOVERY"
              ? "Solicitud de costeo: estos precios alimentan el presupuesto de costo de la obra."
              : "Solicitud de compra: compará las ofertas y revisá sus documentos antes de autorizar."}
          </p>
          {canSeeQuotes && respondedQuotes.length > 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Ítem</th>
                    <th className="num">Cantidad</th>
                    {respondedQuotes.map((q) => (
                      <th key={q.rfqProviderId} className="num">
                        {q.providerName}
                        <div className="text-[10px] font-normal text-[var(--muted)]">
                          {q.quote.currency} · {q.quote.vat_included ? "IVA incl." : "+ IVA"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rfqItems.map((it) => {
                    const cells = respondedQuotes.map((q) => itemPricesByVersion.get(q.quote.id)?.get(it.id) ?? null);
                    const priced = cells.filter((c): c is number => c != null && c > 0);
                    const minimums = new Map<string, number>();
                    cells.forEach((price, index) => {
                      if (price != null && price > 0) {
                        const currency = respondedQuotes[index].quote.currency;
                        minimums.set(currency, Math.min(minimums.get(currency) ?? Infinity, price));
                      }
                    });
                    return (
                      <tr key={it.id}>
                        <td>{it.descripcion}</td>
                        <td className="num whitespace-nowrap">
                          {formatNumber(it.cantidad, Number.isInteger(it.cantidad) ? 0 : 2)} {it.unidad}
                        </td>
                        {cells.map((c, idx) => (
                          <td key={idx} className={`num ${c != null && c === minimums.get(respondedQuotes[idx].quote.currency) && priced.length > 1 ? "font-semibold text-[var(--ok)]" : ""}`}>
                            {c == null ? <span className="text-[var(--muted)]">No cotiza</span> : formatMoney(c, respondedQuotes[idx].quote.currency)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="text-right font-semibold">Total</td>
                    {respondedQuotes.map((q) => (
                      <td key={q.rfqProviderId} className="num font-semibold">
                        {formatMoney(q.quote.total_price, q.quote.currency)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--muted)]">
              {canSeeQuotes
                ? "Todavía no hay cotizaciones con precios. Mandá el link o el QR a los proveedores para recibir su oferta y presupuesto original."
                : "Tu rol no ve los precios cotizados."}
            </p>
          )}
        </div>
      ) : null}

      {/* Cuadro Comparativo de Ofertas */}
      {canSeeQuotes && respondedQuotes.length > 0 ? (
        <div className={`${styles.section} space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold">Cuadro Comparativo de Ofertas</h2>
            <span className="text-[12px] text-[var(--muted)]">
              {respondedQuotes.length} oferta{respondedQuotes.length > 1 ? "s" : ""} recibida{respondedQuotes.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {respondedQuotes.map(({ rfqProviderId, providerName, quote, isSuggested }) => (
              <div
                key={rfqProviderId}
                className={`rounded-lg border p-4 space-y-3 ${
                  isSuggested
                    ? "border-[var(--ok)]/40 bg-[var(--ok-bg)]/20"
                    : "border-[var(--border)] bg-[var(--panel)]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-[14px] flex items-center gap-1.5">
                      {providerName}
                      {isSuggested ? <Badge tone="ok">Mejor Precio</Badge> : null}
                    </div>
                    <div className="text-[12px] text-[var(--muted)]">
                      Ppto: {quote.budget_number || "-"} · Versión #{quote.version_number}
                    </div>
                  </div>
                  {canManage && open && canonical.offers.some(o => o.quote_version_id === quote.id) &&
                    <WorkflowJump targetId={canonical.offers.some(o => o.quote_version_id === quote.id && !o.review_id) ? `review-${quote.id}` : "adjudication"}>
                      {canonical.offers.some(o => o.quote_version_id === quote.id && !o.review_id) ? "Revisar y adjudicar" : "Adjudicar oferta"}
                    </WorkflowJump>}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[12px] pt-1 border-t border-[var(--border)]/60">
                  <div>
                    <span className="text-[var(--muted)]">Precio Unitario:</span>{" "}
                    <span className="font-medium">{rfqItems.length === 1
                      ? formatMoney(itemPricesByVersion.get(quote.id)?.get(rfqItems[0].id) ?? null, quote.currency)
                      : rfqItems.length > 1 ? "Ver líneas" : formatMoney(quote.unit_price, quote.currency)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Precio Total:</span>{" "}
                    <span className="font-semibold">{formatMoney(quote.total_price, quote.currency)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Plazo Entrega:</span>{" "}
                    <span>{quote.delivery_time || "-"}</span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Validez Oferta:</span>{" "}
                    <span>{quote.offer_validity || "-"}</span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Condición Fiscal:</span>{" "}
                    <span>{quote.vat_included ? "IVA Incluido" : "Más IVA"}</span>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Factura:</span>{" "}
                    <span>{quote.invoice_available ? "Disponible" : "Sin Factura"}</span>
                  </div>
                </div>

                {quote.observations ? (
                  <p className="text-[12px] text-[var(--muted)] italic border-t border-[var(--border)]/40 pt-1">
                    &quot;{quote.observations}&quot;
                  </p>
                ) : null}

                {quote.attachment ? (
                  <div className="pt-1">
                    <AttachmentLink
                      bucket={quote.attachment.bucket}
                      path={quote.attachment.path}
                      fileName={`Presupuesto original (${quote.attachment.file_name || "descargar"})`}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Proveedores invitados</h2>
          {canInvite ? (
            <InviteDialog
              rfqId={rfq.id}
              availableProviders={availableProviders}
              trigger={<Button variant="secondary">Invitar proveedores</Button>}
            />
          ) : null}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Estado</th>
                {canSeeQuotes ? (
                  <>
                    <th>Presupuesto</th>
                    <th className="num">Total</th>
                    <th>Entrega</th>
                    <th>Adjunto</th>
                    <th></th>
                  </>
                ) : null}
                <th>Enlace portal</th>
              </tr>
            </thead>
            <tbody>
              {rfqProviders.map((rp) => {
                const quote = latestByRfqProvider.get(rp.id);
                const portalUrl = `${appUrl}/cotizar/${rp.token}`;
                return (
                  <tr key={rp.id}>
                    <td className="font-medium">{rp.providers.name}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge status={rp.status} />
                        {!rfq.selected_rfq_provider_id && suggestedRfqProviderIds.has(rp.id) ? (
                          <Badge tone="ok">Sugerida</Badge>
                        ) : null}
                      </span>
                    </td>
                    {canSeeQuotes ? (
                      <>
                        <td>{quote?.budget_number ?? "-"}</td>
                        <td className="num">
                          {quote ? formatMoney(quote.total_price, quote.currency) : "-"}
                        </td>
                        <td>{quote?.delivery_time ?? "-"}</td>
                        <td>
                          {quote?.attachment ? (
                            <AttachmentLink
                              bucket={quote.attachment.bucket}
                              path={quote.attachment.path}
                              fileName="Ver documento"
                            />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          {canSelect && quote ? (
                            <SelectOfferDialog
                              rfqId={rfq.id}
                              rfqProviderId={rp.id}
                              quoteVersionId={quote.id}
                              providerName={rp.providers.name}
                              totalPrice={quote.total_price}
                              currency={quote.currency}
                              trigger={
                                <Button className="h-6 px-2 text-[12px]">Autorizar</Button>
                              }
                            />
                          ) : null}
                        </td>
                      </>
                    ) : null}
                    <td>
                      <div className="flex flex-wrap items-center gap-2 py-1">
                        {rp.status !== "RESPONDIDO" || isMultiItem ? (
                          <QuoteShareButtons
                            url={portalUrl}
                            providerName={rp.providers.name}
                            phone={rp.providers.phone ?? null}
                            rfqCode={rfq.code}
                          />
                        ) : (
                          <span className="text-[var(--muted)]">-</span>
                        )}
                        {isMultiItem && canEnterPrices && rfq.purpose === "COST_DISCOVERY" ? (
                          <ManualQuoteDialog
                            rfqProviderId={rp.id}
                            providerName={rp.providers.name}
                            items={rfqItems}
                            attachments={(providerAttachments.get(rp.id) ?? []).map((a) => ({
                              id: a.id,
                              bucket: a.bucket,
                              path: a.path,
                              file_name: a.file_name,
                            }))}
                            trigger={
                              <button type="button" className="text-[12px] text-[var(--primary)] underline hover:no-underline">
                                Cargar precios del adjunto
                              </button>
                            }
                          />
                        ) : null}
                        {rfq.purpose === "PROCUREMENT" && canonical.items.length > 0 && isRfqOpen(rfq) ? (
                          <InternalQuoteDialog providerId={rp.id} providerName={rp.providers.name} items={canonical.items} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rfqProviders.length === 0 ? (
                <tr>
                  <td colSpan={canSeeQuotes ? 8 : 3} className="text-center text-[var(--muted)] py-6">
                    Todavía no invitaste proveedores.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {canonical.offers.length > 0 && (
        <RfqWorkspace rfqId={id} purpose={canonical.rfq.purpose}
          projectId={canonical.rfq.project_id} items={canonical.items}
          offers={canonical.offers} analyses={analyses} allocations={canonical.allocations}
          administrative
          canAdopt={profile.role === "admin" || profile.role === "administracion"} />
      )}
    </div>
  );
}
