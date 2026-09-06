"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updateBudgetItem, deleteBudgetItem } from "../actions";

type Row = {
  id: string;
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  startDate: string | null;
  endDate: string | null;
};

export function EditBudgetItemDialog({ projectId, row }: { projectId: string; row: Row }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const confirmed = window.confirm(`¿Eliminar el ítem "${row.code} — ${row.description}"?`);
    if (!confirmed) return;
    setPending(true);
    const result = await deleteBudgetItem(projectId, row.id);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" title="Editar ítem" className="h-6 w-6 p-0">
            <Pencil size={13} />
          </Button>
        </DialogTrigger>
        <DialogContent title="Editar ítem">
          <form
            className="space-y-3"
            action={async (formData: FormData) => {
              setPending(true);
              const result = await updateBudgetItem(projectId, row.id, formData);
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
                <Label htmlFor="ebi_code">Código</Label>
                <Input id="ebi_code" name="code" defaultValue={row.code} required />
              </div>
              <div className="col-span-2">
                <Label htmlFor="ebi_description">Descripción</Label>
                <Input id="ebi_description" name="description" defaultValue={row.description} required />
              </div>
              <div>
                <Label htmlFor="ebi_unit">Unidad</Label>
                <Input id="ebi_unit" name="unit" defaultValue={row.unit ?? ""} />
              </div>
              <div>
                <Label htmlFor="ebi_quantity">Cantidad</Label>
                <Input id="ebi_quantity" name="quantity" type="number" step="any" min="0" defaultValue={row.quantity ?? ""} />
              </div>
              <div>
                <Label htmlFor="ebi_unit_price">Precio unitario</Label>
                <Input id="ebi_unit_price" name="unit_price" type="number" step="any" min="0" defaultValue={row.unitPrice ?? ""} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ebi_start">Fecha inicio (cronograma)</Label>
                <Input id="ebi_start" name="start_date" type="date" defaultValue={row.startDate ?? ""} />
              </div>
              <div>
                <Label htmlFor="ebi_end">Fecha fin (cronograma)</Label>
                <Input id="ebi_end" name="end_date" type="date" defaultValue={row.endDate ?? ""} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Button variant="ghost" title="Eliminar ítem" className="h-6 w-6 p-0" onClick={handleDelete} disabled={pending}>
        <Trash2 size={13} className="text-[var(--error)]" />
      </Button>
    </div>
  );
}
