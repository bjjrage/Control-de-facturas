"use client";

import { Select } from "@/components/ui/input";
import type { UserRole } from "@/lib/types";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RoleSelect({ id, role, action, disabled = false }: {
  id: string; role: UserRole; disabled?: boolean;
  action: (id: string, role: UserRole) => Promise<{ error: string | null }>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <div>
    <Select aria-label="Rol del usuario" value={role} disabled={disabled || pending} className="h-7 text-[12px]" onChange={(event) => {
      const next = event.target.value as UserRole;
      start(async () => {
        setError(null);
        try {
          const result = await action(id, next);
          setError(result.error);
          router.refresh();
        } catch { setError("No se pudo cambiar el rol."); }
      });
    }}>
      <option value="comercial">Comercial</option><option value="administracion">Administración</option><option value="admin">Admin</option>
    </Select>
    {error ? <p role="alert" className="text-[12px] text-[var(--error)]">{error}</p> : null}
  </div>;
}
