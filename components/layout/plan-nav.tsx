"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HardHat } from "lucide-react";
import { EmpresaPlan } from "@/lib/auth";
import { UserRole } from "@/lib/types";
import { cn } from "@/lib/cn";

type PlanNavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  icon: typeof HardHat;
  minPlan: EmpresaPlan;
};

const PLAN_RANK: Record<EmpresaPlan, number> = { basico: 0, pro: 1, caterpillar: 2 };

// Todo lo que está por encima de Básico vive acá, no en el sidebar
// izquierdo — a medida que se agreguen más planes/tiers, este nav crece a
// la derecha en vez de forzar scroll infinito en el nav principal.
const PLAN_ITEMS: PlanNavItem[] = [
  { href: "/projects", label: "Proyectos", roles: ["administracion", "admin"], icon: HardHat, minPlan: "pro" },
];

export function PlanNav({ role, plan }: { role: UserRole; plan: EmpresaPlan }) {
  const pathname = usePathname();
  const rank = PLAN_RANK[plan];

  const items = PLAN_ITEMS.filter((item) => item.roles.includes(role) && rank >= PLAN_RANK[item.minPlan]);

  if (items.length === 0) return null;

  return (
    <aside className="w-[180px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)] hidden lg:flex flex-col h-screen sticky top-0">
      <div className="h-14 flex items-center px-4 border-b border-[var(--border)]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
          {plan === "caterpillar" ? "Caterpillar" : "Construcción"}
        </span>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {items.map((item) => {
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
        })}
      </nav>
    </aside>
  );
}
