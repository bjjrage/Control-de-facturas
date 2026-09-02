"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { createRfq } from "./actions";

export function RfqDialog({ trigger, defaultOpen }: { trigger: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && window.location.search.includes("nueva=")) {
          window.history.replaceState(null, "", "/rfqs");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva solicitud de cotización">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createRfq(formData);
            setPending(false);
            if (result.error && !result.id) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
            router.push(`/rfqs/${result.id}`);
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
            <div>
              <Label htmlFor="product">Producto</Label>
              <Input id="product" name="product" required />
            </div>
            <div>
              <Label htmlFor="quantity">Cantidad</Label>
              <Input id="quantity" name="quantity" type="number" step="0.01" min="0.01" required />
            </div>
            <div>
              <Label htmlFor="unit">Unidad</Label>
              <Input id="unit" name="unit" placeholder="kg, un, m²" required />
            </div>
          </div>
          <div>
            <Label htmlFor="specifications">Especificaciones</Label>
            <Textarea id="specifications" name="specifications" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="required_date">Fecha requerida</Label>
              <Input id="required_date" name="required_date" type="date" />
            </div>
            <div>
              <Label htmlFor="internal_reference">Referencia interna</Label>
              <Input id="internal_reference" name="internal_reference" />
            </div>
          </div>
          <div>
            <Label htmlFor="observations">Observaciones</Label>
            <Textarea id="observations" name="observations" />
          </div>
          <div>
            <Label htmlFor="attachments">Archivos de referencia (PDF, imágenes)</Label>
            <input
              id="attachments"
              name="attachments"
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="block w-full text-[13px]"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Ej: ficha del vaso con onzas y colores, para que los proveedores coticen en base a eso.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear solicitud"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
