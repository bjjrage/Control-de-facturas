"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";
import {
  confirmCanonicalReceipt,
  createReceiptPortalLink,
  updateReceiptProductMapping,
} from "@/app/(internal)/inventory/actions";
import { PortalLinkActions } from "../portal-link-actions";

export type RecepcionRow = {
  id: string;
  producto: string;
  unidad: string;
  quantity: number;
  location_name: string;
  confirmed_at: string;
  cost_currency: string | null;
  cost_total: number | null;
  order_code: string | null;
  order_id: string | null;
  provider_name: string | null;
};

export type ReceiptEligibleOrder = {
  id: string;
  code: string;
  providerName: string;
  pendingLineCount: number;
};

export type PendingReceiptRow = {
  id: string;
  order_id: string;
  order_code: string;
  provider_name: string;
  date: string;
  received_by: string;
  remision_number: string | null;
  notes: string | null;
  items: {
    id: string;
    product: string;
    unit: string;
    quantity: number;
    product_id: string | null;
  }[];
  evidence: { id: string; file_name: string; url: string }[];
};

export type ReceiptCatalogProduct = { id: string; nombre: string; unidad: string | null };

export function RecepcionesObraSection({
  rows,
  eligibleOrders,
  pendingReceipts,
  products,
}: {
  rows: RecepcionRow[];
  eligibleOrders: ReceiptEligibleOrder[];
  pendingReceipts: PendingReceiptRow[];
  products: ReceiptCatalogProduct[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(eligibleOrders[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function generateLink() {
    if (!selectedOrderId || creating) return;
    setCreating(true);
    setError(null);
    setLinkUrl(null);
    try {
      const result = await createReceiptPortalLink(selectedOrderId);
      if (result.error || !result.url) {
        setError(result.error ?? "No se pudo crear el enlace.");
        return;
      }
      setLinkUrl(result.url);
    } catch {
      setError("No se pudo crear el enlace. Intentá nuevamente.");
    } finally {
      setCreating(false);
    }
  }

  async function mapProduct(receiptId: string, itemId: string, productId: string) {
    if (!productId) return;
    const key = `${receiptId}:${itemId}`;
    setSavingItem(key);
    setReviewError(null);
    try {
      const result = await updateReceiptProductMapping({ receiptId, itemId, productId });
      if (result.error) {
        setReviewError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setReviewError("No se pudo guardar la asociación del producto.");
    } finally {
      setSavingItem(null);
    }
  }

  async function confirm(receiptId: string) {
    setConfirming(receiptId);
    setReviewError(null);
    try {
      const result = await confirmCanonicalReceipt({ receiptId });
      if (result.error) {
        setReviewError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setReviewError("No se pudo confirmar la recepción. Revisá el estado y volvé a intentar.");
    } finally {
      setConfirming(null);
    }
  }

  const isEmpty = rows.length === 0 && pendingReceipts.length === 0;
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Recepciones de la obra</h2>
            {isEmpty ? <p className="mt-1 text-[13px] text-[var(--muted)]">No hay recepciones todavía.</p> : null}
          </div>
          <Button type="button" onClick={() => { setError(null); setLinkUrl(null); setDialogOpen(true); }}>
            Enviar link de recepción
          </Button>
        </div>
        {linkUrl ? <div className="mt-3"><PortalLinkActions url={linkUrl} label="Recepción de mercadería" /></div> : null}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title="Enviar link de recepción">
          <div className="space-y-4">
            {eligibleOrders.length ? (
              <>
                <label className="block text-xs">
                  Orden de compra con saldo pendiente
                  <select
                    className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--panel-2)] p-2 text-sm"
                    value={selectedOrderId}
                    onChange={(event) => setSelectedOrderId(event.target.value)}
                  >
                    {eligibleOrders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.code} · {order.providerName} · {order.pendingLineCount} {order.pendingLineCount === 1 ? "línea" : "líneas"} pendientes
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="button" onClick={generateLink} disabled={creating || !selectedOrderId}>
                  {creating ? "Creando enlace…" : "Crear enlace seguro"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">No hay órdenes de esta obra con cantidades pendientes para recibir.</p>
            )}
            {error ? <p role="alert" className="text-xs text-[var(--error)]">{error}</p> : null}
            {linkUrl ? <PortalLinkActions url={linkUrl} label="Recepción de mercadería" /> : null}
          </div>
        </DialogContent>
      </Dialog>

      {reviewError ? <p role="alert" className="rounded border border-[var(--error)]/30 px-3 py-2 text-xs text-[var(--error)]">{reviewError}</p> : null}

      {pendingReceipts.map((receipt) => {
        const allMapped = receipt.items.length > 0 && receipt.items.every((item) => item.product_id != null);
        return (
          <details key={receipt.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)]" open>
            <summary className="cursor-pointer list-none p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{receipt.order_code}</span><Badge tone="warn">Pendiente de confirmar</Badge></div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{receipt.provider_name} · Recibido por {receipt.received_by} · {receipt.date}</p>
                  {receipt.remision_number ? <p className="mt-1 text-xs text-[var(--muted)]">Remisión {receipt.remision_number}</p> : null}
                </div>
                <span className="text-xs text-action">Revisar recepción</span>
              </div>
            </summary>
            <div className="space-y-3 border-t border-[var(--border)] p-4">
              {receipt.notes ? <p className="text-sm">{receipt.notes}</p> : null}
              <div className="space-y-2">
                {receipt.items.map((item) => {
                  const key = `${receipt.id}:${item.id}`;
                  return (
                    <div key={item.id} className="grid gap-2 rounded border border-[var(--border)] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-center">
                      <div>
                        <p className="text-sm">{item.product}</p>
                        <p className="text-xs text-[var(--muted)]">Recibido: {formatNumber(item.quantity, 2)} {item.unit}</p>
                      </div>
                      <label className="text-xs">
                        Producto de inventario
                        <select
                          className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                          value={item.product_id ?? ""}
                          disabled={savingItem === key}
                          onChange={(event) => void mapProduct(receipt.id, item.id, event.target.value)}
                        >
                          <option value="">Seleccionar producto…</option>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.nombre}{product.unidad ? ` · ${product.unidad}` : ""}</option>)}
                        </select>
                      </label>
                    </div>
                  );
                })}
              </div>
              {receipt.evidence.length ? (
                <div>
                  <h3 className="mb-1 text-xs font-medium">Evidencia</h3>
                  <ul className="space-y-1 text-xs">
                    {receipt.evidence.map((file) => <li key={file.id}><a className="text-action underline" href={file.url} target="_blank" rel="noreferrer">{file.file_name}</a></li>)}
                  </ul>
                </div>
              ) : <p className="text-xs text-[var(--muted)]">No se adjuntó evidencia.</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="success" disabled={!allMapped || confirming === receipt.id} onClick={() => void confirm(receipt.id)}>
                  {confirming === receipt.id ? "Confirmando…" : "Confirmar recepción"}
                </Button>
                {!allMapped ? <span className="text-xs text-[var(--muted)]">Asociá todas las líneas a un producto para actualizar el stock canónico.</span> : null}
              </div>
            </div>
          </details>
        );
      })}

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <table>
            <thead><tr><th>OC / Proveedor</th><th>Producto</th><th className="num">Cantidad</th><th>Ubicación</th><th className="num">Costo</th><th>Confirmada</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.order_code ?? "OC"}{row.provider_name ? <div className="text-[11px] text-[var(--muted)]">{row.provider_name}</div> : null}</td>
                  <td>{row.producto} <span className="text-[11px] text-[var(--muted)]">{row.unidad}</span></td>
                  <td className="num">{formatNumber(row.quantity, 2)}</td>
                  <td className="text-[var(--muted)]">{row.location_name}</td>
                  <td className="num">{row.cost_total != null ? formatMoney(row.cost_total, (row.cost_currency ?? "PYG") as CurrencyCode) : "—"}</td>
                  <td className="text-[var(--muted)]">{formatDateTime(row.confirmed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
