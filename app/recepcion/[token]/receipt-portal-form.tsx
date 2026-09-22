"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";
import type { ReceiptPortalOrder } from "@/lib/inventory/receipt-portal-data";

export function ReceiptPortalForm({ token, order }: { token: string; order: ReceiptPortalOrder }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("items", JSON.stringify(
      order.items
        .map((item) => ({
          order_item_id: item.id,
          quantity: Number(quantities[item.id] ?? 0),
        }))
        .filter((item) => item.quantity > 0)
    ));
    try {
      const response = await fetch(`/api/recepcion-portal/${encodeURIComponent(token)}`, {
        method: "POST",
        body: data,
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "No se pudo enviar la recepción.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <section role="status" className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-center">
        <h2 className="text-lg font-semibold">Recepción enviada</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          La empresa recibió los datos y la evidencia. El stock se actualizará cuando confirme la recepción.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">
          Fecha de recepción
          <input className="mt-1 block w-full rounded border bg-[var(--panel-2)] p-2 text-sm" type="date" name="fecha" required />
        </label>
        <label className="text-xs">
          Recibido por
          <input className="mt-1 block w-full rounded border bg-[var(--panel-2)] p-2 text-sm" name="recibido_por" required maxLength={120} autoComplete="name" />
        </label>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Productos de la orden</h2>
        {order.items.map((item) => (
          <div key={item.id} className="rounded border border-[var(--border)] p-3">
            <p className="text-sm font-medium">{item.product}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Ordenada {formatNumber(item.ordered, 2)} {item.unit} · Ya cargada {formatNumber(item.received, 2)} · Pendiente {formatNumber(item.pending, 2)} {item.unit}
            </p>
            <label className="mt-2 block text-xs">
              Cantidad recibida ahora
              <input
                className="mt-1 block w-full rounded border bg-[var(--panel-2)] p-2 text-sm sm:max-w-48"
                type="number"
                name={`quantity-${item.id}`}
                min="0"
                max={item.pending}
                step="any"
                inputMode="decimal"
                disabled={item.pending <= 0}
                value={quantities[item.id] ?? ""}
                onChange={(event) => setQuantities((previous) => ({ ...previous, [item.id]: event.target.value }))}
              />
            </label>
          </div>
        ))}
      </div>

      <label className="block text-xs">
        N.º de remisión
        <input className="mt-1 block w-full rounded border bg-[var(--panel-2)] p-2 text-sm" name="remision_number" maxLength={100} />
      </label>
      <label className="block text-xs">
        Notas
        <textarea className="mt-1 block w-full rounded border bg-[var(--panel-2)] p-2 text-sm" name="notas" rows={3} maxLength={2000} />
      </label>
      <label className="block text-xs">
        Fotos o evidencia (opcional)
        <input className="mt-1 block w-full rounded border bg-[var(--panel-2)] p-2 text-sm" type="file" name="files" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" multiple />
        <span className="mt-1 block text-[11px] text-[var(--muted)]">Hasta 10 archivos de 20 MB cada uno.</span>
      </label>

      {error ? <p role="alert" className="rounded border border-[var(--error)]/30 px-3 py-2 text-xs text-[var(--error)]">{error}</p> : null}
      <button
        className="w-full rounded bg-[var(--foreground)] px-4 py-3 text-sm font-medium text-[var(--background)] disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={submitting || order.items.every((item) => item.pending <= 0)}
      >
        {submitting ? "Enviando…" : "Enviar recepción"}
      </button>
    </form>
  );
}
