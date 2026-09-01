import { notFound } from "next/navigation";
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
import { CopyLinkButton } from "./copy-link-button";
import { AddAttachmentDialog } from "./add-attachment-dialog";
import { cancelRfq, reopenRfq } from "./actions";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const { data: rfq } = await supabase.from("rfqs").select("*").eq("id", id).single<Rfq>();
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

  const canSeeQuotes = profile.role === "comercial" || profile.role === "admin";
  const canManage = profile.role === "comercial" || profile.role === "admin";

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
          latestByRfqProvider.set(rpId, { ...v, attachment: attachmentById.get(v.pdf_attachment_id) ?? null });
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const open = isRfqOpen(rfq);
  const closedReason = rfqClosedReason(rfq);
  const canInvite = canManage && open;
  const canSelect = canManage && ["COTIZANDO", "OFERTAS_RECIBIDAS"].includes(rfq.status);
  const canCancel = canManage && ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"].includes(rfq.status);
  const canReopen = canManage && canReopenRfq(rfq);
  const actuallyExpired = new Date(rfq.expires_at).getTime() <= Date.now();

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{rfq.code}</h1>
            <Badge tone={open ? "warn" : "neutral"}>{open ? "Abierta" : "Cerrada"}</Badge>
            {closedReason ? <span className="text-[11px] text-[var(--muted)]">{closedReason}</span> : null}
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {rfq.product} · {formatNumber(rfq.quantity, 2)} {rfq.unit}
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
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-2 gap-3 text-[13px]">
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

      {authorizedOrder ? (
        <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px]">
          <div className="font-medium mb-1">Orden autorizada</div>
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
                              fileName="PDF"
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
                      {rp.status !== "RESPONDIDO" ? (
                        <CopyLinkButton url={portalUrl} />
                      ) : (
                        <span className="text-[var(--muted)]">-</span>
                      )}
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
    </div>
  );
}
