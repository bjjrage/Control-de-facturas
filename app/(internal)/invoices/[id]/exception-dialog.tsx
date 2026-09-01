"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { approveException } from "./actions";

export function ExceptionDialog({ invoiceId, trigger }: { invoiceId: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Aprobar por excepción">
        {error ? (
          <div className="mb-3 rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}
        <div className="space-y-3">
          <div>
            <Label htmlFor="reason">Motivo</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="comment">Comentario (opcional)</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={async () => {
              setPending(true);
              const result = await approveException(invoiceId, reason.trim(), comment.trim() || null);
              setPending(false);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setOpen(false);
            }}
          >
            {pending ? "Guardando…" : "Aprobar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
