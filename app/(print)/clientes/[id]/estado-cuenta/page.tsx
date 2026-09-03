import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, Empresa, SalesDocument, SalesReceipt } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { docSaldo, SALES_DOC_TYPE_LABELS, SALES_DOC_STATUS_LABELS } from "@/lib/sales";
import { LOGO_STORAGE_PATH } from "@/components/layout/branding-constants";
import { PrintTrigger } from "@/app/(print)/ventas/[id]/imprimir/print-trigger";

export default async function EstadoCuentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single<Client>();
  if (!client) notFound();

  const [{ data: docs }, { data: empresa }] = await Promise.all([
    supabase
      .from("sales_documents")
      .select("*")
      .eq("client_id", id)
      .order("issue_date", { ascending: true })
      .returns<SalesDocument[]>(),
    supabase
      .from("empresas")
      .select("*")
      .eq("id", profile.empresa_id)
      .single<Empresa>(),
  ]);

  const allDocs = docs ?? [];
  const docIds = allDocs.map((d) => d.id);

  const { data: receipts } = docIds.length
    ? await supabase
        .from("sales_receipts")
        .select("*")
        .in("sales_document_id", docIds)
        .order("receipt_date")
        .returns<SalesReceipt[]>()
    : { data: [] as SalesReceipt[] };

  const receiptsByDoc = new Map<string, SalesReceipt[]>();
  for (const r of receipts ?? []) {
    if (!receiptsByDoc.has(r.sales_document_id)) {
      receiptsByDoc.set(r.sales_document_id, []);
    }
    receiptsByDoc.get(r.sales_document_id)!.push(r);
  }

  const logoUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${LOGO_STORAGE_PATH}`
    : "";

  const today = new Date().toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // Totals by currency for pending docs
  const pendingByCurrency = new Map<string, number>();
  for (const d of allDocs) {
    if (d.status !== "EMITIDA" && d.status !== "COBRADA_PARCIAL") continue;
    const saldo = docSaldo(d.total, d.cobrado_amount);
    if (saldo <= 0) continue;
    pendingByCurrency.set(
      d.currency,
      (pendingByCurrency.get(d.currency) ?? 0) + saldo
    );
  }

  return (
    <div
      className="mx-auto max-w-3xl bg-white text-black p-8 text-[12px] print:p-0"
      style={{ colorScheme: "light" }}
    >
      <PrintTrigger />

      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-4">
        <div>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo"
              className="h-10 max-w-[140px] object-contain mb-1"
            />
          ) : null}
          <div className="text-[16px] font-bold">{empresa?.nombre ?? "—"}</div>
          {empresa?.ruc ? <div>RUC: {empresa.ruc}</div> : null}
          {empresa?.direccion ? <div>{empresa.direccion}</div> : null}
          {empresa?.telefono ? <div>Tel: {empresa.telefono}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-[18px] font-bold">ESTADO DE CUENTA</div>
          <div className="text-[11px] text-black/60 mt-0.5">
            Al {today}
          </div>
        </div>
      </div>

      {/* Client */}
      <div className="border border-black/20 rounded p-3 mb-4">
        <div className="text-[11px] text-black/50 mb-0.5">CLIENTE</div>
        <div className="text-[14px] font-semibold">{client.name}</div>
        {client.tax_id ? <div>RUC / CI: {client.tax_id}</div> : null}
        {client.address ? <div>{client.address}</div> : null}
        {client.email ? <div>{client.email}</div> : null}
      </div>

      {/* Documents table */}
      {allDocs.length > 0 ? (
        <table className="w-full border-collapse mb-4">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1.5 pr-2">Código</th>
              <th className="py-1.5 pr-2">Tipo</th>
              <th className="py-1.5 pr-2">Emisión</th>
              <th className="py-1.5 pr-2">Vencimiento</th>
              <th className="py-1.5 pr-2 text-right">Total</th>
              <th className="py-1.5 pr-2 text-right">Cobrado</th>
              <th className="py-1.5 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {allDocs.map((d) => {
              const saldo = docSaldo(d.total, d.cobrado_amount);
              const isPending =
                d.status === "EMITIDA" || d.status === "COBRADA_PARCIAL";
              const isAnulada = d.status === "ANULADA";
              return (
                <tr
                  key={d.id}
                  className={`border-b border-black/10 ${isAnulada ? "opacity-40" : ""}`}
                >
                  <td className="py-1 pr-2 font-medium">{d.code}</td>
                  <td className="py-1 pr-2">
                    {SALES_DOC_TYPE_LABELS[d.doc_type]}
                  </td>
                  <td className="py-1 pr-2">{formatDate(d.issue_date)}</td>
                  <td className="py-1 pr-2">
                    {d.due_date ? formatDate(d.due_date) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {isAnulada ? "—" : formatMoney(d.total, d.currency)}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {d.cobrado_amount > 0
                      ? formatMoney(d.cobrado_amount, d.currency)
                      : "—"}
                  </td>
                  <td
                    className={`py-1 text-right font-semibold ${isPending && saldo > 0 ? "text-red-700" : ""}`}
                  >
                    {isAnulada
                      ? "Anulada"
                      : saldo > 0
                        ? formatMoney(saldo, d.currency)
                        : d.status === "COBRADA"
                          ? "✓ Cobrado"
                          : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-black/50 text-center py-6">
          Sin documentos registrados.
        </p>
      )}

      {/* Summary */}
      {pendingByCurrency.size > 0 ? (
        <div className="ml-auto w-64 border-t-2 border-black pt-2">
          <div className="text-[11px] text-black/50 mb-1 uppercase tracking-wide">
            Total por cobrar
          </div>
          {[...pendingByCurrency.entries()].map(([currency, amount]) => (
            <div key={currency} className="flex justify-between text-[14px] font-bold">
              <span>{currency}</span>
              <span>{formatMoney(amount, currency)}</span>
            </div>
          ))}
        </div>
      ) : allDocs.length > 0 ? (
        <div className="ml-auto w-64 border-t-2 border-black pt-2 text-[13px] text-green-700 font-semibold text-right">
          ✓ Sin saldo pendiente
        </div>
      ) : null}

      {/* Receipts detail */}
      {(receipts ?? []).length > 0 ? (
        <div className="mt-6">
          <div className="text-[11px] text-black/50 uppercase tracking-wide mb-1">
            Detalle de pagos recibidos
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-black/30 text-left">
                <th className="py-1 pr-2 text-[11px]">Documento</th>
                <th className="py-1 pr-2 text-[11px]">Fecha</th>
                <th className="py-1 pr-2 text-[11px]">Método</th>
                <th className="py-1 pr-2 text-[11px]">Referencia</th>
                <th className="py-1 text-right text-[11px]">Monto</th>
              </tr>
            </thead>
            <tbody>
              {allDocs.map((d) =>
                (receiptsByDoc.get(d.id) ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-black/10">
                    <td className="py-0.5 pr-2 text-[11px]">{d.code}</td>
                    <td className="py-0.5 pr-2 text-[11px]">
                      {formatDate(r.receipt_date)}
                    </td>
                    <td className="py-0.5 pr-2 text-[11px] capitalize">
                      {r.method.toLowerCase()}
                    </td>
                    <td className="py-0.5 pr-2 text-[11px]">
                      {r.reference ?? "—"}
                    </td>
                    <td className="py-0.5 text-right text-[11px]">
                      {formatMoney(r.amount, d.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-8 text-[10px] text-black/40">
        Estado de cuenta generado el {today} — {empresa?.nombre ?? ""}
      </div>
    </div>
  );
}
