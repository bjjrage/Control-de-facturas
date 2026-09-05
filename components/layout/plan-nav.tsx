"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat, Settings, Users, Building2 } from "lucide-react";
import { EmpresaPlan } from "@/lib/auth";
import { UserRole } from "@/lib/types";
import { cn } from "@/lib/cn";

type PlanNavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  icon: typeof HardHat;
  minPlan?: EmpresaPlan;
  superAdmin?: boolean;
};

const PLAN_RANK: Record<EmpresaPlan, number> = { basico: 0, pro: 1, caterpillar: 2 };

// Todo lo que está por encima de Básico vive acá, no en el sidebar
// izquierdo — a medida que se agreguen más planes/tiers, este nav crece a
// la derecha en vez de forzar scroll infinito en el nav principal.
const PLAN_ITEMS: PlanNavItem[] = [
  { href: "/projects", label: "Proyectos", roles: ["administracion", "admin"], icon: HardHat, minPlan: "pro" },
];

// Configuración vive acá porque es donde se elige el plan — tiene sentido
// verla junto a lo que ese plan habilita, no en el nav principal separado.
const ADMIN_ITEMS: PlanNavItem[] = [
  { href: "/configuracion", label: "Configuración", roles: ["admin"], icon: Settings },
  { href: "/users", label: "Usuarios", roles: ["admin"], icon: Users },
];

const SUPER_ADMIN_ITEMS: PlanNavItem[] = [
  { href: "/empresas", label: "Empresas", roles: [], icon: Building2, superAdmin: true },
];

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
  const rank = PLAN_RANK[plan];

  const planItems = PLAN_ITEMS.filter(
    (item) => item.roles.includes(role) && (!item.minPlan || rank >= PLAN_RANK[item.minPlan])
  );
  const adminItems = ADMIN_ITEMS.filter((item) => item.roles.includes(role));
  const superAdminItems = isSuperAdmin ? SUPER_ADMIN_ITEMS : [];

  if (planItems.length === 0 && adminItems.length === 0 && superAdminItems.length === 0) return null;

  function renderLink(item: PlanNavItem) {
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

  function renderSection(label: string, items: PlanNavItem[]) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-0.5">
        <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
          {label}
        </div>
        {items.map(renderLink)}
      </div>
    );
  }

  return (
    <aside className="w-[190px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)] hidden lg:flex flex-col h-screen sticky top-0">
      <div className="h-14 flex items-center px-4 border-b border-[var(--border)]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
          {plan === "caterpillar" ? "Caterpillar" : plan === "pro" ? "Construcción" : "Más"}
        </span>
      </div>
      <nav className="flex-1 py-1 px-2 space-y-0.5 overflow-y-auto">
        {planItems.length > 0 ? renderSection(plan === "caterpillar" ? "Caterpillar" : "Construcción", planItems) : null}
        {renderSection("Administración", adminItems)}
        {renderSection("Super admin", superAdminItems)}
      </nav>
    </aside>
  );
}
