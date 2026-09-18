"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings, Users, Building2, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
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

// Íconos de señal (barras crecientes) para que el nivel se lea de un
// vistazo, no solo por el texto — Básico/Pro/Caterpillar son un orden
// jerárquico, no tres opciones sueltas. Tres colores fluor bien distintos
// entre sí y del --primary del nav izquierdo (así el plan activo nunca se
// confunde visualmente con un link de navegación activo). Nada de gris:
// acá el nivel tiene que resaltar, no verse apagado.
const PLANS: { value: EmpresaPlan; label: string; icon: typeof SignalLow; activeBg: string; activeText: string }[] = [
  { value: "basico", label: "Básico", icon: SignalLow, activeBg: "#39ff88", activeText: "#04210f" },
  { value: "pro", label: "Pro", icon: SignalMedium, activeBg: "#ff2ec4", activeText: "#2b0018" },
  { value: "caterpillar", label: "Caterpillar", icon: SignalHigh, activeBg: "#ffe600", activeText: "#241d00" },
];

// Sección de configuración embebida en el nav izquierdo del workspace
// Administración (planes, configuración, usuarios, super admin). Todo lo que
// es una acción o módulo de trabajo vive en el resto del sidebar — acá
// conviven solo las cosas que ajustan cómo funciona el sistema.
export function AdminConfigSection({
  role,
  plan,
  isSuperAdmin = false,
  collapsed = false,
  focus,
}: {
  role: UserRole;
  plan: EmpresaPlan;
  isSuperAdmin?: boolean;
  collapsed?: boolean;
  focus?: "plans" | "configuracion" | "users" | "empresas";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState(plan);
  const [pending, startTransition] = useTransition();

  const adminItems = ADMIN_ITEMS.filter((item) => {
    if (!item.roles.includes(role)) return false;
    if (focus === "configuracion") return item.href === "/configuracion";
    if (focus === "users") return item.href === "/users";
    if (focus === "plans" || focus === "empresas") return false;
    return true;
  });
  const superAdminItems = isSuperAdmin
    ? SUPER_ADMIN_ITEMS.filter((item) => !focus || focus === "empresas")
    : [];
  const canSeePlans = role === "admin" && (!focus || focus === "plans");

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
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex items-center gap-2.5 h-9 rounded-lg text-[13px] transition-colors",
          collapsed ? "justify-center px-0" : "px-3",
          active
            ? "bg-[var(--primary)] text-white font-medium"
            : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
        )}
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  function renderSection(label: string, children: React.ReactNode) {
    return (
      <div className="space-y-0.5">
        {!collapsed ? (
          <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {label}
          </div>
        ) : (
          <div className="border-t border-[var(--border)] my-1.5" />
        )}
        {children}
      </div>
    );
  }

  return (
    <>
      {canSeePlans
        ? renderSection(
            "Planes",
            <div className="space-y-0.5">
              {PLANS.map((p) => {
                const Icon = p.icon;
                const active = currentPlan === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    disabled={pending}
                    title={collapsed ? p.label : undefined}
                    onClick={() => handlePlanClick(p.value)}
                    style={active ? { background: p.activeBg, color: p.activeText } : undefined}
                    className={cn(
                      "w-full flex items-center gap-2.5 h-9 rounded-lg text-[13px] transition-colors text-left disabled:opacity-60",
                      collapsed ? "justify-center px-0" : "px-3",
                      active ? "font-semibold" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                    )}
                  >
                    <Icon size={15} className="shrink-0" strokeWidth={2.25} />
                    {!collapsed ? <span className="truncate">{p.label}</span> : null}
                  </button>
                );
              })}
            </div>
          )
        : null}
      {adminItems.length > 0 ? renderSection("Configuración", adminItems.map(renderLink)) : null}
      {superAdminItems.length > 0 ? renderSection("Super admin", superAdminItems.map(renderLink)) : null}
    </>
  );
}
