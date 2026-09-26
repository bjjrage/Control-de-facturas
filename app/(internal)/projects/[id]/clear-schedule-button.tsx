"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearProjectSchedule } from "../actions";

export function ClearScheduleButton({ projectId, hasSchedule }: { projectId: string; hasSchedule: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!hasSchedule) return null;

  function clear() {
    startTransition(async () => {
      const res = await clearProjectSchedule(projectId);
      if (res.error) {
        setMessage(res.error);
        setConfirming(false);
        return;
      }
      setMessage(`Cronograma limpiado en ${res.cleared} partida(s). Cantidades, precios y avance intactos.`);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {message ? <span role="status" className="text-[11px] text-[var(--muted)]">{message}</span> : null}
      {confirming ? (
        <>
          <span className="text-[12px] text-[var(--muted)]">¿Quitar todas las fechas?</span>
          <Button type="button" variant="secondary" className="h-9 px-3 text-[12px]" disabled={isPending} onClick={() => setConfirming(false)}>
            No
          </Button>
          <Button type="button" className="h-9 px-3 text-[12px]" disabled={isPending} onClick={clear}>
            {isPending ? "Limpiando…" : "Sí, limpiar"}
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" className="h-9 px-3 text-[12px]" onClick={() => { setMessage(null); setConfirming(true); }}>
          Limpiar cronograma
        </Button>
      )}
    </span>
  );
}
