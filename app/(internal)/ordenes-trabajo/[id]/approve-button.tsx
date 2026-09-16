"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { approveWorkOrderInternal } from "@/app/(internal)/ventas/[id]/quotation-actions";

export function WorkOrderApproveButton({ workOrderId }: { workOrderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      action={async () => {
        setPending(true);
        setError(null);
        try {
          const res = await approveWorkOrderInternal(workOrderId);
          if (res?.error) setError(res.error);
        } catch {
          setError("Se cortó la conexión. Probá de nuevo.");
        } finally {
          setPending(false);
        }
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)] mb-2">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Aprobando…" : "Aprobar para producción"}
      </Button>
    </form>
  );
}
