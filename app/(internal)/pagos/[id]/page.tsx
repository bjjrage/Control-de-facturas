import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PaymentOrder, Provider } from "@/lib/types";
import { BackButton } from "@/components/ui/back-button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ExecuteButton } from "./execute-button";

const STATUS_TONE = { EMITIDA: "warn", EJECUTADA: "ok" } as const;
const STATUS_LABELS = { EMITIDA: "Emitida", EJECUTADA: "Ejecutada" };

export default async function PaymentOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { data: op } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("id", id)
    .single<PaymentOrder>();
  if (!op) notFound();

  const { data: provider } = await supabase
    .from("providers")
    .select("id, name")
    .eq("id", op.provider_id)
    .single<Pick<Provider, "id" | "name">>();

  // Get linked invoice IDs
  const { data: links } = await supabase
    .from("payment_order_invoices")
    .select("invoice_id")
    .eq("payment_order_id", id);
  const invoiceIds = (links ?? []).map((l) => l.invoice_id as string);

  // Fetch invoices
  const { data: invoices } = invoiceIds.length > 0
    ? await supabase.from("invoices").select("id, invoice_number, invoice_date, total, currency, status").in("id", invoiceIds)
    : { data: [] };

  // Fetch OC matches for these invoices
  const { data: matches } = invoiceIds.length > 0
    ? await supabase
        .from("invoice_order_matches")
        .select("invoice_id, authorized_orders(id, code)")
        .in("invoice_id", invoiceIds)
    : { data: [] };

  const ocByInvoice = new Map<string, { id: string; code: string }>();
  for (const m of matches ?? []) {
    const order = m.authorized_orders as { id: string; code: string } | null;
    if (order) ocByInvoice.set(m.invoice_id as string, order);
  }

  // Totals by currency
  const totalsByCurrency = new Map<string, number>();
  for (const inv of invoices ?? []) {
    const c = inv.currency as string;
    totalsByCurrency.set(c, (totalsByCurrency.get(c) ?? 0) + (inv.total as number));
  }

  return (
    <div className="max-w-4xl space-y-5">
      <BackButton label="Volver a Pagos" />

      <div className="flex items-start justify-between mt-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{op.code}</h1>
            <Badge tone={STATUS_TONE[op.status]}>{STATUS_LABELS[op.status]}</Badge>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {provider?.name} · Emitida {formatDate(op.created_at)}
            {op.executed_at ? ` · Ejecutada ${formatDate(op.executed_at)}` : ""}
          </p>
        </div>
        {op.status === "EMITIDA" ? <ExecuteButton opId={op.id} /> : null}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-[13px] font-semibold">
            Facturas ({(invoices ?? []).length})
          </span>
          <span className="text-[13px] text-[var(--muted)]">
            {[...totalsByCurrency.entries()].map(([c, v]) => formatMoney(v, c as never)).join(" · ")}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>N° Factura</th>
              <th>Fecha</th>
              <th>OC vinculada</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-[var(--muted)] py-6">Sin facturas vinculadas.</td>
              </tr>
            ) : (
              (invoices ?? []).map((inv) => {
                const oc = ocByInvoice.get(inv.id as string);
                return (
                  <tr key={inv.id as string}>
                    <td>
                      <Link href={`/invoices/${inv.id}`} className="text-action font-medium">
                        {inv.invoice_number as string}
                      </Link>
                    </td>
                    <td>{formatDate(inv.invoice_date as string)}</td>
                    <td>
                      {oc ? (
                        <Link href={`/orders/${oc.id}`} className="text-action text-[var(--primary)]">
                          {oc.code}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="num">{formatMoney(inv.total as number, inv.currency as never)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {op.notes ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[13px]">
          <div className="text-[11px] text-[var(--muted)] mb-1">Notas</div>
          {op.notes}
        </div>
      ) : null}
    </div>
  );
}
