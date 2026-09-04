"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { addBudgetItem } from "../actions";

export function AddBudgetItemForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Agregar ítem
      </Button>
    );
  }

  return (
    <form
      className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3"
      action={async (formData: FormData) => {
        setPending(true);
        const result = await addBudgetItem(projectId, formData);
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
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="bi_code">Código</Label>
          <Input id="bi_code" name="code" required />
        </div>
        <div className="col-span-2">
          <Label htmlFor="bi_description">Descripción</Label>
          <Input id="bi_description" name="description" required />
        </div>
        <div>
          <Label htmlFor="bi_unit">Unidad</Label>
          <Input id="bi_unit" name="unit" placeholder="m2, u, gl…" />
        </div>
        <div>
          <Label htmlFor="bi_quantity">Cantidad</Label>
          <Input id="bi_quantity" name="quantity" type="number" step="any" min="0" />
        </div>
        <div>
          <Label htmlFor="bi_unit_price">Precio unitario</Label>
          <Input id="bi_unit_price" name="unit_price" type="number" step="any" min="0" />
        </div>
        <div>
          <Label htmlFor="bi_start">Fecha inicio</Label>
          <Input id="bi_start" name="start_date" type="date" />
        </div>
        <div>
          <Label htmlFor="bi_end">Fecha fin</Label>
          <Input id="bi_end" name="end_date" type="date" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Agregando…" : "Agregar"}
        </Button>
      </div>
    </form>
  );
}
