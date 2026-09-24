"use client";

import { UserRole } from "@/lib/types";
import { EmpresaPlan } from "@/lib/auth";
import { AdminConfigSection } from "./admin-config-section";

// Restored right-side configuration rail from the pre-workspace ERP.
export function PlanNav({
  role,
  plan,
  isSuperAdmin = false,
}: {
  role: UserRole;
  plan: EmpresaPlan;
  isSuperAdmin?: boolean;
}) {
  return (
    <aside className="w-[190px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)] hidden lg:flex flex-col h-screen sticky top-0 overflow-y-auto">
      <div className="h-14 flex items-center px-4 border-b border-[var(--border)] shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
          Configuración
        </span>
      </div>
      <nav className="flex-1 py-1 px-2 space-y-0.5">
        <AdminConfigSection role={role} plan={plan} isSuperAdmin={isSuperAdmin} sectionLabel="Administración" />
      </nav>
    </aside>
  );
}
