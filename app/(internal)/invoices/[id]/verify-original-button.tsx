"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { verifyInvoiceOriginal } from "./actions";
export function VerifyOriginalButton({ invoiceId }: { invoiceId: string }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="space-y-1">
    <Button variant="secondary" disabled={pending} onClick={async () => {
      if (busy.current) return;
      busy.current = true; setPending(true); setError(null);
      try { const result = await verifyInvoiceOriginal(invoiceId); setError(result.error); }
      catch { setError("No se pudo verificar el original. Podés volver a intentar."); }
      finally { busy.current = false; setPending(false); }
    }}>{pending ? "Verificando original…" : "Verificar original"}</Button>
    {error ? <p role="alert" className="text-[12px] text-[var(--error)]">{error}</p> : null}
  </div>;
}
