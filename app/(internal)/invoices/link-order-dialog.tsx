"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDate } from "@/lib/format";
import { getCandidateOrders, linkInvoiceToOrder, type OrderCandidate } from "./actions";

const SCORE_TONE: Record<number, "ok" | "warn" | "neutral"> = { 3: "ok", 2: "warn", 1: "neutral", 0: "neutral" };

export function LinkOrderDialog({
  invoiceId,
  trigger,
}: {
  invoiceId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    candidates: OrderCandidate[];
    invoiceProvider: string;
    invoiceTotal: number;
    invoiceCurrency: string;
  } | null>(null);
  const [q, setQ] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
    if (!isOpen) { setShowAll(false); setQ(""); }
    if (isOpen && result === null) {
      setLoading(true);
      const res = await getCandidateOrders(invoiceId);
      setLoading(false);
      if (res.error) { setError(res.error); return; }
      setResult({ candidates: res.candidates, invoiceProvider: res.invoiceProvider, invoiceTotal: res.invoiceTotal, invoiceCurrency: res.invoiceCurrency });
    }
  }

  async function handleLink(orderId: string) {
    setLinking(orderId);
    setError(null);
    const res = await linkInvoiceToOrder(invoiceId, orderId);
    setLinking(null);
    if (res.error) { setError(res.error); return; }
    setOpen(false);
  }

  const candidates = result?.candidates ?? [];
  const sameProviderCandidates = candidates.filter((c) => c.score >= 2);
  const otherCandidates = candidates.filter((c) => c.score < 2);

  // Por defecto mostrar solo mismo proveedor; el usuario decide si quiere ver otros
  const noSameProvider = sameProviderCandidates.length === 0;
  const visibleBase = showAll ? candidates : sameProviderCandidates;

  const filtered = q.trim()
    ? candidates.filter((c) => {
        const t = q.toLowerCase();
        return c.code.toLowerCase().includes(t) || c.product.toLowerCase().includes(t) || c.provider_name.toLowerCase().includes(t);
      })
    : visibleBase;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Vincular a Orden de Compra">
        <div className="space-y-3">
          {result && (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] flex items-center gap-2">
              <span className="text-[var(--muted)]">Factura:</span>
              <span className="font-medium">{result.invoiceProvider}</span>
              <span className="text-[var(--muted)]">·</span>
              <span className="num font-medium">{formatMoney(result.invoiceTotal, result.invoiceCurrency as never)}</span>
            </div>
          )}

          {error && (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          )}

          {loading && (
            <p className="text-[13px] text-[var(--muted)] py-6 text-center">Buscando órdenes candidatas…</p>
          )}

          {!loading && result && candidates.length === 0 && (
            <p className="text-[13px] text-[var(--muted)] py-6 text-center">
              No hay órdenes con saldo disponible.
            </p>
          )}

          {!loading && result && noSameProvider && !showAll && !q.trim() && candidates.length > 0 && (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-4 text-center space-y-2">
              <p className="text-[13px] text-[var(--muted)]">
                No hay OCs abiertas de este proveedor.
              </p>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-[13px] text-[var(--primary)] hover:underline"
              >
                Ver {candidates.length} OC{candidates.length !== 1 ? "s" : ""} de otros proveedores
              </button>
            </div>
          )}

          {!loading && result && candidates.length > 0 && (
            <input
              type="text"
              placeholder="Buscar por código, producto o proveedor…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 text-[13px] outline-none focus:border-[var(--primary)]"
              autoFocus
            />
          )}

          {!loading && result && filtered.length > 0 && (
            <>
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
                {q.trim() && filtered.length === 0 ? (
                  <p className="text-[12px] text-[var(--muted)] text-center py-4">Sin resultados para &quot;{q}&quot;</p>
                ) : (
                  filtered.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2"
                    >
                      {c.score > 0 ? (
                        <Badge tone={SCORE_TONE[c.score]}>{c.scoreLabel}</Badge>
                      ) : (
                        <span className="text-[10px] text-[var(--muted)] shrink-0 w-16 text-center">Con saldo</span>
                      )}
                      <div className="flex-1 min-w-0 text-[12px]">
                        <div className="font-medium truncate">{c.code} — {c.product}</div>
                        <div className="text-[var(--muted)] truncate">
                          {c.provider_name} · saldo <span className="num">{formatMoney(c.saldo, c.currency as never)}</span> · {formatDate(c.authorized_at)}
                        </div>
                      </div>
                      <Button
                        className="h-6 px-2.5 text-[12px] shrink-0"
                        disabled={linking !== null}
                        onClick={() => handleLink(c.id)}
                      >
                        {linking === c.id ? "…" : "Vincular"}
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[var(--muted)]">
                  {!showAll && !q.trim()
                    ? `${sameProviderCandidates.length} OC${sameProviderCandidates.length !== 1 ? "s" : ""} del mismo proveedor`
                    : `${candidates.length} orden${candidates.length !== 1 ? "es" : ""} con saldo`}
                </p>
                {otherCandidates.length > 0 && !q.trim() && (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="text-[11px] text-[var(--primary)] hover:underline shrink-0"
                  >
                    {showAll ? "Ver solo este proveedor" : `Ver también ${otherCandidates.length} de otros proveedores`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
