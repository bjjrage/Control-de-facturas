"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Project } from "@/lib/types";
import { updateProject } from "../actions";

export function EditProjectDialog({ project, trigger }: { project: Project; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Editar proyecto">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await updateProject(project.id, formData);
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
              <Label htmlFor="ep_name">Nombre</Label>
              <Input id="ep_name" name="name" defaultValue={project.name} required />
            </div>
            <div>
              <Label>Código</Label>
              <Input value={project.code} disabled />
            </div>
            <div>
              <Label htmlFor="ep_client">Cliente</Label>
              <Input id="ep_client" name="client" defaultValue={project.client ?? ""} />
            </div>
            <div>
              <Label htmlFor="ep_location">Ubicación</Label>
              <Input id="ep_location" name="location" defaultValue={project.location ?? ""} />
            </div>
            <div>
              <Label htmlFor="ep_start">Fecha inicio</Label>
              <Input id="ep_start" name="start_date" type="date" defaultValue={project.start_date ?? ""} />
            </div>
            <div>
              <Label htmlFor="ep_end">Fecha fin</Label>
              <Input id="ep_end" name="end_date" type="date" defaultValue={project.end_date ?? ""} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="ep_budget">Presupuesto estimado (Gs)</Label>
              <Input id="ep_budget" name="budget_total" type="number" step="any" min="0" defaultValue={project.budget_total} />
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
  );
}
