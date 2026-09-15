"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, HardHat, Gavel, LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Workspace, WORKSPACE_HOME, WORKSPACE_LABEL, workspaceForPath } from "./workspace";

type RailItem = { key: Workspace; icon: LucideIcon };

const ITEMS: RailItem[] = [
  { key: "administracion", icon: Building2 },
  { key: "operativo", icon: HardHat },
  { key: "licitaciones", icon: Gavel },
];

// Navbar derecho: SOLO responde "¿en qué workspace estoy?". Compacto a
// propósito — nada de sub-listas ni configuración acá, eso vive en el nav
// izquierdo de cada workspace.
export function WorkspaceRail({
  showOperativo,
  showLicitaciones,
}: {
  showOperativo: boolean;
  showLicitaciones: boolean;
}) {
  const pathname = usePathname();
  const active = workspaceForPath(pathname);

  const items = ITEMS.filter((item) => {
    if (item.key === "operativo") return showOperativo;
    if (item.key === "licitaciones") return showLicitaciones;
    return true;
  });

  return (
    <aside className="w-[76px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)]/80 backdrop-blur-sm hidden sm:flex flex-col h-screen sticky top-0">
      <div className="h-14 flex items-center justify-center border-b border-[var(--border)]">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--muted)]">Workspace</span>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={WORKSPACE_HOME[item.key]}
              title={WORKSPACE_LABEL[item.key]}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-h-16 py-2.5 rounded-xl text-[10px] font-medium transition-all duration-150",
                isActive
                  ? "bg-[var(--nav-active)] text-white shadow-[0_0_0_1px_rgba(129,155,255,0.7),0_0_18px_-2px_rgba(91,124,250,0.75)]"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
              )}
            >
              <Icon size={18} className="shrink-0" strokeWidth={isActive ? 2.25 : 2} />
              <span className="leading-[1.2] text-center px-1.5 break-words">
                {WORKSPACE_LABEL[item.key]}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
