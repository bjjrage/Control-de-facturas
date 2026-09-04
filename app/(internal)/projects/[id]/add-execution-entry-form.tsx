"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { addExecutionEntry } from "../actions";
import { BudgetItem } from "@/lib/types";

export function AddExecutionEntryForm({
  projectId,
  budgetItems,
}: {
  projectId: string;
  budgetItems: BudgetItem[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const eligible = budgetItems.filter((i) => i.unit && i.quantity != null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={eligible.length === 0}>
        + Registrar avance
      </Button>
    );
  }

  return (
    <form
      className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3"
      action={async (formData: FormData) => {
        setPending(true);
        const result = await addExecutionEntry(projectId, formData);
        setPending(false);
        if (result.error) {
          setError(result.error);
          return;
        }
        setError(null);
        setOpen(false);
        router.refresh();
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="ee_item">Ítem del presupuesto</Label>
          <Select id="ee_item" name="budget_item_id" required>
            <option value="">Seleccioná un ítem…</option>
            {eligible.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.description} ({i.unit})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ee_qty">Cantidad ejecutada</Label>
          <Input id="ee_qty" name="quantity_executed" type="number" step="any" min="0.001" required />
        </div>
        <div>
          <Label htmlFor="ee_date">Fecha</Label>
          <Input id="ee_date" name="entry_date" type="date" defaultValue={today} required />
        </div>
        <div className="col-span-2">
          <Label htmlFor="ee_notes">Notas</Label>
          <Textarea id="ee_notes" name="notes" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}
