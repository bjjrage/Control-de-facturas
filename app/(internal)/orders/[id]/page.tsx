import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Invoice, Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { orderRemaining, isOverbilled } from "@/lib/reconciliation";
import { unmatchOrder } from "@/app/(internal)/invoices/[id]/actions";
import { InvoiceDialog } from "@/app/(internal)/invoices/invoice-dialog";
import { LinkInvoiceDialog } from "./link-invoice-dialog";
import { OrderPipeline } from "../order-pipeline";
import { DeleteOrderButton } from "../delete-order-button";

const ORIGIN_LABEL = { rfq: "Desde solicitud", manual: "Carga manual", invoice: "Desde factura" } as const;

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("authorized_orders")
    .select("*")
    .eq("id", id)
    .single<AuthorizedOrder>();
  if (!order) notFound();

  const [{ data: provider }, { data: matches }, { data: candidateInvoices }] = await Promise.all([
    supabase.from("providers").select("*").eq("id", order.provider_id).single<Provider>(),
    supabase
      .from("invoice_order_matches")
      .select("id, invoices(*)")
      .eq("authorized_order_id", id)
      .returns<{ id: string; invoices: Invoice }[]>(),
    supabase
      .from("invoices")
      .select("id, invoice_number, invoice_date, total, currency")
      .eq("provider_id", order.provider_id)
      .eq("status", "PENDIENTE")
      .returns<Pick<Invoice, "id" | "invoice_number" | "invoice_date" | "total" | "currency">[]>(),
  ]);

  const saldo = orderRemaining(order.total_price, order.facturado_amount);
  const over = isOverbilled(order.total_price, order.facturado_amount);
  const pct =
    order.total_price > 0 ? Math.min(100, Math.round((order.facturado_amount / order.total_price) * 100)) : 0;
  const canDelete = profile.role === "admin" && order.facturado_amount === 0 && (matches ?? []).length === 0;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/orders" className="text-action text-[12px] text-[var(--muted)]">
            ← Volver a Órdenes
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-[17px] font-semibold">{order.code}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            {order.provider_name} · {order.product} · {formatNumber(order.quantity, 2)} {order.unit} ×{" "}
            {formatMoney(order.unit_price, order.currency)}
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            {ORIGIN_LABEL[order.created_from]}
            {order.rfq_id ? (
              <>
                {" · "}
                <Link href={`/rfqs/${order.rfq_id}`} className="text-action">
                  ver solicitud
                </Link>
              </>
            ) : null}
            {" · autorizada el "}
            {formatDate(order.authorized_at)}
          </p>
        </div>
        {canDelete ? <DeleteOrderButton orderId={order.id} redirectTo="/orders" /> : null}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <OrderPipeline
          status={order.status}
          totalPrice={order.total_price}
          facturadoAmount={order.facturado_amount}
          size="full"
        />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-0.5">Monto de la orden</div>
            <div className="num">{formatMoney(order.total_price, order.currency)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-0.5">Facturado</div>
            <div className="num">{formatMoney(order.facturado_amount, order.currency)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--muted)] mb-0.5">Saldo</div>
            <div className={`num ${over ? "text-[var(--error)]" : ""}`}>{formatMoney(saldo, order.currency)}</div>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-[var(--hover)] overflow-hidden">
          <div
            className={`h-full rounded-full ${over ? "bg-[var(--error)]" : "bg-[var(--primary)]"}`}
            style={{ width: `${over ? 100 : pct}%` }}
          />
        </div>
        {over ? (
          <p className="mt-2 text-[12px] text-[var(--error)]">
            Lo facturado supera el monto de la orden más la tolerancia — revisá las facturas.
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Facturas de esta orden</h2>
          <div className="flex gap-2">
            {candidateInvoices && candidateInvoices.length > 0 ? (
              <LinkInvoiceDialog
                orderId={order.id}
                candidates={candidateInvoices}
                trigger={
                  <Button variant="secondary" className="h-7 px-2.5 text-[12px]">
                    Vincular factura existente
                  </Button>
                }
              />
            ) : null}
            {provider ? (
              <InvoiceDialog
                providers={[provider]}
                linkOrderId={order.id}
                defaultProviderId={provider.id}
                trigger={
                  <Button className="h-7 px-2.5 text-[12px]">Cargar factura</Button>
                }
              />
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>N° Factura</th>
                <th>Fecha</th>
                <th className="num">Total</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(matches ?? []).map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/invoices/${m.invoices.id}`} className="text-action font-medium">
                      {m.invoices.invoice_number}
                    </Link>
                  </td>
                  <td className="text-[var(--muted)]">{formatDate(m.invoices.invoice_date)}</td>
                  <td className="num">{formatMoney(m.invoices.total, m.invoices.currency)}</td>
                  <td>
                    <StatusBadge status={m.invoices.status} />
                  </td>
                  <td>
                    <form
                      action={async () => {
                        "use server";
                        await unmatchOrder(m.invoices.id, m.id, order.id);
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
                  <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                    Todavía no hay facturas para esta orden.
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
