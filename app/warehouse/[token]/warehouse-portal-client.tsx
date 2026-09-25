"use client";

import { useState, type FormEvent } from "react";
import {
  Package,
  Boxes,
  FileText,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowDownRight,
  ArrowUpRight,
  Plus,
  Loader2,
} from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { WarehousePortalContext, WarehousePortalOrder } from "@/lib/inventory/warehouse-portal-data";

type TabMode = "receipt" | "consumption" | "submission";

export function WarehousePortalClient({ context }: { context: WarehousePortalContext }) {
  const [activeTab, setActiveTab] = useState<TabMode>("receipt");

  // State for Receipt tab
  const [selectedOrderId, setSelectedOrderId] = useState<string>(context.orders[0]?.id ?? "");
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptSuccess, setReceiptSuccess] = useState<string | null>(null);

  // State for Consumption tab
  const [selectedProductId, setSelectedProductId] = useState<string>(context.stock[0]?.productId ?? "");
  const [consumptionQty, setConsumptionQty] = useState<string>("");
  const [selectedBudgetItemId, setSelectedBudgetItemId] = useState<string>("");
  const [withdrawnBy, setWithdrawnBy] = useState<string>("");
  const [consumptionNotes, setConsumptionNotes] = useState<string>("");
  const [consumptionSubmitting, setConsumptionSubmitting] = useState(false);
  const [consumptionError, setConsumptionError] = useState<string | null>(null);
  const [consumptionSuccess, setConsumptionSuccess] = useState<string | null>(null);

  // State for Evidence submission tab
  const [submissionSubmitting, setSubmissionSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null);

  const selectedOrder = context.orders.find((o) => o.id === selectedOrderId);
  const selectedStockItem = context.stock.find((s) => s.productId === selectedProductId);

  // Handle Receipt Submission
  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (receiptSubmitting || !selectedOrder) return;
    setReceiptSubmitting(true);
    setReceiptError(null);
    setReceiptSuccess(null);

    const form = new FormData(event.currentTarget);
    form.set("action", "receipt");
    form.set("order_id", selectedOrder.id);

    const itemsToReceive = selectedOrder.items
      .map((item) => ({
        order_item_id: item.id,
        producto_id: item.productId,
        quantity: Number(receiptQuantities[item.id] ?? 0),
      }))
      .filter((item) => item.quantity > 0);

    if (itemsToReceive.length === 0) {
      setReceiptError("Ingresá al menos una cantidad mayor a cero para recibir.");
      setReceiptSubmitting(false);
      return;
    }

    form.set("items", JSON.stringify(itemsToReceive));

    try {
      const response = await fetch(`/api/warehouse-portal/${encodeURIComponent(context.token)}`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) {
        setReceiptError(data.error ?? "No se pudo registrar la recepción.");
      } else {
        setReceiptSuccess(`Recepción registrada con éxito. Se confirmaron los movimientos en ${context.locationName}.`);
        setReceiptQuantities({});
        (event.target as HTMLFormElement).reset();
      }
    } catch {
      setReceiptError("Error de conexión. Revisá tu red e intentá de nuevo.");
    } finally {
      setReceiptSubmitting(false);
    }
  }

  // Handle Consumption / Salida Submission
  async function handleConsumptionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (consumptionSubmitting || !selectedProductId) return;

    const qty = Number(consumptionQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setConsumptionError("Ingresá una cantidad válida mayor a cero.");
      return;
    }

    const available = selectedStockItem ? selectedStockItem.quantity : 0;
    if (available > 0 && qty > available) {
      setConsumptionError(`La cantidad a retirar (${qty}) supera el stock disponible (${available}).`);
      return;
    }

    setConsumptionSubmitting(true);
    setConsumptionError(null);
    setConsumptionSuccess(null);

    const form = new FormData(event.currentTarget);
    form.set("action", "consumption");
    form.set("producto_id", selectedProductId);
    form.set("quantity", String(qty));
    form.set("budget_item_id", selectedBudgetItemId || "");
    form.set("withdrawn_by", withdrawnBy);
    form.set("notes", consumptionNotes);

    try {
      const response = await fetch(`/api/warehouse-portal/${encodeURIComponent(context.token)}`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) {
        setConsumptionError(data.error ?? "No se pudo registrar la salida.");
      } else {
        setConsumptionSuccess("Salida de materiales registrada con éxito y descontada del stock.");
        setConsumptionQty("");
        setWithdrawnBy("");
        setConsumptionNotes("");
        (event.target as HTMLFormElement).reset();
      }
    } catch {
      setConsumptionError("Error de conexión. Revisá tu red e intentá de nuevo.");
    } finally {
      setConsumptionSubmitting(false);
    }
  }

  // Handle Weekly Evidence / Sheet Submission
  async function handleSubmissionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionSubmitting) return;
    setSubmissionSubmitting(true);
    setSubmissionError(null);
    setSubmissionSuccess(null);

    const form = new FormData(event.currentTarget);
    form.set("action", "submission");

    try {
      const response = await fetch(`/api/warehouse-portal/${encodeURIComponent(context.token)}`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) {
        setSubmissionError(data.error ?? "No se pudo enviar la rendición.");
      } else {
        setSubmissionSuccess("Rendición enviada con éxito. La empresa revisará la evidencia.");
        (event.target as HTMLFormElement).reset();
      }
    } catch {
      setSubmissionError("Error de conexión. Revisá tu red e intentá de nuevo.");
    } finally {
      setSubmissionSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--primary)]">
            Portal Operativo de Depósito
          </span>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            Conectado
          </span>
        </div>
        <h1 className="mt-1 text-lg font-bold sm:text-xl">{context.locationName}</h1>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Obra: <span className="font-medium text-[var(--foreground)]">{context.projectName}</span> ({context.projectCode})
        </p>
      </section>

      {/* Operational Mode Segmented Controls */}
      <nav className="grid grid-cols-3 gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-1">
        <button
          type="button"
          onClick={() => setActiveTab("receipt")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all ${
            activeTab === "receipt"
              ? "bg-[var(--panel)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          <Truck size={14} className="shrink-0 text-emerald-500" />
          <span className="truncate">Recibir OC</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("consumption")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all ${
            activeTab === "consumption"
              ? "bg-[var(--panel)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          <ArrowDownRight size={14} className="shrink-0 text-amber-500" />
          <span className="truncate">Registrar Salida</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("submission")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all ${
            activeTab === "submission"
              ? "bg-[var(--panel)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          <FileText size={14} className="shrink-0 text-blue-500" />
          <span className="truncate">Rendición</span>
        </button>
      </nav>

      {/* ===================== TAB 1: RECEIVE MERCHANDISE ===================== */}
      {activeTab === "receipt" && (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold">Recepción de Mercadería</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Recibí materiales desde una Orden de Compra autorizada para esta obra. Soporta recepción parcial.
            </p>
          </div>

          {context.orders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              No hay órdenes de compra con saldo pendiente de entrega en esta obra.
            </div>
          ) : (
            <form onSubmit={handleReceiptSubmit} className="space-y-4">
              <label className="block text-xs font-medium">
                Seleccionar Orden de Compra (OC)
                <select
                  value={selectedOrderId}
                  onChange={(e) => {
                    setSelectedOrderId(e.target.value);
                    setReceiptQuantities({});
                  }}
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-xs text-[var(--foreground)] focus:ring-1 focus:ring-[var(--primary)]"
                >
                  {context.orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.code} · {order.providerName} ({order.items.filter((i) => i.pending > 0).length} ítems pendientes)
                    </option>
                  ))}
                </select>
              </label>

              {selectedOrder && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-[var(--muted)]">Ítems de la orden:</span>
                  {selectedOrder.items.map((item) => (
                    <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">{item.productName}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                            Ordenada: {formatNumber(item.ordered, 2)} {item.unit} · Recibida: {formatNumber(item.received, 2)} · Pendiente:{" "}
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatNumber(item.pending, 2)} {item.unit}
                            </span>
                          </p>
                        </div>
                      </div>

                      {item.pending > 0 ? (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-[11px] text-[var(--muted)] whitespace-nowrap">Recibir ahora:</label>
                          <input
                            type="number"
                            min="0"
                            max={item.pending}
                            step="any"
                            placeholder="0"
                            value={receiptQuantities[item.id] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReceiptQuantities((prev) => ({ ...prev, [item.id]: val }));
                            }}
                            className="h-8 w-32 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 text-xs font-medium"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setReceiptQuantities((prev) => ({ ...prev, [item.id]: String(item.pending) }));
                            }}
                            className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                          >
                            Todo ({formatNumber(item.pending, 2)})
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">Totalmente recibido</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  Fecha de recepción
                  <input
                    type="date"
                    name="fecha"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                    className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                  />
                </label>
                <label className="text-xs">
                  Recibido por (Nombre del depositero)
                  <input
                    name="recibido_por"
                    placeholder="Tu nombre completo"
                    required
                    maxLength={120}
                    className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  N.° de Remisión / Factura (opcional)
                  <input
                    name="remision_number"
                    placeholder="Ej. REM-001-2849"
                    maxLength={100}
                    className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                  />
                </label>
                <label className="text-xs">
                  Fotos o remito firmado (opcional)
                  <input
                    type="file"
                    name="files"
                    accept="image/*,application/pdf"
                    multiple
                    className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-1 text-xs"
                  />
                </label>
              </div>

              <label className="block text-xs">
                Notas adicionales (opcional)
                <textarea
                  name="notas"
                  rows={2}
                  placeholder="Observaciones de entrega, estado de bultos, etc."
                  maxLength={1000}
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                />
              </label>

              {receiptError && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{receiptError}</span>
                </div>
              )}

              {receiptSuccess && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={15} className="shrink-0" />
                  <span>{receiptSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={receiptSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] py-3 text-xs font-semibold text-[var(--background)] transition-opacity disabled:opacity-50"
              >
                {receiptSubmitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {receiptSubmitting ? "Registrando recepción…" : "Confirmar Recepción de Mercadería"}
              </button>
            </form>
          )}
        </section>
      )}

      {/* ===================== TAB 2: REGISTER CONSUMPTION / OUTPUT ===================== */}
      {activeTab === "consumption" && (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold">Registrar Salida / Consumo</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Despachá materiales del depósito imputándolos a una partida del presupuesto de obra.
            </p>
          </div>

          <form onSubmit={handleConsumptionSubmit} className="space-y-4">
            <label className="block text-xs font-medium">
              Material / Producto
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                required
                className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-xs text-[var(--foreground)]"
              >
                <option value="">Seleccionar material</option>
                {context.stock.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.productName} · Disponible: {formatNumber(item.quantity, 2)} {item.unit}
                  </option>
                ))}
                {context.allProducts
                  .filter((p) => !context.stock.some((s) => s.productId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · Sin stock actual (0 {p.unit})
                    </option>
                  ))}
              </select>
            </label>

            {selectedStockItem && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs">
                <span className="text-[var(--muted)]">Stock actual en este depósito: </span>
                <span className="font-bold text-[var(--foreground)]">
                  {formatNumber(selectedStockItem.quantity, 2)} {selectedStockItem.unit}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs">
                Cantidad a retirar
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  placeholder="0.00"
                  required
                  value={consumptionQty}
                  onChange={(e) => setConsumptionQty(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                />
              </label>

              <label className="text-xs">
                Imputar a Partida de Obra (opcional)
                <select
                  value={selectedBudgetItemId}
                  onChange={(e) => setSelectedBudgetItemId(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs text-[var(--foreground)]"
                >
                  <option value="">Sin partida específica</option>
                  {context.budgetItems.map((bi) => (
                    <option key={bi.id} value={bi.id}>
                      {bi.code} · {bi.description}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs">
                Retirado por / Cuadrilla
                <input
                  value={withdrawnBy}
                  onChange={(e) => setWithdrawnBy(e.target.value)}
                  placeholder="Nombre de quien retira"
                  maxLength={120}
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                />
              </label>

              <label className="text-xs">
                Foto o vale firmado (opcional)
                <input
                  type="file"
                  name="files"
                  accept="image/*,application/pdf"
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-1 text-xs"
                />
              </label>
            </div>

            <label className="block text-xs">
              Notas / Destino de uso (opcional)
              <textarea
                value={consumptionNotes}
                onChange={(e) => setConsumptionNotes(e.target.value)}
                rows={2}
                placeholder="Ej. Utilizado en hormigonado de losa Nivel 2"
                maxLength={1000}
                className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
              />
            </label>

            {consumptionError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">
                <AlertCircle size={15} className="shrink-0" />
                <span>{consumptionError}</span>
              </div>
            )}

            {consumptionSuccess && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={15} className="shrink-0" />
                <span>{consumptionSuccess}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={consumptionSubmitting || !selectedProductId}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] py-3 text-xs font-semibold text-[var(--background)] transition-opacity disabled:opacity-50"
            >
              {consumptionSubmitting ? <Loader2 size={15} className="animate-spin" /> : <ArrowDownRight size={15} />}
              {consumptionSubmitting ? "Registrando salida…" : "Registrar Salida / Consumo"}
            </button>
          </form>
        </section>
      )}

      {/* ===================== TAB 3: SUBMIT EVIDENCE / PERIOD SHEET ===================== */}
      {activeTab === "submission" && (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold">Rendición Periódica de Materiales</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Subí fotos del cuaderno de obra, remitos o planillas Excel/CSV. La administración revisará las líneas antes de afectar el stock.
            </p>
          </div>

          <form onSubmit={handleSubmissionSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">
                Desde
                <input
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                  type="date"
                  name="period_start"
                  required
                />
              </label>
              <label className="text-xs">
                Hasta
                <input
                  className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                  type="date"
                  name="period_end"
                  required
                />
              </label>
            </div>

            <label className="block text-xs">
              N.° de remisión o lote (opcional)
              <input
                className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                name="remision_number"
                placeholder="Ej. Rendición Semana 38"
              />
            </label>

            <label className="block text-xs">
              Fotos del cuaderno o planilla Excel/CSV
              <input
                className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                type="file"
                name="files"
                accept="image/*,.xlsx,.xls,.csv,application/pdf"
                multiple
                required
              />
              <span className="mt-1 block text-[10px] text-[var(--muted)]">Podés subir varias fotos juntas o archivos de planilla.</span>
            </label>

            <label className="block text-xs">
              Notas para la oficina (opcional)
              <textarea
                className="mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs"
                name="notes"
                rows={2}
                placeholder="Comentarios adicionales sobre el período..."
              />
            </label>

            {submissionError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">
                <AlertCircle size={15} className="shrink-0" />
                <span>{submissionError}</span>
              </div>
            )}

            {submissionSuccess && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={15} className="shrink-0" />
                <span>{submissionSuccess}</span>
              </div>
            )}

            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] py-3 text-xs font-semibold text-[var(--background)] transition-opacity disabled:opacity-50"
              type="submit"
              disabled={submissionSubmitting}
            >
              {submissionSubmitting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              {submissionSubmitting ? "Enviando rendición…" : "Enviar Evidencia / Planilla"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
