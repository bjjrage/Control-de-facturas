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
  categorias = [],
  selectedCategoriaIds = [],
}: {
  provider?: Provider;
  action: (formData: FormData) => Promise<{ error: string | null }>;
  trigger: React.ReactNode;
  categorias?: { id: string; nombre: string }[];
  selectedCategoriaIds?: string[];
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
          <div>
            <Label htmlFor="payment_terms">Condiciones de pago</Label>
            <Input id="payment_terms" name="payment_terms" maxLength={500} placeholder="Ej.: 30 días" defaultValue={provider?.payment_terms ?? ""} />
          </div>
          <div>
            <Label>Rubros</Label>
            {categorias.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">
                No hay categorías de producto. Crealas en Stock → Categorías para poder asignar rubros.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-[var(--border)] p-2 max-h-40 overflow-y-auto">
                {categorias.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-[12px]">
                    <input type="checkbox" name="categoria_id" value={c.id} defaultChecked={selectedCategoriaIds.includes(c.id)} />
                    {c.nombre}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Los RFQ de costeo de un rubro se mandan a los proveedores que lo tengan tildado.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
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
