"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OcRecepcion } from "@/lib/types";
import { confirmedReceiptTotals } from "@/lib/inventory/receipt-read-model";
import { compareInvoiceQuantitySum, formatInvoiceQuantity, subtractInvoiceQuantitySumExact } from "@/lib/invoice-item-reconcile";
import { RegisterReceiptDialog, RecepcionSection, type ReceiptEvidenceView } from "@/app/(internal)/orders/[id]/recepcion-section";
import type { ProjectReceiptItem, ProjectReceiptOrder } from "./project-receipts-section";

export function ProjectReceiptsList({ projectId, orders, items, receipts, products, evidenceByReceipt, currentUserId, hasLocation }: {
  projectId: string; orders: ProjectReceiptOrder[]; items: ProjectReceiptItem[]; receipts: OcRecepcion[];
  products: { id: string; nombre: string; unidad: string; activo: boolean }[];
  evidenceByReceipt: Record<string, ReceiptEvidenceView[]>; currentUserId: string; hasLocation: boolean;
}) {
  const [showComplete, setShowComplete] = useState(false);
  const router = useRouter();
  const rows = orders.map(order => {
    const lines = items.filter(item => item.order_id === order.id);
    const history = receipts.filter(receipt => receipt.order_id === order.id);
    const totals = confirmedReceiptTotals(history);
    const pending = lines.filter(item => {
      const comparison = compareInvoiceQuantitySum([(totals[item.id] ?? 0).toFixed(4)], item.quantity_text);
      return comparison === -1 || comparison === null;
    });
    return { order, lines, history, totals, pending };
  });
  const visible = rows.filter(row => showComplete || row.pending.length || !row.lines.length || row.history.some(receipt => receipt.status === "DRAFT"));
  return <section className="space-y-4">
    <header className="flex flex-wrap justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Recepciones de la obra</h2><p className="text-sm text-[var(--muted)]">Registrá lo recibido contra su OC. Cada entrega conserva proveedor, obra y cantidades pendientes.</p></div>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showComplete} onChange={event => setShowComplete(event.target.checked)} /> Mostrar completas</label>
    </header>
    {!hasLocation && <p role="alert" className="rounded-lg border-2 border-amber-400/60 bg-amber-400/10 p-3 text-sm">Esta obra no tiene un depósito activo configurado. La confirmación de entradas de stock requiere ese destino.</p>}
    <div className="rounded-xl border-2 border-[#66839e] bg-[#20364b] overflow-x-auto">
      <table><thead><tr><th>OC / proveedor</th><th>Pendiente de recibir</th><th>Acciones</th></tr></thead>
        <tbody>{visible.map(({ order, lines, history, totals, pending }) => <tr key={order.id} className="hover:bg-white/5">
          <td><Link className="text-action font-semibold" href={`/projects/${projectId}/orders/${order.id}`}>{order.code}</Link><p className="text-xs text-[var(--muted)]">{order.provider_name}</p></td>
          <td>{!lines.length ? "OC histórica sin detalle de ítems" : pending.length ? pending.map(item => <p key={item.id}>{item.product}: <strong>{formatInvoiceQuantity(subtractInvoiceQuantitySumExact(item.quantity_text, [(totals[item.id] ?? 0).toFixed(4)]))} {item.unit}</strong></p>) : "Entrega completa"}</td>
          <td><div className="space-y-2">
            {pending.length > 0 && <RegisterReceiptDialog orderId={order.id} orderItems={lines} receivedTotals={totals} onDone={() => router.refresh()} orderCode={order.code} />}
            <details><summary className="cursor-pointer text-sm font-medium">Historial y remitos ({history.length})</summary><div className="mt-3 min-w-80">
              <RecepcionSection orderId={order.id} orderItems={lines} recepciones={history} currentUserId={currentUserId}
                canDelete canConfirm canMap canCreatePortal products={products} evidenceByReceipt={evidenceByReceipt} showRegistration={false} />
            </div></details>
          </div></td>
        </tr>)}{!visible.length && <tr><td colSpan={3} className="py-6 text-center text-[var(--muted)]">{orders.length ? "No hay entregas pendientes." : "Todavía no hay órdenes de compra para esta obra."}</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
