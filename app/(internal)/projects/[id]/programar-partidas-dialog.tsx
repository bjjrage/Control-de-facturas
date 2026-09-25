"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { updateBudgetItemSchedule } from "../actions";
import { inclusiveScheduleDuration, scheduleLeafBudgetItems, validateScheduleDates } from "@/lib/projects/schedule";
import type { BudgetItem } from "@/lib/types";

const inputClass = "h-8 w-full min-w-32 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[12px]";

export function ProgramarPartidasDialog({ budgetItems }: { budgetItems: BudgetItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<Record<string, { start: string; end: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const items = useMemo(() => scheduleLeafBudgetItems(budgetItems), [budgetItems]);

  function datesFor(item: BudgetItem) {
    return dates[item.id] ?? { start: item.start_date ?? "", end: item.end_date ?? "" };
  }

  function changeDate(item: BudgetItem, field: "start" | "end", value: string) {
    const current = datesFor(item);
    setDates((previous) => ({ ...previous, [item.id]: { ...current, [field]: value } }));
    setMessage(null);
  }

  function saveSchedule() {
    const updates = items.flatMap((item) => {
      const value = datesFor(item);
      const start = value.start || null;
      const end = value.end || null;
      if (start === item.start_date && end === item.end_date) return [];
      return [{ item, start, end }];
    });
    const invalid = updates.find(({ start, end }) => validateScheduleDates(start, end));
    if (invalid) {
      setMessage(`${invalid.item.code}: ${validateScheduleDates(invalid.start, invalid.end)}`);
      return;
    }
    if (updates.length === 0) {
      setMessage("No hay fechas nuevas para guardar.");
      return;
    }

    startTransition(async () => {
      let saved = 0;
      for (const { item, start, end } of updates) {
        const result = await updateBudgetItemSchedule(item.id, start, end);
        if (result.error) {
          if (saved > 0) router.refresh();
          setMessage(`${saved} partida(s) guardadas. ${item.code}: ${result.error}`);
          return;
        }
        saved++;
      }
      setMessage(`${saved} partida(s) programadas.`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="h-9 px-3 text-[12px]">Programar partidas</Button>
      </DialogTrigger>
      <DialogContent title="Programar partidas" className="max-w-6xl">
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--muted)]">
            Asigná fechas a las partidas del presupuesto. La duración se calcula en días calendario; los rubros se resumen en el Gantt.
          </p>
          {message ? <p role="status" className="rounded border border-[var(--border)] px-3 py-2 text-[12px]">{message}</p> : null}
          {items.length === 0 ? (
            <p className="rounded border border-dashed border-[var(--border)] p-4 text-[12px] text-[var(--muted)]">
              No hay partidas para programar. Primero agregá ítems al presupuesto.
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-[var(--border)]">
              <table className="w-full min-w-[850px] text-left text-[12px]">
                <thead className="sticky top-0 bg-[var(--panel)]">
                  <tr>
                    <th className="px-3 py-2">Partida</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2">Inicio</th>
                    <th className="px-3 py-2">Fin</th>
                    <th className="px-3 py-2 text-right">Duración</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const value = datesFor(item);
                    const duration = value.start && value.end ? inclusiveScheduleDuration(value.start, value.end) : null;
                    return (
                      <tr key={item.id} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 font-mono">{item.code}</td>
                        <td className="max-w-[320px] truncate px-3 py-2">{item.description}</td>
                        <td className="px-3 py-2"><input aria-label={`Inicio ${item.code}`} className={inputClass} type="date" value={value.start} onChange={(event) => changeDate(item, "start", event.target.value)} /></td>
                        <td className="px-3 py-2"><input aria-label={`Fin ${item.code}`} className={inputClass} type="date" value={value.end} onChange={(event) => changeDate(item, "end", event.target.value)} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{duration == null ? "—" : `${duration} días`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>
            <Button type="button" disabled={isPending || items.length === 0} onClick={saveSchedule}>
              {isPending ? "Guardando…" : "Guardar fechas"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
