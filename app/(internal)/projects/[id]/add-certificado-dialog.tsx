"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createCertificate } from "../certificado-actions";

export function AddCertificadoDialog({
  projectId,
  nextNumero,
  suggestedStart,
}: {
  projectId: string;
  nextNumero: number;
  suggestedStart: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Nuevo certificado</Button>
      </DialogTrigger>
      <DialogContent title={`Certificado N° ${nextNumero}`}>
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            setError(null);
            const result = await createCertificate(projectId, formData);
            setPending(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            setOpen(false);
            router.refresh();
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <p className="text-[12px] text-[var(--muted)]">
            Las líneas se arman solas: el <strong>acumulado anterior</strong> sale de los certificados ya
            cerrados y lo <strong>ejecutado en el período</strong> de las entradas de avance. Después podés
            ajustar cada rubro antes de cerrar.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cert_start">Desde</Label>
              <Input id="cert_start" name="period_start" type="date" defaultValue={suggestedStart ?? ""} required />
            </div>
            <div>
              <Label htmlFor="cert_end">Hasta</Label>
              <Input id="cert_end" name="period_end" type="date" required />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Generando…" : "Generar certificado"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
