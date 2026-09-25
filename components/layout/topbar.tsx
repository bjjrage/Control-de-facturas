"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, HelpCircle, Building2, HardHat, Gavel, FolderOpen, LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { PROJECT_FEATURES } from "@/lib/projects/project-features";
import { Workspace, WORKSPACE_HOME, WORKSPACE_LABEL, workspaceForPath } from "./workspace";
import { getProjectNavInfo } from "@/app/(internal)/projects/actions";

type WorkspaceItem = { key: Workspace; icon: LucideIcon };

const PROJECT_ID_RE = /^\/projects\/([0-9a-f-]{20,})/i;

const PROJECT_TAB_CONTEXT: Record<string, { group: string; label: string }> = Object.fromEntries(
  PROJECT_FEATURES.map(({ key, group, label }) => [key, { group, label }])
);
// Keep old bookmarks understandable without advertising this renderer as a canonical tab.
PROJECT_TAB_CONTEXT.stock = { group: "Avance de obra", label: "Catálogo de materiales (legado)" };

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
                ? item.key === "administracion"
                  ? "workspace-admin-active"
                  : item.key === "operativo"
                    ? "workspace-operativo-active"
                    : "workspace-licitaciones-active"
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

export function Topbar({
  showOperativo,
  showLicitaciones,
}: {
  showOperativo: boolean;
  showLicitaciones: boolean;
}) {
  const pathname = usePathname();
  const projectId = pathname.match(PROJECT_ID_RE)?.[1] ?? null;
  const [projectInfo, setProjectInfo] = useState<{ id: string; name: string; code: string } | null>(null);
  const [projectTab, setProjectTab] = useState("presupuesto");

  useEffect(() => {
    const syncTab = () => setProjectTab(new URLSearchParams(window.location.search).get("tab") ?? "presupuesto");
    syncTab();
    const onTab = (event: Event) => setProjectTab((event as CustomEvent<string>).detail);
    window.addEventListener("niupack:tab", onTab);
    window.addEventListener("popstate", syncTab);
    return () => {
      window.removeEventListener("niupack:tab", onTab);
      window.removeEventListener("popstate", syncTab);
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      // Clear stale project context when the route has no project id.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjectInfo(null);
      return;
    }
    getProjectNavInfo(projectId).then((info) => {
      if (!cancelled) setProjectInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <header className="h-14 shrink-0 border-b border-white/[0.07] bg-[#091524]/72 px-3 flex items-center gap-3 sticky top-0 z-10 backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,.10)]">
      <WorkspaceSwitcher showOperativo={showOperativo} showLicitaciones={showLicitaciones} />
      <div className="hidden md:flex items-center gap-1">
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
      </div>
      {projectInfo ? (
        <div
          className="project-context-accent hidden min-w-0 max-w-[620px] items-center gap-2 rounded-xl border px-3 h-9 md:flex"
          title={projectInfo.name}
        >
          <FolderOpen size={14} className="shrink-0 text-[var(--accent-operativo)]" />
          <span className="truncate text-[12px] font-medium text-[#eaf1ff]">{projectInfo.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">{projectInfo.code}</span>
          <span className="text-[var(--muted)]">/</span>
          <span className="shrink-0 text-[11px] font-semibold text-[var(--accent-operativo)]">
            {PROJECT_TAB_CONTEXT[projectTab]?.group ?? "Obra"}
          </span>
          <span className="text-[var(--muted)]">/</span>
          <span className="shrink-0 text-[11px] text-[#dce9fb]">
            {PROJECT_TAB_CONTEXT[projectTab]?.label ?? projectTab}
          </span>
        </div>
      ) : null}
    </header>
  );
}
