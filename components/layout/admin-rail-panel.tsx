"use client";

import { usePathname } from "next/navigation";
import { UserRole } from "@/lib/types";
import { EmpresaPlan } from "@/lib/auth";
import { AdminConfigSection } from "./admin-config-section";
import { workspaceForPath } from "./workspace";

// Panel de cuenta: Planes/Configuración/Usuarios/Empresas. Vive pegado al
// borde derecho, afuera del rail de workspaces (que es solo el selector de
// ícono) — así el rail se mantiene angosto y este panel puede tener texto
// legible. Solo aparece en el workspace Administración, que es donde esta
// configuración tiene sentido.
export function AdminRailPanel({
  role,
  plan,
  isSuperAdmin = false,
}: {
  role: UserRole;
  plan: EmpresaPlan;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  if (workspaceForPath(pathname) !== "administracion") return null;

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
