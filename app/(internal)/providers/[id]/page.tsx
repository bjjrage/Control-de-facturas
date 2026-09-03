import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Provider } from "@/lib/types";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/format";
import { AttachmentLink } from "./attachment-link";

export default async function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: provider } = await supabase.from("providers").select("*").eq("id", id).single<Provider>();
  if (!provider) notFound();

  const { data: rfqProviders } = await supabase
    .from("rfq_providers")
    .select("id, rfq_id, status, rfqs!rfq_providers_rfq_id_fkey(id, code, product, status)")
    .eq("provider_id", id)
    .returns<
      {
        id: string;
        rfq_id: string;
        status: string;
        rfqs: { id: string; code: string; product: string; status: string };
      }[]
    >();

  const rfqProviderById = new Map((rfqProviders ?? []).map((rp) => [rp.id, rp]));
  const rfqProviderIds = (rfqProviders ?? []).map((rp) => rp.id);
  const allRfqIds = [...new Set((rfqProviders ?? []).map((rp) => rp.rfq_id))];

  let versions: {
    id: string;
    quote_id: string; // holds rfq_provider_id after the remap below
    version_number: number;
    budget_number: string;
    unit_price: number;
    total_price: number;
    currency: string;
    delivery_time: string;
    submitted_at: string;
    pdf_attachment_id: string;
  }[] = [];

  if (rfqProviderIds.length > 0) {
    const { data: quotes } = await supabase
      .from("quotes")
      .select("id, rfq_provider_id")
      .in("rfq_provider_id", rfqProviderIds);
    const quoteIdToRfqProvider = new Map((quotes ?? []).map((q) => [q.id, q.rfq_provider_id]));

    if (quotes && quotes.length > 0) {
      const { data } = await supabase
        .from("quote_versions")
        .select(
          "id, quote_id, version_number, budget_number, unit_price, total_price, currency, delivery_time, submitted_at, pdf_attachment_id"
        )
        .in(
          "quote_id",
          quotes.map((q) => q.id)
        )
        .order("submitted_at", { ascending: false });
      versions = (data ?? []).map((v) => ({ ...v, quote_id: quoteIdToRfqProvider.get(v.quote_id) ?? v.quote_id }));
    }
  }

  // This provider's own authorized (won) orders.
  const { data: providerOrders } = await supabase
    .from("authorized_orders")
    .select("id, quote_version_id")
    .eq("provider_id", id);
  const orderIdByVersionId = new Map(
    (providerOrders ?? []).filter((o) => o.quote_version_id).map((o) => [o.quote_version_id, o.id])
  );
  const wonVersionIds = new Set(orderIdByVersionId.keys());

  // Whether each RFQ this provider was invited to has *any* winner yet
  // (possibly a different provider) — needed to tell "still deciding" apart
  // from "lost".
  const { data: decidedOrders } =
    allRfqIds.length > 0
      ? await supabase.from("authorized_orders").select("rfq_id").in("rfq_id", allRfqIds)
      : { data: [] as { rfq_id: string }[] };
  const decidedRfqIds = new Set((decidedOrders ?? []).map((o) => o.rfq_id));

  // Invoice reconciled against each of this provider's won orders, if any.
  const providerOrderIds = (providerOrders ?? []).map((o) => o.id);
  const { data: matches } =
    providerOrderIds.length > 0
      ? await supabase.from("invoice_order_matches").select("authorized_order_id, invoice_id").in("authorized_order_id", providerOrderIds)
      : { data: [] as { authorized_order_id: string; invoice_id: string }[] };
  const invoiceIdByOrderId = new Map((matches ?? []).map((m) => [m.authorized_order_id, m.invoice_id]));

  const invoiceIds = [...new Set((matches ?? []).map((m) => m.invoice_id))];
  const { data: invoices } =
    invoiceIds.length > 0
      ? await supabase.from("invoices").select("id, invoice_number, attachment_id").in("id", invoiceIds)
      : { data: [] as { id: string; invoice_number: string; attachment_id: string | null }[] };
  const invoiceById = new Map((invoices ?? []).map((i) => [i.id, i]));

  const allAttachmentIds = [
    ...new Set([
      ...versions.map((v) => v.pdf_attachment_id).filter(Boolean),
      ...(invoices ?? []).map((i) => i.attachment_id).filter((x): x is string => !!x),
    ]),
  ];
  const { data: attachments } =
    allAttachmentIds.length > 0
      ? await supabase.from("attachments").select("id, bucket, path, file_name").in("id", allAttachmentIds)
      : { data: [] as { id: string; bucket: string; path: string; file_name: string }[] };
  const attachmentById = new Map((attachments ?? []).map((a) => [a.id, a]));

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/providers" className="text-action text-[12px] text-[var(--muted)]">
          ← Proveedores
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-[17px] font-semibold">{provider.name}</h1>
          <Badge tone={provider.active ? "ok" : "neutral"}>{provider.active ? "Activo" : "Inactivo"}</Badge>
        </div>
        <p className="text-[13px] text-[var(--muted)]">
          {provider.contact_name ?? "-"} · {provider.email ?? "-"} · {provider.phone ?? "-"} · RUC {provider.tax_id ?? "-"}
        </p>
      </div>

      <div>
        <h2 className="text-[14px] font-semibold mb-2">Historial de cotizaciones</h2>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>RFQ</th>
                <th>Producto</th>
                <th>Presupuesto</th>
                <th className="num">Precio unit.</th>
                <th className="num">Total</th>
                <th>Entrega</th>
                <th>Enviada</th>
                <th>Cotización</th>
                <th>Factura</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const rp = rfqProviderById.get(v.quote_id);
                const won = wonVersionIds.has(v.id);
                const decided = rp ? decidedRfqIds.has(rp.rfqs.id) : false;
                const quotePdf = attachmentById.get(v.pdf_attachment_id);

                const orderId = orderIdByVersionId.get(v.id);
                const invoiceId = orderId ? invoiceIdByOrderId.get(orderId) : undefined;
                const invoice = invoiceId ? invoiceById.get(invoiceId) : undefined;
                const invoicePdf = invoice?.attachment_id ? attachmentById.get(invoice.attachment_id) : undefined;

                return (
                  <tr key={v.id}>
                    <td>
                      {rp ? (
                        <Link href={`/rfqs/${rp.rfq_id}`} className="text-action">
                          {rp.rfqs.code}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{rp?.rfqs.product ?? "-"}</td>
                    <td>
                      {v.budget_number}
                      {v.version_number > 1 ? ` (v${v.version_number})` : ""}
                    </td>
                    <td className="num">{formatMoney(v.unit_price, v.currency as never)}</td>
                    <td className="num">{formatMoney(v.total_price, v.currency as never)}</td>
                    <td>{v.delivery_time}</td>
                    <td>{formatDate(v.submitted_at)}</td>
                    <td>
                      {quotePdf ? (
                        <AttachmentLink bucket={quotePdf.bucket} path={quotePdf.path} fileName="PDF" />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {invoicePdf ? (
                        <AttachmentLink bucket={invoicePdf.bucket} path={invoicePdf.path} fileName={invoice!.invoice_number} />
                      ) : won ? (
                        <span className="text-[var(--muted)]">Sin factura</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {won ? (
                        <Badge tone="ok">Ganó</Badge>
                      ) : decided ? (
                        <Badge tone="neutral">Perdió</Badge>
                      ) : rp ? (
                        <StatusBadge status={rp.rfqs.status} />
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
              {versions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center text-[var(--muted)] py-6">
                    Este proveedor todavía no envió cotizaciones.
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
