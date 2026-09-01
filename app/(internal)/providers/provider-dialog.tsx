"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Provider } from "@/lib/types";

export function ProviderDialog({
  provider,
  action,
  trigger,
}: {
  provider?: Provider;
  action: (formData: FormData) => Promise<{ error: string | null }>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={provider ? "Editar proveedor" : "Nuevo proveedor"}>
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await action(formData);
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
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" required defaultValue={provider?.name} />
          </div>
          <div>
            <Label htmlFor="contact_name">Contacto</Label>
            <Input id="contact_name" name="contact_name" defaultValue={provider?.contact_name ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={provider?.email ?? ""} />
            </div>
            <div>
              <Label htmlFor="phone">Teléfono</Label>
              <Input id="phone" name="phone" defaultValue={provider?.phone ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor="tax_id">RUC</Label>
            <Input id="tax_id" name="tax_id" defaultValue={provider?.tax_id ?? ""} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
