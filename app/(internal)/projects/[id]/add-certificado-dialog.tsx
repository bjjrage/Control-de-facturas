"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
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
      <DialogContent title={<span>Certificado N° {nextNumero}<InfoTooltip className="ml-1" label="Certificado de ejecución" content="El acumulado anterior toma certificados cerrados; el ejecutado del período sale de las entradas de avance. Podés ajustar cada rubro antes de cerrar." /></span>}>
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
