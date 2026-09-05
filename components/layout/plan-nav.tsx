"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Users, Building2 } from "lucide-react";
import { EmpresaPlan } from "@/lib/auth";
import { UserRole } from "@/lib/types";
import { cn } from "@/lib/cn";
import { updateEmpresaPlan } from "@/app/(internal)/configuracion/actions";

type NavLink = { href: string; label: string; roles: UserRole[]; icon: typeof Settings; superAdmin?: boolean };

const ADMIN_ITEMS: NavLink[] = [
  { href: "/configuracion", label: "Configuración", roles: ["admin"], icon: Settings },
  { href: "/users", label: "Usuarios", roles: ["admin"], icon: Users },
];

const SUPER_ADMIN_ITEMS: NavLink[] = [
  { href: "/empresas", label: "Empresas", roles: [], icon: Building2, superAdmin: true },
];

const PLANS: { value: EmpresaPlan; label: string }[] = [
  { value: "basico", label: "Básico" },
  { value: "pro", label: "Pro" },
  { value: "caterpillar", label: "Caterpillar" },
];

// Nav derecho = pura configuración (planes, administración, super admin).
// Todo lo que es una acción o módulo de trabajo (Proyectos incluido) vive en
// el sidebar izquierdo — acá conviven solo las cosas que ajustan cómo
// funciona el sistema, no las que se usan para trabajar.
export function PlanNav({
  role,
  plan,
  isSuperAdmin = false,
}: {
  role: UserRole;
  plan: EmpresaPlan;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState(plan);
  const [pending, startTransition] = useTransition();

  const adminItems = ADMIN_ITEMS.filter((item) => item.roles.includes(role));
  const superAdminItems = isSuperAdmin ? SUPER_ADMIN_ITEMS : [];
  const canSeePlans = role === "admin";

  if (!canSeePlans && adminItems.length === 0 && superAdminItems.length === 0) return null;

  function handlePlanClick(next: EmpresaPlan) {
    if (next === currentPlan || pending) return;
    setCurrentPlan(next);
    startTransition(async () => {
      const result = await updateEmpresaPlan(next);
      if (result.error) {
        setCurrentPlan(plan);
        return;
      }
      router.refresh();
    });
  }

  function renderLink(item: NavLink) {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] transition-colors",
          active
            ? "bg-[var(--primary)] text-white font-medium"
            : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
        )}
      >
        <Icon size={16} className="shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  function renderSection(label: string, children: React.ReactNode) {
    return (
      <div className="space-y-0.5">
        <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
          {label}
        </div>
        {children}
      </div>
    );
  }

  return (
    <aside className="w-[190px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)] hidden lg:flex flex-col h-screen sticky top-0">
      <div className="h-14 flex items-center px-4 border-b border-[var(--border)]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Configuración</span>
      </div>
      <nav className="flex-1 py-1 px-2 space-y-0.5 overflow-y-auto">
        {canSeePlans
          ? renderSection(
              "Planes",
              <div className="space-y-0.5">
                {PLANS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={pending}
                    onClick={() => handlePlanClick(p.value)}
                    className={cn(
                      "w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] transition-colors text-left disabled:opacity-60",
                      currentPlan === p.value
                        ? "bg-[var(--primary)] text-white font-medium"
                        : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        currentPlan === p.value ? "bg-white" : "bg-[var(--border)]"
                      )}
                    />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>
            )
          : null}
        {adminItems.length > 0 ? renderSection("Administración", adminItems.map(renderLink)) : null}
        {superAdminItems.length > 0 ? renderSection("Super admin", superAdminItems.map(renderLink)) : null}
      </nav>
    </aside>
  );
}
