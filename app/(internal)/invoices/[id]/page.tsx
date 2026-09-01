import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Invoice, InvoiceException, Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { canMarkAptoParaPago, canMarkPagado, differenceAmount, differencePct } from "@/lib/reconciliation";
import { MatchDialog } from "./match-dialog";
import { ExceptionDialog } from "./exception-dialog";
import { AttachmentLink } from "./attachment-link";
import { unmatchOrder, markAptoParaPago, markPagado } from "./actions";
import { DeleteInvoiceButton } from "./delete-button";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoMatched?: string }>;
}) {
  const { id } = await params;
  const { autoMatched } = await searchParams;
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).single<Invoice>();
  if (!invoice) notFound();

  const { data: provider } = await supabase
    .from("providers")
    .select("*")
    .eq("id", invoice.provider_id)
    .single<Provider>();

  const { data: matches } = await supabase
    .from("invoice_order_matches")
    .select("id, authorized_orders(*)")
    .eq("invoice_id", id)
    .returns<{ id: string; authorized_orders: AuthorizedOrder }[]>();

  const { data: allMatchedIds } = await supabase.from("invoice_order_matches").select("authorized_order_id");
  const matchedOrderIds = new Set((allMatchedIds ?? []).map((m) => m.authorized_order_id));

  const { data: candidateOrders } = await supabase
    .from("authorized_orders")
    .select("id, rfq_code, product, total_price, currency")
    .eq("provider_id", invoice.provider_id)
    .returns<{ id: string; rfq_code: string; product: string; total_price: number; currency: string }[]>();
  const candidates = (candidateOrders ?? []).filter((c) => !matchedOrderIds.has(c.id));

  const { data: exceptions } = await supabase
    .from("invoice_exceptions")
    .select("*")
    .eq("invoice_id", id)
    .order("created_at", { ascending: false })
    .returns<InvoiceException[]>();

  const authorizedSum = (matches ?? []).reduce((sum, m) => sum + m.authorized_orders.total_price, 0);
  const diffAmount = differenceAmount(invoice.total, authorizedSum);
  const diffPct = differencePct(invoice.total, authorizedSum);

  let attachment: { bucket: string; path: string; file_name: string } | null = null;
  if (invoice.attachment_id) {
    const { data } = await supabase
      .from("attachments")
      .select("bucket, path, file_name")
      .eq("id", invoice.attachment_id)
      .maybeSingle();
    attachment = data ?? null;
  }

  return (
    <div className="max-w-4xl space-y-5">
      {autoMatched === "1" ? (
        <div className="rounded border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-2.5 py-1.5 text-[12px] text-[var(--ok)]">
          Vinculada automáticamente: el monto coincidió con una única orden autorizada pendiente de este proveedor.
        </div>
      ) : null}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">Factura {invoice.invoice_number}</h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {provider?.name} · {formatDate(invoice.invoice_date)} · {formatMoney(invoice.total, invoice.currency)}
          </p>
        </div>
        <div className="flex gap-2">
          {invoice.status === "REQUIERE_REVISION" ? (
            <ExceptionDialog invoiceId={invoice.id} trigger={<Button variant="secondary">Aprobar por excepción</Button>} />
          ) : null}
          {canMarkAptoParaPago(invoice.status) ? (
            <form
              action={async () => {
                "use server";
                await markAptoParaPago(invoice.id);
              }}
            >
              <Button type="submit">Marcar apto para pago</Button>
            </form>
          ) : null}
          {canMarkPagado(invoice.status) ? (
            <form
              action={async () => {
                "use server";
                await markPagado(invoice.id);
              }}
            >
              <Button type="submit">Marcar pagado</Button>
            </form>
          ) : null}
          {profile.role === "admin" ? <DeleteInvoiceButton invoiceId={invoice.id} redirectTo="/invoices" /> : null}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-3 gap-3 text-[13px]">
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Subtotal</div>
          <div>{formatMoney(invoice.subtotal, invoice.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">IVA</div>
          <div>{formatMoney(invoice.vat, invoice.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Timbrado</div>
          <div>{invoice.timbrado ?? "-"}</div>
        </div>
        <div className="col-span-2">
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Observaciones</div>
          <div>{invoice.observations ?? "-"}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Adjunto</div>
          <div>
            {attachment ? (
              <AttachmentLink bucket={attachment.bucket} path={attachment.path} fileName={attachment.file_name} />
            ) : (
              "-"
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Órdenes vinculadas</h2>
          <MatchDialog invoiceId={invoice.id} candidates={candidates} trigger={<Button variant="secondary">Vincular orden</Button>} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>RFQ</th>
                <th>Producto</th>
                <th className="num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(matches ?? []).map((m) => (
                <tr key={m.id}>
                  <td>{m.authorized_orders.rfq_code}</td>
                  <td>{m.authorized_orders.product}</td>
                  <td className="num">{formatMoney(m.authorized_orders.total_price, m.authorized_orders.currency)}</td>
                  <td>
                    <form
                      action={async () => {
                        "use server";
                        await unmatchOrder(invoice.id, m.id, m.authorized_orders.id);
                      }}
                    >
                      <Button variant="ghost" className="h-6 px-2 text-[12px]" type="submit">
                        Desvincular
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
              {(matches ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-[var(--muted)] py-6">
                    No hay órdenes vinculadas todavía.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-4 mt-2 text-[12px] text-[var(--muted)]">
          <span>Autorizado: {formatMoney(authorizedSum, invoice.currency)}</span>
          <span>
            Diferencia: {formatMoney(diffAmount, invoice.currency)} ({diffPct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {(exceptions ?? []).length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">Excepciones aprobadas</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Motivo</th>
                  <th className="num">Diferencia</th>
                  <th>Aprobada</th>
                </tr>
              </thead>
              <tbody>
                {(exceptions ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.reason}
                      {e.comment ? <div className="text-[var(--muted)] text-[12px]">{e.comment}</div> : null}
                    </td>
                    <td className="num">
                      {formatMoney(e.difference_amount, invoice.currency)} ({e.difference_pct.toFixed(2)}%)
                    </td>
                    <td>{formatDateTime(e.approved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
