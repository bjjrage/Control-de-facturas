import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, SalesDocumentItem, SalesReceipt } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import {
  docSaldo,
  isOverdue,
  RECEIPT_METHOD_LABELS,
  SALES_DOC_STATUS_LABELS,
  SALES_DOC_TYPE_LABELS,
  SALES_DOC_PANEL_PATH,
  SALES_DOC_PANEL_TITLE,
} from "@/lib/sales";
import { ReceiptDialog } from "./receipt-dialog";
import { emitSalesDocument, voidSalesDocument, deleteSalesDocument, deleteReceipt } from "../actions";

export default async function VentaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase.from("sales_documents").select("*").eq("id", id).single<SalesDocument>();
  if (!doc) notFound();

  const [{ data: client }, { data: items }, { data: receipts }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", doc.client_id).single<Client>(),
    supabase.from("sales_document_items").select("*").eq("sales_document_id", id).order("created_at").returns<SalesDocumentItem[]>(),
    supabase.from("sales_receipts").select("*").eq("sales_document_id", id).order("receipt_date", { ascending: false }).returns<SalesReceipt[]>(),
  ]);

  const saldo = docSaldo(doc.total, doc.cobrado_amount);
  const isDraft = doc.status === "BORRADOR";
  const canCollect = doc.status === "EMITIDA" || doc.status === "COBRADA_PARCIAL";

  return (
    <div className="max-w-4xl space-y-5">
      <Link href={SALES_DOC_PANEL_PATH[doc.doc_type]} className="inline-flex items-center gap-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
        <ArrowLeft size={13} /> Volver a {SALES_DOC_PANEL_TITLE[doc.doc_type]}
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{doc.code}</h1>
            <Badge tone={doc.status === "COBRADA" ? "ok" : doc.status === "ANULADA" || isDraft ? "neutral" : "warn"}>
              {SALES_DOC_STATUS_LABELS[doc.status]}
            </Badge>
            <span className="text-[12px] text-[var(--muted)]">{SALES_DOC_TYPE_LABELS[doc.doc_type]}</span>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            <Link href={`/clientes/${doc.client_id}`} className="hover:underline">
              {client?.name}
            </Link>{" "}
            · Emitida {formatDate(doc.issue_date)}
            {doc.due_date ? (
              <span className={isOverdue(doc.due_date, doc.status) ? "text-[var(--error)]" : ""}>
                {" "}
                · Vence {formatDate(doc.due_date)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/ventas/${doc.id}/imprimir`}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 h-8 text-[13px] font-medium bg-[var(--panel)] hover:bg-[var(--hover)] border-[var(--border)]"
          >
            <Printer size={14} /> Imprimir
          </Link>
          {isDraft ? (
            <Link href={`/ventas/${doc.id}/editar`}>
              <Button variant="secondary">Editar</Button>
            </Link>
          ) : null}
          {isDraft ? (
            <form
              action={async () => {
                "use server";
                await emitSalesDocument(doc.id);
              }}
            >
              <Button type="submit">Emitir</Button>
            </form>
          ) : null}
          {canCollect ? (
            <ReceiptDialog docId={doc.id} saldo={saldo} currency={doc.currency} trigger={<Button>Registrar cobro</Button>} />
          ) : null}
          {doc.status !== "ANULADA" && doc.status !== "COBRADA" && doc.cobrado_amount === 0 ? (
            <form
              action={async () => {
                "use server";
                await voidSalesDocument(doc.id);
              }}
            >
              <Button variant="ghost" type="submit" className="text-[12px]">
                Anular
              </Button>
            </form>
          ) : null}
          {isDraft && profile.role === "admin" ? (
            <form
              action={async () => {
                "use server";
                await deleteSalesDocument(doc.id);
              }}
            >
              <Button variant="ghost" type="submit" className="text-[12px] text-[var(--error)]">
                Eliminar
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-4 gap-3 text-[13px]">
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Neto gravado</div>
          <div className="num">{formatMoney(doc.subtotal, doc.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">IVA</div>
          <div className="num">{formatMoney(doc.vat_amount, doc.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Total</div>
          <div className="num font-semibold">{formatMoney(doc.total, doc.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Saldo por cobrar</div>
          <div className={`num ${saldo > 0 ? "text-[var(--warn)]" : "text-[var(--ok)]"}`}>{formatMoney(saldo, doc.currency)}</div>
        </div>
      </div>

      <div>
        <h2 className="text-[14px] font-semibold mb-2">Ítems</h2>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th className="num">Cant.</th>
                <th className="num">Precio unit.</th>
                <th>IVA</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it) => (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{formatMoney(it.unit_price, doc.currency)}</td>
                  <td>{it.vat_rate === 0 ? "Exenta" : `${it.vat_rate}%`}</td>
                  <td className="num">{formatMoney(it.line_total, doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Cobros</h2>
          {canCollect ? (
            <ReceiptDialog
              docId={doc.id}
              saldo={saldo}
              currency={doc.currency}
              trigger={<button className="text-[12px] text-[var(--primary)] hover:underline">+ Registrar cobro</button>}
            />
          ) : null}
        </div>
        {(receipts ?? []).length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-6 text-center text-[13px] text-[var(--muted)]">
            Sin cobros registrados.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Medio</th>
                  <th>Referencia</th>
                  <th className="num">Monto</th>
                  {profile.role === "admin" ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {(receipts ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.receipt_date)}</td>
                    <td>{RECEIPT_METHOD_LABELS[r.method]}</td>
                    <td>{r.reference ?? "-"}</td>
                    <td className="num">{formatMoney(r.amount, doc.currency)}</td>
                    {profile.role === "admin" ? (
                      <td>
                        <form
                          action={async () => {
                            "use server";
                            await deleteReceipt(r.id, doc.id);
                          }}
                        >
                          <button className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]">Eliminar</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {doc.notes ? (
        <div className="text-[13px]">
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Observaciones</div>
          {doc.notes}
        </div>
      ) : null}
    </div>
  );
}
