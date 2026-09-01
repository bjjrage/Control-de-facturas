"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Provider } from "@/lib/types";
import { inviteProviders } from "./actions";

export function InviteDialog({
  rfqId,
  availableProviders,
  trigger,
}: {
  rfqId: string;
  availableProviders: Provider[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSelected([]);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Invitar proveedores">
        {error ? (
          <div className="mb-3 rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}
        {availableProviders.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            Ya invitaste a todos los proveedores activos. Cargá nuevos proveedores desde la sección
            Proveedores.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto border border-[var(--border)] rounded-md divide-y divide-[var(--border)]">
            {availableProviders.map((p) => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) => {
                    setSelected((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                    );
                  }}
                />
                {p.name}
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pending || selected.length === 0}
            onClick={async () => {
              setPending(true);
              const result = await inviteProviders(rfqId, selected);
              setPending(false);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setError(null);
              setSelected([]);
              setOpen(false);
            }}
          >
            {pending ? "Invitando…" : `Invitar (${selected.length})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
