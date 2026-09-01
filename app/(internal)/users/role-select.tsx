"use client";

import { Select } from "@/components/ui/input";
import { UserRole } from "@/lib/types";
import { useTransition } from "react";

export function RoleSelect({
  id,
  role,
  action,
}: {
  id: string;
  role: UserRole;
  action: (id: string, role: UserRole) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      defaultValue={role}
      disabled={pending}
      className="h-6 text-[12px]"
      onChange={(e) => {
        const value = e.target.value as UserRole;
        startTransition(() => {
          action(id, value);
        });
      }}
    >
      <option value="comercial">Comercial</option>
      <option value="administracion">Administración</option>
      <option value="admin">Admin</option>
    </Select>
  );
}
