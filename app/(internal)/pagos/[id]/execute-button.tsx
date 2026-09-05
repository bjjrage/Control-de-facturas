"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { markPaymentOrderExecuted } from "../actions";

export function ExecuteButton({ opId }: { opId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!confirm("¿Confirmar el pago de esta OP? Todas sus facturas pasarán a PAGADO.")) return;
    setLoading(true);
    setError(null);
    const result = await markPaymentOrderExecuted(opId);
    setLoading(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={loading}>
        {loading ? "Registrando…" : "Registrar pago"}
      </Button>
      {error ? (
        <span className="text-[12px] text-[var(--error)]">{error}</span>
      ) : null}
    </div>
  );
}
