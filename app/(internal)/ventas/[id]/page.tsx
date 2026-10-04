import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, SalesDocumentItem, SalesQuotationAcceptance, SalesQuotationEvent, SalesQuotationToken, SalesReceipt, WorkOrder } from "@/lib/types";
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
import { SifenButton } from "./sifen-button";
import { QuotationPanel } from "./quotation-panel";
import { emitSalesDocument, voidSalesDocument, deleteSalesDocument, reverseReceipt } from "../actions";

export default async function VentaDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id)
    .single<SalesDocument>();
  if (!doc) notFound();

  const [{ data: client }, { data: items }, { data: receipts }, { data: cuentas }, { data: tokens }, { data: events }, { data: workOrder }, { data: acceptance }, { data: sourceDocument }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", doc.client_id).eq("empresa_id", profile.empresa_id).single<Client>(),
    supabase.from("sales_document_items").select("*").eq("sales_document_id", id).eq("empresa_id", profile.empresa_id).order("created_at").returns<SalesDocumentItem[]>(),
    supabase.from("sales_receipts").select("*").eq("sales_document_id", id).eq("empresa_id", profile.empresa_id).order("receipt_date", { ascending: false }).returns<SalesReceipt[]>(),
    supabase.from("cuentas_financieras").select("id, nombre, moneda").eq("empresa_id", profile.empresa_id).eq("activo", true).eq("moneda", doc.currency).order("nombre").returns<{ id: string; nombre: string; moneda: SalesDocument["currency"] }[]>(),
    doc.doc_type === "PROFORMA"
      ? supabase.from("sales_quotation_tokens").select("*").eq("sales_document_id", id).eq("empresa_id", profile.empresa_id).order("created_at", { ascending: false }).returns<SalesQuotationToken[]>()
      : Promise.resolve({ data: [] as SalesQuotationToken[] } as { data: SalesQuotationToken[] }),
    doc.doc_type === "PROFORMA"
      ? supabase.from("sales_quotation_events").select("*").eq("sales_document_id", id).eq("empresa_id", profile.empresa_id).order("created_at", { ascending: false }).limit(30).returns<SalesQuotationEvent[]>()
      : Promise.resolve({ data: [] as SalesQuotationEvent[] } as { data: SalesQuotationEvent[] }),
    doc.doc_type === "PROFORMA"
      ? supabase.from("work_orders").select("*").eq("sales_document_id", id).eq("empresa_id", profile.empresa_id).maybeSingle<WorkOrder>().then((r) => ({ data: (r.data ?? null) as WorkOrder | null }))
      : Promise.resolve({ data: null as WorkOrder | null }),
    doc.doc_type === "PROFORMA"
      ? supabase.from("sales_quotation_acceptances").select("*").eq("sales_document_id", id).eq("empresa_id", profile.empresa_id).maybeSingle<SalesQuotationAcceptance>().then((r) => ({ data: (r.data ?? null) as SalesQuotationAcceptance | null }))
      : Promise.resolve({ data: null as SalesQuotationAcceptance | null }),
    doc.source_document_id
      ? supabase
          .from("sales_documents")
          .select("id, code, doc_type, status")
          .eq("id", doc.source_document_id)
          .eq("empresa_id", profile.empresa_id)
          .maybeSingle<Pick<SalesDocument, "id" | "code" | "doc_type" | "status">>()
      : Promise.resolve({ data: null as Pick<SalesDocument, "id" | "code" | "doc_type" | "status"> | null }),
  ]);
  const cuentasList = cuentas ?? [];

  const saldo = docSaldo(doc.total, doc.cobrado_amount);
  const isDraft = doc.status === "BORRADOR";
  const canCollect = doc.status === "EMITIDA" || doc.status === "COBRADA_PARCIAL";

  return (
    <div className="max-w-4xl space-y-5">
      {actionError ? <p role="alert" className="text-[13px] text-[var(--error)]">{actionError}</p> : null}
      <Link href={SALES_DOC_PANEL_PATH[doc.doc_type]} className="text-action text-[12px] text-[var(--muted)]">
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
            <Link href={`/clientes/${doc.client_id}`} className="text-action">
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
        <div className="flex gap-2 flex-wrap justify-end">
          <Link
            href={`/ventas/${doc.id}/imprimir`}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 h-8 text-[13px] font-medium bg-[var(--panel)] hover:bg-[var(--hover)] border-[var(--border)]"
          >
            <Printer size={14} /> Imprimir
          </Link>
          {doc.doc_type === "PROFORMA" ? (
            <Link href={`/remisiones/nueva?from=${doc.id}`}>
              <Button variant="secondary">Preparar remisión</Button>
            </Link>
          ) : null}
          {doc.doc_type === "REMISION" ? (
            <Link href={`/facturas-venta/nueva?from=${doc.id}`}>
              <Button variant="secondary">Preparar factura</Button>
            </Link>
          ) : null}
          {isDraft ? (
            <Link href={`/ventas/${doc.id}/editar`}>
              <Button variant="secondary">Editar</Button>
            </Link>
          ) : null}
          {isDraft ? (
            <form
              action={async () => {
                "use server";
                const result = await emitSalesDocument(doc.id);
                if (result.error) redirect(`/ventas/${doc.id}?error=${encodeURIComponent(result.error)}`);
              }}
            >
              <Button type="submit">Emitir</Button>
            </form>
          ) : null}
          {doc.doc_type === "FACTURA" &&
          (doc.status === "EMITIDA" || doc.status === "COBRADA_PARCIAL" || doc.status === "COBRADA") ? (
            <Link href={`/ventas/nueva-nc?from=${doc.id}`}>
              <Button variant="secondary">Emitir NC</Button>
            </Link>
          ) : null}
          {(doc.doc_type === "FACTURA" || doc.doc_type === "NOTA_CREDITO") && doc.status !== "ANULADA" ? (
            <SifenButton
              docId={doc.id}
              docType={doc.doc_type}
              cdc={doc.cdc}
              kudeUrl={doc.kude_url}
              xmlUrl={doc.xml_url}
            />
          ) : null}
          {canCollect ? (
            <ReceiptDialog docId={doc.id} saldo={saldo} currency={doc.currency} cuentas={cuentasList} trigger={<Button>Registrar cobro</Button>} />
          ) : null}
          {doc.status !== "ANULADA" && doc.status !== "COBRADA" && doc.cobrado_amount === 0 ? (
            <form
              action={async () => {
                "use server";
                const result = await voidSalesDocument(doc.id);
                if (result.error) redirect(`/ventas/${doc.id}?error=${encodeURIComponent(result.error)}`);
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
                const result = await deleteSalesDocument(doc.id);
                if (result.error) redirect(`/ventas/${doc.id}?error=${encodeURIComponent(result.error)}`);
                redirect(SALES_DOC_PANEL_PATH[doc.doc_type]);
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

      {doc.source_document_id ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-[13px]">
          <span className="text-[var(--muted)]">Documento de origen: </span>
          {sourceDocument ? (
            <Link href={"/ventas/" + sourceDocument.id} className="text-action font-medium">
              {sourceDocument.code} · {SALES_DOC_TYPE_LABELS[sourceDocument.doc_type]}
            </Link>
          ) : (
            <span className="text-[var(--error)]">No disponible dentro de esta empresa.</span>
          )}
        </div>
      ) : null}

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

      {doc.doc_type === "PROFORMA" ? (
        <QuotationPanel doc={doc} tokens={tokens ?? []} events={events ?? []} workOrder={workOrder ?? null} acceptance={acceptance ?? null} />
      ) : null}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Cobros</h2>
          {canCollect ? (
            <ReceiptDialog
              docId={doc.id}
              saldo={saldo}
              currency={doc.currency}
              cuentas={cuentasList}
              trigger={<button className="text-action text-[12px] text-[var(--primary)]">+ Registrar cobro</button>}
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
                  <th>Estado</th>
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
                    <td>
                      {r.reversed_at ? (
                        <span className="rounded bg-[var(--hover)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]" title={r.reversal_reason ?? undefined}>Revertido</span>
                      ) : (
                        <span className="text-[11px] text-[var(--ok)]">Activo</span>
                      )}
                    </td>
                    {profile.role === "admin" ? (
                      <td>
                        {!r.reversed_at ? (
                        <form
                          action={async () => {
                            "use server";
                            await reverseReceipt(r.id, doc.id);
                          }}
                        >
                          <button className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]" title="Registra una reversa; conserva el cobro y su auditoría">Revertir</button>
                        </form>
                        ) : null}
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
