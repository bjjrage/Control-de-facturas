"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Users, Building2, SignalHigh, ChevronLeft } from "lucide-react";
import { UserRole } from "@/lib/types";
import { EmpresaPlan } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { AdminConfigSection } from "./admin-config-section";

type RailSection = "plans" | "configuracion" | "users" | "empresas";

export function AdminRailPanel({
  role,
  plan,
  isSuperAdmin = false,
}: {
  role: UserRole;
  plan: EmpresaPlan;
  isSuperAdmin?: boolean;
}) {
  const [open, setOpen] = useState<RailSection | null>(null);
  const railRef = useRef<HTMLElement>(null);

  const items: { key: RailSection; label: string; icon: typeof Settings; visible: boolean }[] = [
    { key: "plans", label: "Planes", icon: SignalHigh, visible: role === "admin" },
    { key: "configuracion", label: "Configuración", icon: Settings, visible: role === "admin" },
    { key: "users", label: "Usuarios", icon: Users, visible: role === "admin" },
    { key: "empresas", label: "Empresas", icon: Building2, visible: isSuperAdmin },
  ].filter((item) => item.visible);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-admin-rail]") || target.closest("[data-admin-overlay]")) return;
      setOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <aside
      ref={railRef}
      data-admin-rail
      className="relative z-30 hidden lg:flex w-[52px] shrink-0 flex-col items-center border-l border-white/[0.08] bg-[#0a1626]/90 py-2.5 backdrop-blur-2xl"
    >
      <div className="flex-1 flex flex-col items-center gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = open === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setOpen((current) => (current === item.key ? null : item.key))}
              title={item.label}
              aria-label={item.label}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                active
                  ? "border-[#6f9aff]/30 bg-[linear-gradient(180deg,rgba(83,129,239,.42),rgba(48,82,162,.30))] text-white shadow-[0_0_0_1px_rgba(104,151,255,.10)]"
                  : "border-transparent text-[var(--muted)] hover:border-white/[0.08] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
              )}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>

      {open ? (
        <div
          data-admin-overlay
          className="absolute right-[calc(100%+8px)] top-2 w-[230px] overflow-hidden rounded-2xl border border-white/[0.11] bg-[#0b1728]/[0.985] p-2 shadow-[0_24px_58px_rgba(0,0,0,.48),inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur-2xl"
        >
          <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
            <div className="erp-kicker">
              {open === "plans"
                ? "Planes"
                : open === "configuracion"
                  ? "Configuración"
                  : open === "users"
                    ? "Usuarios"
                    : "Super admin"}
            </div>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
              aria-label="Cerrar"
            >
              <ChevronLeft size={14} />
            </button>
          </div>

          <AdminConfigSection
            role={role}
            plan={plan}
            isSuperAdmin={isSuperAdmin}
            focus={open}
          />
        </div>
      ) : null}
    </aside>
  );
}
