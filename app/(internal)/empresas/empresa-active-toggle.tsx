"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleEmpresaActive } from "./actions";

export function EmpresaActiveToggle({
  empresaId,
  empresaNombre,
  active,
  disabled,
}: {
  empresaId: string;
  empresaNombre: string;
  active: boolean;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        className="h-6 px-2 text-[12px]"
        disabled={disabled || pending}
        onClick={() => {
          if (active && !confirm(`¿Desactivar "${empresaNombre}"? Sus usuarios no van a poder entrar.`)) return;
          startTransition(async () => {
            const result = await toggleEmpresaActive(empresaId, !active);
            setError(result?.error ?? null);
          });
        }}
      >
        {active ? "Desactivar" : "Activar"}
      </Button>
      {error ? <span className="text-[11px] text-[var(--error)]">{error}</span> : null}
    </div>
  );
}
