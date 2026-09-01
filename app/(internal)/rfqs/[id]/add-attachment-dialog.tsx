"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { uploadRfqAttachments } from "../actions";

export function AddAttachmentDialog({ rfqId, trigger }: { rfqId: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Agregar archivo de referencia">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
            if (files.length === 0) {
              setError("Elegí al menos un archivo.");
              return;
            }
            setPending(true);
            const result = await uploadRfqAttachments(rfqId, files);
            setPending(false);
            if (result.error) {
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
            <Label htmlFor="attachments">Archivos (PDF, imágenes)</Label>
            <input
              id="attachments"
              name="attachments"
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="block w-full text-[13px]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Subiendo…" : "Subir"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
