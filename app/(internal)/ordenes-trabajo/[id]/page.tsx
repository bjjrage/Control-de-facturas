import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, WorkOrder, WorkOrderItem, WorkOrderStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, Label } from "@/components/ui/input";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { APPROVAL_MODE_LABELS, WORKFLOW_STATUS_LABELS, WORK_ORDER_STATUS_LABELS } from "@/lib/quotation";
import { updateWorkOrderStatus } from "@/app/(internal)/ventas/[id]/quotation-actions";
import { WorkOrderApproveButton } from "./approve-button";

const TONE: Record<WorkOrderStatus, "neutral" | "warn" | "ok" | "error"> = {
  PENDIENTE: "warn",
  EN_CURSO: "warn",
  COMPLETADA: "ok",
  CANCELADA: "neutral",
};

export default async function OrdenTrabajoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("ventas", ["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase.from("work_orders").select("*").eq("id", id).single<WorkOrder>();
  if (!order) notFound();

  const [{ data: client }, { data: items }, { data: quote }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", order.client_id).single<Client>(),
    supabase.from("work_order_items").select("*").eq("work_order_id", id).order("created_at").returns<WorkOrderItem[]>(),
    supabase.from("sales_documents").select("id, code, quotation_version, acceptance_status, accepted_by_name, accepted_at").eq("id", order.sales_document_id).single<Pick<SalesDocument, "id" | "code" | "quotation_version" | "acceptance_status" | "accepted_by_name" | "accepted_at">>(),
  ]);

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/ordenes-trabajo" className="text-action text-[12px] text-[var(--muted)]">
        <ArrowLeft size={13} /> Volver a Órdenes de Trabajo
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{order.code}</h1>
            <Badge tone={TONE[order.status]}>{WORK_ORDER_STATUS_LABELS[order.status]}</Badge>
            <span className="text-[12px] text-[var(--muted)]">Documento interno</span>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            Cliente: {client?.name ?? "-"} · Cotización{" "}
            {quote ? (
              <Link href={`/ventas/${quote.id}`} className="text-action">
                {quote.code} v{quote.quotation_version}
              </Link>
            ) : (
              "-"
            )}{" "}
            · Creada {formatDate(order.created_at)}
          </p>
        </div>
        <form
          action={async (fd: FormData) => {
            "use server";
            const s = String(fd.get("status") ?? order.status) as WorkOrderStatus;
            await updateWorkOrderStatus(order.id, s);
          }}
          className="flex items-end gap-2"
        >
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={order.status} className="w-40">
              {(Object.keys(WORK_ORDER_STATUS_LABELS) as WorkOrderStatus[]).map((s) => (
                <option key={s} value={s}>
                  {WORK_ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Guardar
          </Button>
        </form>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-4 gap-3 text-[13px]">
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Neto</div>
          <div className="num">{formatMoney(order.subtotal, order.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">IVA</div>
          <div className="num">{formatMoney(order.vat_amount, order.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Total</div>
          <div className="num font-semibold">{formatMoney(order.total, order.currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Origen</div>
          <div className="text-[12px]">Aceptación electrónica</div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold">Workflow interno</h2>
          <Badge tone={order.workflow_status === "READY_FOR_PRODUCTION" ? "ok" : "warn"}>
            {WORKFLOW_STATUS_LABELS[order.workflow_status]}
          </Badge>
        </div>
        <div className="text-[13px] text-[var(--muted)]">
          Política: {APPROVAL_MODE_LABELS[order.approval_mode]} · Responsable: rol {order.responsible_role}
          {order.approved_at ? ` · Aprobada ${formatDateTime(order.approved_at)}` : ""}
        </div>
        {order.workflow_status === "PENDING_INTERNAL_APPROVAL" ? (
          <WorkOrderApproveButton workOrderId={order.id} />
        ) : null}
      </div>

      <div>
        <h2 className="text-[14px] font-semibold mb-2">Ítems (fotografía de la cotización aceptada)</h2>
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
                  <td className="num">{formatMoney(it.unit_price, order.currency)}</td>
                  <td>{it.vat_rate === 0 ? "Exenta" : `${it.vat_rate}%`}</td>
                  <td className="num">{formatMoney(it.line_total, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.notes ? (
        <div className="text-[13px]">
          <div className="text-[11px] text-[var(--muted)] mb-0.5">Notas internas</div>
          {order.notes}
        </div>
      ) : null}

      <p className="text-[11px] text-[var(--muted)]">
        La Orden de Trabajo es interna y nunca se comparte por link con el cliente. El cliente solo aceptó la
        cotización {quote?.code ?? ""}.
      </p>
    </div>
  );
}
