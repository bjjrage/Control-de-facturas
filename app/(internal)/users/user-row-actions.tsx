"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteUser, toggleUserActive } from "./actions";

export function UserRowActions({ id, email, active, disabled }: { id: string; email: string; active: boolean; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  function run(remove: boolean) {
    if (remove && !confirm(`¿Eliminar a ${email}? Si registró operaciones, desactivalo en vez de borrarlo.`)) return;
    start(async () => {
      setError(null);
      try {
        const result = remove ? await deleteUser(id) : await toggleUserActive(id, !active);
        setError(result.error);
        router.refresh();
      } catch { setError("No se pudo completar la acción. Probá nuevamente."); }
    });
  }
  return (
    <div className="space-y-1">
      <div className="flex justify-end gap-1">
        <Button variant="ghost" className="h-7 px-2 text-[12px]" disabled={disabled || pending} onClick={() => run(false)}>{active ? "Desactivar" : "Activar"}</Button>
        <Button variant="ghost" className="h-7 px-2 text-[12px] text-[var(--error)]" disabled={disabled || pending} onClick={() => run(true)}>Eliminar</Button>
      </div>
      {error ? <p role="alert" className="text-[12px] text-[var(--error)]">{error}</p> : null}
    </div>
  );
}
