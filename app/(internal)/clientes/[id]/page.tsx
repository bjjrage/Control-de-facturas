import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { docSaldo, SALES_DOC_STATUS_LABELS, SALES_DOC_TYPE_LABELS, isOverdue } from "@/lib/sales";
import { ClientDialog } from "../client-dialog";
import { updateClientRecord } from "../actions";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase.from("clients").select("*").eq("id", id).single<Client>();
  if (!client) notFound();

  const { data: docs } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("client_id", id)
    .order("issue_date", { ascending: false })
    .returns<SalesDocument[]>();

  const porCobrar = (docs ?? [])
    .filter((d) => d.status === "EMITIDA" || d.status === "COBRADA_PARCIAL")
    .reduce((s, d) => s + docSaldo(d.total, d.cobrado_amount), 0);

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/clientes" className="inline-flex items-center gap-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
        <ArrowLeft size={13} /> Volver a Clientes
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{client.name}</h1>
            <Badge tone={client.active ? "ok" : "neutral"}>{client.active ? "Activo" : "Inactivo"}</Badge>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {client.tax_id ? `RUC ${client.tax_id} · ` : ""}
            {client.email ?? "sin email"}
            {client.phone ? ` · ${client.phone}` : ""}
          </p>
        </div>
        <ClientDialog
          client={client}
          action={updateClientRecord.bind(null, client.id)}
          trigger={<Button variant="secondary">Editar</Button>}
        />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-3 gap-3 text-[13px]">
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Condición de pago</div>
          <div>{client.payment_terms ?? "-"}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Contacto</div>
          <div>{client.contact_name ?? "-"}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Saldo por cobrar</div>
          <div className={`num ${porCobrar > 0 ? "text-[var(--warn)]" : ""}`}>{formatMoney(porCobrar, "PYG")}</div>
        </div>
        {client.address ? (
          <div className="col-span-3">
            <div className="text-[11px] text-[var(--muted)] mb-0.5">Dirección</div>
            <div>{client.address}</div>
          </div>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Documentos de venta</h2>
          <div className="flex items-center gap-3">
            <Link
              href={`/clientes/${client.id}/estado-cuenta`}
              target="_blank"
              className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)] hover:underline"
            >
              Estado de cuenta ↗
            </Link>
            <Link href={`/proformas/nueva?client=${client.id}`} className="text-[12px] text-[var(--primary)] hover:underline">
              Nueva proforma →
            </Link>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Emisión</th>
                <th>Vencimiento</th>
                <th className="num">Total</th>
                <th className="num">Saldo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {(docs ?? []).map((d) => {
                const saldo = docSaldo(d.total, d.cobrado_amount);
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/ventas/${d.id}`} className="font-medium hover:underline">
                        {d.code}
                      </Link>
                    </td>
                    <td>{SALES_DOC_TYPE_LABELS[d.doc_type]}</td>
                    <td>{formatDate(d.issue_date)}</td>
                    <td className={isOverdue(d.due_date, d.status) ? "text-[var(--error)]" : ""}>
                      {d.due_date ? formatDate(d.due_date) : "-"}
                    </td>
                    <td className="num">{formatMoney(d.total, d.currency)}</td>
                    <td className="num">{formatMoney(saldo, d.currency)}</td>
                    <td>
                      <Badge
                        tone={
                          d.status === "COBRADA" ? "ok" : d.status === "ANULADA" ? "neutral" : d.status === "BORRADOR" ? "neutral" : "warn"
                        }
                      >
                        {SALES_DOC_STATUS_LABELS[d.status]}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {(docs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                    Sin documentos todavía.
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
