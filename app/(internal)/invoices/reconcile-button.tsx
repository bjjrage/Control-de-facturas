"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reconcilePendingInvoices } from "./actions";

export function ReconcileButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        className="h-8"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reconcilePendingInvoices();
            setMsg(
              r.matched > 0
                ? `${r.matched} de ${r.total} conciliada${r.matched === 1 ? "" : "s"}.`
                : "Ninguna coincidió con una orden pendiente."
            );
          })
        }
      >
        {pending ? "Conciliando…" : "Reconciliar pendientes"}
      </Button>
      {msg ? <span className="text-[12px] text-[var(--muted)]">{msg}</span> : null}
    </div>
  );
}
