"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createEmpresa } from "./actions";

export function EmpresaDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva empresa">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createEmpresa(formData);
            setPending(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          <div>
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" name="nombre" required autoFocus />
          </div>
          <div>
            <Label htmlFor="slug">Identificador (opcional)</Label>
            <Input id="slug" name="slug" placeholder="se genera del nombre si lo dejás vacío" />
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Después de crearla, agregale su primer usuario admin desde la lista.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear empresa"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
