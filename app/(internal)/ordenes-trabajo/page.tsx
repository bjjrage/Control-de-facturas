import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, WorkOrder, WorkOrderStatus } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/ui/back-button";
import { WORK_ORDER_STATUS_LABELS } from "@/lib/quotation";

const ORDER: WorkOrderStatus[] = ["PENDIENTE", "EN_CURSO", "COMPLETADA", "CANCELADA"];

const TONE: Record<WorkOrderStatus, "neutral" | "warn" | "ok" | "error"> = {
  PENDIENTE: "warn",
  EN_CURSO: "warn",
  COMPLETADA: "ok",
  CANCELADA: "neutral",
};

export default async function OrdenesTrabajoPage() {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: orders }, { data: clients }, { data: quotes }] = await Promise.all([
    supabase.from("work_orders").select("*").order("created_at", { ascending: false }).returns<WorkOrder[]>(),
    supabase.from("clients").select("id, name").returns<Pick<Client, "id" | "name">[]>(),
    supabase.from("sales_documents").select("id, code").returns<Pick<SalesDocument, "id" | "code">[]>(),
  ]);

  const list = orders ?? [];
  const clientById = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const quoteById = new Map((quotes ?? []).map((q) => [q.id, q.code]));
  const groups = ORDER.map((s) => ({ status: s, rows: list.filter((o) => o.status === s) })).filter(
    (g) => g.rows.length > 0
  );

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <BackButton />
        <div className="mt-1">
          <h1 className="text-[17px] font-semibold">Órdenes de Trabajo</h1>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            Documento interno generado automáticamente al aceptar una cotización. No se comparte con el cliente.
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          Todavía no hay Órdenes de Trabajo. Se generan solas cuando un cliente acepta una proforma desde su
          link seguro.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.status}>
            <div className="flex items-center gap-2 mb-2">
              <Badge tone={TONE[g.status]}>{WORK_ORDER_STATUS_LABELS[g.status]}</Badge>
              <span className="text-[12px] text-[var(--muted)]">({g.rows.length})</span>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden mb-4">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cliente</th>
                    <th>Cotización</th>
                    <th className="num">Total</th>
                    <th>Creada</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/ordenes-trabajo/${o.id}`} className="text-action font-medium">
                          {o.code}
                        </Link>
                      </td>
                      <td>{clientById.get(o.client_id) ?? "-"}</td>
                      <td className="text-[var(--muted)]">{quoteById.get(o.sales_document_id) ?? "-"}</td>
                      <td className="num">{formatMoney(o.total, o.currency)}</td>
                      <td>{formatDate(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
