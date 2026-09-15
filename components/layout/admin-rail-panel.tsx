"use client";

import { UserRole } from "@/lib/types";
import { EmpresaPlan } from "@/lib/auth";
import { AdminConfigSection } from "./admin-config-section";

// Panel de cuenta: Planes/Configuración/Usuarios/Empresas. Visible en TODA
// la app, sin importar el workspace activo — así era en el diseño original
// (plan-nav.tsx) antes de que existiera el concepto de workspace; gatearlo
// a "solo Administración" lo hacía desaparecer al entrar a Operativo o
// Licitaciones, que es justamente donde alguien puede querer cambiar de
// plan o revisar usuarios sin cortar lo que está haciendo.
export function AdminRailPanel({
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
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Cuenta</span>
      </div>
      <nav className="flex-1 py-2 px-2 space-y-0.5">
        <AdminConfigSection role={role} plan={plan} isSuperAdmin={isSuperAdmin} />
      </nav>
    </aside>
  );
}
