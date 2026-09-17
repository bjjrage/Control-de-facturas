"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { acceptQuotationAction, rejectQuotationAction } from "./actions";

export function AcceptForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px] text-[var(--ok)]">
        ¡Gracias! Registramos tu aceptación. La empresa te contactará con los próximos pasos.
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      action={async (fd: FormData) => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setPending(true);
        const res = await acceptQuotationAction(token, fd);
        setPending(false);
        if (res?.error) {
          setError(res.error);
          setConfirming(false);
          return;
        }
        setError(null);
        setDone(true);
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="acceptor_name">Nombre y apellido (quien acepta)</Label>
          <Input id="acceptor_name" name="acceptor_name" required autoComplete="name" placeholder="Ej: María González" />
        </div>
        <div>
          <Label htmlFor="acceptor_doc">Documento / RUC (opcional)</Label>
          <Input id="acceptor_doc" name="acceptor_doc" placeholder="Ej: 1234567-8" />
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Comentario (opcional)</Label>
        <Textarea id="notes" name="notes" placeholder="Ej: Acepto, coordinar inicio la próxima semana" />
      </div>
      {!confirming ? (
        <Button type="submit" className="w-full">
          Aceptar cotización
        </Button>
      ) : (
        <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-bg)] p-3 text-[13px] space-y-2">
          <p>
            Estás por <strong>aceptar esta cotización</strong>. Esta acción queda registrada con fecha,
            nombre y datos del enlace.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Revisar de nuevo
            </Button>
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? "Registrando…" : "Confirmar aceptación"}
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-[var(--muted)]">
        Al aceptar, la empresa genera internamente la Orden de Trabajo. Este portal solo registra tu
        aceptación de la cotización.
      </p>
    </form>
  );
}

export function RejectForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px]">
        Registramos que no aceptás esta cotización. Gracias por avisarnos.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-center text-[12px] text-[var(--muted)] hover:text-[var(--foreground)] underline"
      >
        No acepto esta cotización
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-[var(--border)] p-3"
      action={async (fd: FormData) => {
        setPending(true);
        const res = await rejectQuotationAction(token, fd);
        setPending(false);
        if (res?.error) {
          setError(res.error);
          return;
        }
        setError(null);
        setDone(true);
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="actor_name">Tu nombre (opcional)</Label>
        <Input id="actor_name" name="actor_name" placeholder="Ej: María González" />
      </div>
      <div>
        <Label htmlFor="reason">Motivo (opcional, ayuda a la empresa a mejorar)</Label>
        <Textarea id="reason" name="reason" placeholder="Ej: Precio fuera de presupuesto por ahora" />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Volver
        </Button>
        <Button type="submit" variant="secondary" disabled={pending} className="flex-1">
          {pending ? "Registrando…" : "Confirmar que no acepto"}
        </Button>
      </div>
    </form>
  );
}
