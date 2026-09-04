"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createProject } from "./actions";

export function NewProjectDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nuevo proyecto">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createProject(formData);
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
            <div>
              <Label htmlFor="np_name">Nombre</Label>
              <Input id="np_name" name="name" required />
            </div>
            <div>
              <Label htmlFor="np_code">Código</Label>
              <Input id="np_code" name="code" placeholder="OBR-001" required />
            </div>
            <div>
              <Label htmlFor="np_client">Cliente</Label>
              <Input id="np_client" name="client" />
            </div>
            <div>
              <Label htmlFor="np_location">Ubicación</Label>
              <Input id="np_location" name="location" />
            </div>
            <div>
              <Label htmlFor="np_start">Fecha inicio</Label>
              <Input id="np_start" name="start_date" type="date" />
            </div>
            <div>
              <Label htmlFor="np_end">Fecha fin</Label>
              <Input id="np_end" name="end_date" type="date" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="np_budget">Presupuesto estimado (Gs)</Label>
              <Input id="np_budget" name="budget_total" type="number" step="any" min="0" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear proyecto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
