"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { duplicateBudgetFromProject } from "../actions";

type SourceProject = { id: string; code: string; name: string; itemCount: number };

export function DuplicateBudgetDialog({
  targetProjectId,
  sources,
}: {
  targetProjectId: string;
  sources: SourceProject[];
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [quantities, setQuantities] = useState(true);
  const [prices, setPrices] = useState(true);
  const [dates, setDates] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const selected = sources.find((s) => s.id === sourceId);

  async function confirm() {
    if (!sourceId) return;
    setPending(true);
    setError(null);
    const result = await duplicateBudgetFromProject(sourceId, targetProjectId, { quantities, prices, dates });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (sources.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Copiar de otro proyecto</Button>
      </DialogTrigger>
      <DialogContent title="Copiar presupuesto de otro proyecto">
        <div className="space-y-3">
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="dup_source">Proyecto origen</Label>
            <Select id="dup_source" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name} ({s.itemCount} ítems)
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={quantities} onChange={(e) => setQuantities(e.target.checked)} />
              Copiar cantidades
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} />
              Copiar precios unitarios
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={dates} onChange={(e) => setDates(e.target.checked)} />
              Copiar fechas del cronograma
            </label>
          </div>

          {selected ? (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
              Se van a copiar <strong className="text-[var(--foreground)]">{selected.itemCount}</strong> ítems.
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={confirm} disabled={pending || !sourceId}>
              {pending ? "Copiando…" : "Copiar presupuesto"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
