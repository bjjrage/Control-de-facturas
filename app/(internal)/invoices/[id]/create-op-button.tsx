"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createPaymentOrderFromInvoice } from "@/app/(internal)/pagos/actions";

export function CreateOpButton({ invoiceId }: { invoiceId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const result = await createPaymentOrderFromInvoice(invoiceId);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
    // On success, server action redirects to /pagos/[id]
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={loading}>
        {loading ? "Creando OP…" : "Crear OP"}
      </Button>
      {error ? <span className="text-[12px] text-[var(--error)]">{error}</span> : null}
    </div>
  );
}
