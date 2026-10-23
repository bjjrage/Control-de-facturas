"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { EmpresaAccess } from "@/lib/empresas/access";
import { EmpresaAccessFields } from "./empresa-access-fields";
import { updateEmpresaAccess } from "./actions";

export function EmpresaAccessForm({ empresaId, access }: { empresaId: string; access: EmpresaAccess }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form aria-label="Plan y módulos de la empresa" className="mt-3 space-y-2 border-t border-[var(--border)] pt-3" action={(formData) => start(async () => {
      setMessage(null);
      try {
        const result = await updateEmpresaAccess(empresaId, formData);
        setMessage(result.error ?? "Plan y módulos guardados.");
        if (!result.error) router.refresh();
      } catch { setMessage("No se pudo guardar. Probá nuevamente."); }
    })}>
      <EmpresaAccessFields prefix={empresaId} access={access} disabled={pending} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Guardando…" : "Guardar plan y módulos"}</Button>
        {message ? <p role="status" className="text-[12px]">{message}</p> : null}
      </div>
    </form>
  );
}
