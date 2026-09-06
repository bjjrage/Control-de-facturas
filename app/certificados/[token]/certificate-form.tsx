"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitCertificate } from "./actions";

export function CertificateForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  // Un doble click/tap dispara dos veces la action antes de que el estado
  // `pending` llegue a re-renderizar el botón deshabilitado — este ref se
  // chequea de forma síncrona, sin esperar ningún render, y por eso sí
  // bloquea el segundo envío. Así se duplicó un certificado en producción.
  const submittingRef = useRef(false);

  if (sent) {
    return (
      <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px] text-[var(--ok)]">
        Certificado enviado. La empresa lo va a revisar y te va a avisar cuando esté aprobado.
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      action={async (formData: FormData) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setPending(true);
        setError(null);
        const result = await submitCertificate(token, formData);
        setPending(false);
        if (result.error) {
          submittingRef.current = false;
          setError(result.error);
          return;
        }
        setSent(true);
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
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Período desde</label>
          <input name="period_start" type="date" className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]" />
        </div>
        <div>
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Período hasta</label>
          <input name="period_end" type="date" className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]" />
        </div>
        <div>
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">% de avance</label>
          <input name="claimed_pct" type="number" step="any" min="1" max="100" required className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]" />
        </div>
        <div>
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Monto reclamado (Gs)</label>
          <input name="claimed_amount" type="number" step="any" min="0.01" required className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]" />
        </div>
        <div className="col-span-2">
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Notas</label>
          <textarea name="notes" className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2 text-[13px] min-h-16" />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full h-9 rounded-md bg-[var(--primary)] text-white text-[13px] font-medium disabled:opacity-50"
      >
        {pending ? "Enviando…" : "Enviar certificado"}
      </button>
    </form>
  );
}
