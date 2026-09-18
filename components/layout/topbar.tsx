"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Bell, HelpCircle, ChevronDown, Building2, HardHat, Gavel, LucideIcon } from "lucide-react";
import { UserRole } from "@/lib/types";
import { cn } from "@/lib/cn";
import { logout } from "@/app/(internal)/actions";
import { Workspace, WORKSPACE_HOME, WORKSPACE_LABEL, workspaceForPath } from "./workspace";

type WorkspaceItem = { key: Workspace; icon: LucideIcon };

const WORKSPACE_ITEMS: WorkspaceItem[] = [
  { key: "administracion", icon: Building2 },
  { key: "operativo", icon: HardHat },
  { key: "licitaciones", icon: Gavel },
];

// 3 botones, nada más: en qué workspace estoy. Antes era un segundo navbar
// vertical propio (76px, toda la altura de pantalla) — acá vive junto al
// resto de la topbar (buscador, notificaciones, ayuda, perfil), no como una
// pieza de layout aparte.
function WorkspaceSwitcher({ showOperativo, showLicitaciones }: { showOperativo: boolean; showLicitaciones: boolean }) {
  const pathname = usePathname();
  const active = workspaceForPath(pathname);

  const items = WORKSPACE_ITEMS.filter((item) => {
    if (item.key === "operativo") return showOperativo;
    if (item.key === "licitaciones") return showLicitaciones;
    return true;
  });

  return (
    <div className="hidden md:flex items-center gap-1 rounded-full border border-white/[0.09] bg-white/[0.035] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.key;
        return (
          <Link
            key={item.key}
            href={WORKSPACE_HOME[item.key]}
            className={cn(
              "flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-medium transition-all duration-150",
              isActive
                ? "bg-[linear-gradient(180deg,rgba(92,140,255,.72),rgba(57,95,190,.58))] text-white shadow-[0_0_0_1px_rgba(118,160,255,.45),0_8px_22px_rgba(31,73,166,.28)]"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
            )}
          >
            <Icon size={14} className="shrink-0" strokeWidth={isActive ? 2.25 : 2} />
            {WORKSPACE_LABEL[item.key]}
          </Link>
        );
      })}
    </div>
  );
}

function UserMenu({ initial, fullName, role }: { initial: string; fullName: string; role: UserRole }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-9 rounded-xl px-2 hover:bg-white/[0.055] transition-colors"
      >
        <div className="h-7 w-7 rounded-full bg-[var(--primary)] text-[#1a0e00] flex items-center justify-center text-[12px] font-semibold shrink-0">
          {initial}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-[12px] font-medium leading-tight">{fullName}</div>
          <div className="text-[11px] text-[var(--muted)] capitalize leading-tight">{role}</div>
        </div>
        <ChevronDown size={13} className={`text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-white/[0.10] bg-[#0c1829]/96 shadow-[0_24px_60px_rgba(0,0,0,.42)] backdrop-blur-2xl z-50 py-1.5">
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="text-[12px] font-medium truncate">{fullName}</div>
            <div className="text-[11px] text-[var(--muted)] capitalize">{role}</div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] transition-colors"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({
  initial,
  fullName,
  role,
  showOperativo,
  showLicitaciones,
}: {
  initial: string;
  fullName: string;
  role: UserRole;
  showOperativo: boolean;
  showLicitaciones: boolean;
}) {
  return (
    <header className="h-14 shrink-0 border-b border-white/[0.07] bg-[#091524]/72 px-4 flex items-center gap-3 sticky top-0 z-10 backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,.10)]">
      <div className="flex-1 max-w-md">
        <div className="flex items-center gap-2 h-9 rounded-xl bg-white/[0.035] border border-white/[0.08] px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
          <Search size={15} className="text-[var(--muted)] shrink-0" />
          <input
            placeholder="Buscar en niu.pack…"
            disabled
            className="bg-transparent outline-none text-[13px] w-full placeholder:text-[var(--muted)] disabled:cursor-default"
          />
        </div>
      </div>
      <WorkspaceSwitcher showOperativo={showOperativo} showLicitaciones={showLicitaciones} />
      <div className="flex items-center gap-1 ml-auto">
        <button
          disabled
          className="h-9 w-9 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--hover)] disabled:hover:bg-transparent disabled:opacity-60"
          title="Notificaciones (próximamente)"
        >
          <Bell size={16} />
        </button>
        <button
          disabled
          className="h-9 w-9 rounded-full flex items-center justify-center text-[var(--muted)] hover:bg-[var(--hover)] disabled:hover:bg-transparent disabled:opacity-60"
          title="Ayuda (próximamente)"
        >
          <HelpCircle size={16} />
        </button>
        <UserMenu initial={initial} fullName={fullName} role={role} />
      </div>
    </header>
  );
}
