"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { CurrencyCode } from "@/lib/types";
import { matchOrder } from "./actions";

type Candidate = { id: string; rfq_code: string; product: string; total_price: number; currency: string };

export function MatchDialog({
  invoiceId,
  candidates,
  trigger,
}: {
  invoiceId: string;
  candidates: Candidate[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Vincular orden autorizada">
        {error ? (
          <div className="mb-3 rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}
        {candidates.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            No hay órdenes autorizadas de este proveedor disponibles para vincular.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-md max-h-80 overflow-y-auto">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                <div>
                  <div className="font-medium">{c.rfq_code}</div>
                  <div className="text-[var(--muted)]">{c.product}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num">{formatMoney(c.total_price, c.currency as CurrencyCode)}</span>
                  <Button
                    className="h-6 px-2 text-[12px]"
                    disabled={pending === c.id}
                    onClick={async () => {
                      setPending(c.id);
                      const result = await matchOrder(invoiceId, c.id);
                      setPending(null);
                      if (result?.error) {
                        setError(result.error);
                        return;
                      }
                      setOpen(false);
                    }}
                  >
                    Vincular
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
