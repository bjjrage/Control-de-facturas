import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Invoice, InvoiceException, Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { canMarkAptoParaPago, isOverbilled, orderRemaining } from "@/lib/reconciliation";
import { LinkOrderDialog } from "@/app/(internal)/invoices/link-order-dialog";
import { CreateOrderFromInvoiceDialog } from "./create-order-dialog";
import { ExceptionDialog } from "./exception-dialog";
import { AttachmentLink } from "./attachment-link";
import { unmatchOrder, markAptoParaPago } from "./actions";
import { DeleteInvoiceButton } from "./delete-button";
import { CreateOpButton } from "./create-op-button";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoMatched?: string; created?: string }>;
}) {
  const { id } = await params;
  const { autoMatched, created } = await searchParams;
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).single<Invoice>();
  if (!invoice) notFound();

  const { data: provider } = await supabase
    .from("providers")
    .select("*")
    .eq("id", invoice.provider_id)
    .single<Provider>();

  // 1 factura -> 1 OC (entregas parciales): a lo sumo un match.
  const { data: match } = await supabase
    .from("invoice_order_matches")
    .select("id, authorized_orders(*)")
    .eq("invoice_id", id)
    .maybeSingle<{ id: string; authorized_orders: AuthorizedOrder }>();
  const linkedOrder = match?.authorized_orders ?? null;

  const { data: exceptions } = await supabase
    .from("invoice_exceptions")
    .select("*")
    .eq("invoice_id", id)
    .order("created_at", { ascending: false })
    .returns<InvoiceException[]>();

  // OP vinculada (si existe)
  const { data: opLink } = await supabase
    .from("payment_order_invoices")
    .select("payment_orders(id, code)")
    .eq("invoice_id", id)
    .maybeSingle<{ payment_orders: { id: string; code: string } }>();
  const linkedOp = opLink?.payment_orders ?? null;

  const orderTotal = linkedOrder?.total_price ?? 0;
  const orderFacturado = linkedOrder?.facturado_amount ?? 0;
  const orderSaldo = orderRemaining(orderTotal, orderFacturado);
  const overbilled = linkedOrder ? isOverbilled(orderTotal, orderFacturado) : false;

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
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft size={13} /> Volver a Facturas
      </Link>
      {autoMatched === "1" ? (
        <div className="rounded border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-2.5 py-1.5 text-[12px] text-[var(--ok)]">
          Factura guardada y vinculada automáticamente: el monto coincidió con una única orden autorizada pendiente de
          este proveedor.
        </div>
      ) : created === "1" ? (
        <div className="rounded border border-[var(--ok)]/30 bg-[var(--ok-bg)] px-2.5 py-1.5 text-[12px] text-[var(--ok)]">
          Factura guardada. No coincidió automáticamente con ninguna orden autorizada de este proveedor: vinculála a una
          orden acá abajo, o dejala en <strong>Pendientes de vincular</strong> y seguí — ya está registrada.
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
          {invoice.status === "APTO_PARA_PAGO" && !linkedOp ? (
            <CreateOpButton invoiceId={invoice.id} />
          ) : null}
          {invoice.status === "APTO_PARA_PAGO" && linkedOp ? (
            <Link href={`/pagos/${linkedOp.id}`} className="text-action text-[13px] text-[var(--primary)]">
              OP: {linkedOp.code} →
            </Link>
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
          <h2 className="text-[14px] font-semibold">Orden vinculada</h2>
          {!linkedOrder ? (
            <div className="flex gap-2">
              <LinkOrderDialog
                invoiceId={invoice.id}
                trigger={<Button variant="secondary">Vincular OC</Button>}
              />
              <CreateOrderFromInvoiceDialog
                invoiceId={invoice.id}
                total={invoice.total}
                currency={invoice.currency}
                trigger={<Button variant="secondary">Crear OC con esta factura</Button>}
              />
            </div>
          ) : null}
        </div>
        {linkedOrder ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-[13px]">{linkedOrder.code}</div>
                <div className="text-[12px] text-[var(--muted)]">{linkedOrder.product}</div>
              </div>
              <form
                action={async () => {
                  "use server";
                  await unmatchOrder(invoice.id, match!.id, linkedOrder.id);
                }}
              >
                <Button variant="ghost" className="h-6 px-2 text-[12px]" type="submit">
                  Desvincular
                </Button>
              </form>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-[13px] border-t border-[var(--border)] pt-3">
              <div>
                <div className="text-[11px] text-[var(--muted)] mb-0.5">Monto de la orden</div>
                <div className="num">{formatMoney(orderTotal, linkedOrder.currency)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--muted)] mb-0.5">Facturado (con esta)</div>
                <div className="num">{formatMoney(orderFacturado, linkedOrder.currency)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--muted)] mb-0.5">Saldo</div>
                <div className={`num ${overbilled ? "text-[var(--error)]" : ""}`}>
                  {formatMoney(orderSaldo, linkedOrder.currency)}
                </div>
              </div>
            </div>
            {overbilled ? (
              <div className="mt-3 rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
                Lo facturado en esta orden supera su monto autorizado más la tolerancia. Aprobá la excepción
                para poder marcarla apta para pago.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-6 text-center text-[13px] text-[var(--muted)]">
            Esta factura no está vinculada a ninguna orden.
          </div>
        )}
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
