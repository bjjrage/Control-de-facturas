"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { addLaborEntry } from "../caterpillar-actions";
import { listLaborRatesAction, type LaborRate } from "./apu-actions";

export function AddLaborEntryForm({
  projectId,
  budgetItems,
}: {
  projectId: string;
  budgetItems: { id: string; code: string; description: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [rates, setRates] = useState<LaborRate[]>([]);
  const [hourlyCost, setHourlyCost] = useState("");
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    listLaborRatesAction().then((res) => {
      if (res.data) setRates(res.data);
    });
  }, [open]);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Registrar parte diario
      </Button>
    );
  }

  return (
    <form
      className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3"
      action={async (formData: FormData) => {
        setPending(true);
        const result = await addLaborEntry(projectId, formData);
        setPending(false);
        if (result.error) {
          setError(result.error);
          return;
        }
        setError(null);
        setHourlyCost("");
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
          <Label htmlFor="le_worker">Trabajador</Label>
          <Input id="le_worker" name="worker_name" required />
        </div>
        <div className="col-span-2">
          <Label htmlFor="le_item">Partida</Label>
          <Select id="le_item" name="budget_item_id" defaultValue="">
            <option value="">Sin imputar a una partida</option>
            {budgetItems.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.description}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="le_rate">Categoría (jornal)</Label>
          <Select
            id="le_rate"
            name="labor_rate_id"
            defaultValue=""
            onChange={(e) => {
              const rate = rates.find((r) => r.id === e.target.value);
              if (rate) setHourlyCost(String(rate.costo_hora));
            }}
          >
            <option value="">Sin categoría</option>
            {rates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.categoria}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="le_cost">Costo por hora (Gs)</Label>
          <Input
            id="le_cost"
            name="hourly_cost"
            type="number"
            step="any"
            min="0"
            value={hourlyCost}
            onChange={(e) => setHourlyCost(e.target.value)}
            placeholder="Del jornal"
          />
        </div>
        <div>
          <Label htmlFor="le_hours">Horas</Label>
          <Input id="le_hours" name="hours" type="number" step="any" min="0.01" required />
        </div>
        <div>
          <Label htmlFor="le_date">Fecha</Label>
          <Input id="le_date" name="entry_date" type="date" defaultValue={today} required />
        </div>
        <div className="col-span-2">
          <Label htmlFor="le_task">Tarea</Label>
          <Textarea id="le_task" name="task_description" />
        </div>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Imputar el parte a una partida permite comparar el costo real de mano de obra contra el presupuestado (pestaña Costeo).
      </p>
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
