"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { createPaymentOrder } from "../actions";

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total: number;
  currency: string;
  oc_code: string | null;
};

export function SelectionForm({
  invoices,
  providerId,
}: {
  invoices: InvoiceRow[];
  providerId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(invoices.map((i) => i.id)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) { setError("Seleccioná al menos una factura."); return; }
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.set("provider_id", providerId);
    for (const id of selected) fd.append("invoice_ids", id);
    const result = await createPaymentOrder(fd);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
    // On success, createPaymentOrder redirects — no need to handle here
  }

  // Totals of selected invoices
  const selectedTotals = new Map<string, number>();
  for (const inv of invoices) {
    if (selected.has(inv.id)) {
      selectedTotals.set(inv.currency, (selectedTotals.get(inv.currency) ?? 0) + inv.total);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[13px] text-[var(--muted)]">
          {invoices.length} factura{invoices.length !== 1 ? "s" : ""} disponible{invoices.length !== 1 ? "s" : ""}
          {selected.size > 0 ? ` · ${selected.size} seleccionada${selected.size !== 1 ? "s" : ""}` : ""}
        </span>
        {invoices.length > 1 ? (
          <button type="button" onClick={selectAll} className="text-action text-[12px] text-[var(--primary)]">
            Seleccionar todas
          </button>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>N° Factura</th>
              <th>Fecha</th>
              <th>OC</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                className={selected.has(inv.id) ? "bg-[var(--primary)]/5" : ""}
                onClick={() => toggle(inv.id)}
                style={{ cursor: "pointer" }}
              >
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(inv.id)}
                    onChange={() => toggle(inv.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-[var(--primary)]"
                  />
                </td>
                <td className="font-medium">{inv.invoice_number}</td>
                <td>{formatDate(inv.invoice_date)}</td>
                <td>{inv.oc_code ?? <span className="text-[var(--muted)]">—</span>}</td>
                <td className="num">{formatMoney(inv.total, inv.currency as never)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
          <div className="text-[13px]">
            <span className="text-[var(--muted)]">Total OP: </span>
            <span className="font-semibold">
              {[...selectedTotals.entries()].map(([c, v]) => formatMoney(v, c as never)).join(" + ")}
            </span>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? "Creando…" : "Emitir OP"}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button type="submit" disabled>Emitir OP</Button>
        </div>
      )}
    </form>
  );
}
