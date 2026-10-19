"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { allowedWorkOrderTransitions, WORK_ORDER_STATUS_LABELS } from "@/lib/quotation";
import type { WorkOrderStatus } from "@/lib/types";
import { updateWorkOrderStatus } from "@/app/(internal)/ventas/[id]/quotation-actions";

export function WorkOrderStatusForm({
  workOrderId,
  status,
  workflowStatus,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  workflowStatus: string;
}) {
  const options = allowedWorkOrderTransitions(status, workflowStatus);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  if (options.length === 0) return null;

  return (
    <form
      className="flex items-end gap-2 flex-wrap"
      onSubmit={async (event) => {
        event.preventDefault();
        const nextStatus = new FormData(event.currentTarget).get("status") as WorkOrderStatus;
        setPending(true);
        setError(null);
        try {
          const result = await updateWorkOrderStatus(workOrderId, nextStatus);
          if (result.error) setError(result.error);
          else router.refresh();
        } catch {
          setError("Se cortó la conexión. Probá de nuevo.");
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <Label htmlFor="status">Estado</Label>
        <Select id="status" name="status" defaultValue="" className="w-40" required>
          <option value="" disabled>Elegir estado</option>
          {options.map((nextStatus) => (
            <option key={nextStatus} value={nextStatus}>{WORK_ORDER_STATUS_LABELS[nextStatus]}</option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      {error ? <div role="alert" className="w-full text-[12px] text-[var(--error)]">{error}</div> : null}
    </form>
  );
}
