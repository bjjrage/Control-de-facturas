"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, HardHat, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";
import { ProjectStatus } from "@/lib/types";
import { getProjectsForSwitcher } from "@/app/(internal)/projects/actions";

type SwitcherProject = { id: string; name: string; code: string; status: ProjectStatus };

// Cache a nivel módulo: mismo criterio que _navCache en sidebar.tsx — evita
// re-pedir la lista completa cada vez que se abre el selector en la sesión.
let _cache: SwitcherProject[] | null = null;

// Selector de obra del workspace Operativo. Vive arriba del nav izquierdo:
// fuera de un proyecto invita a elegir uno; adentro, permite saltar a otro
// sin pasar por el listado completo de /projects.
export function ObraSelector({
  activeProjectId,
  activeName,
  collapsed = false,
}: {
  activeProjectId: string | null;
  activeName: string | null;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<SwitcherProject[] | null>(_cache);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleOpen() {
    setOpen((v) => !v);
    if (!_cache) {
      getProjectsForSwitcher().then((data) => {
        _cache = data;
        setProjects(data);
      });
    }
  }

  const activos = (projects ?? []).filter((p) => p.status === "ACTIVO" && p.id !== activeProjectId);
  const otros = (projects ?? []).filter((p) => p.status !== "ACTIVO" && p.id !== activeProjectId);

  if (collapsed) {
    return (
      <Link
        href="/projects"
        title={activeName ? `Obra: ${activeName}` : "Elegir obra"}
        className="flex items-center justify-center h-9 rounded-lg text-[var(--primary)] hover:bg-[var(--hover)]"
      >
        <HardHat size={16} />
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative px-2 pt-2 pb-1">
      <button
        onClick={handleOpen}
        className={cn(
          "w-full flex items-center gap-2 h-9 px-2.5 rounded-lg text-[13px] transition-colors border",
          activeName
            ? "border-[var(--border)] bg-[var(--panel-2)] hover:bg-[var(--hover)]"
            : "border-dashed border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
        )}
      >
        <HardHat size={15} className="shrink-0 text-[var(--primary)]" />
        <span className="flex-1 min-w-0 text-left truncate font-medium">
          {activeName ?? "Seleccionar obra"}
        </span>
        <ChevronDown size={13} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-2 right-2 top-full mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-lg z-50 py-1">
          {projects === null ? (
            <div className="px-3 py-2.5 text-[12px] text-[var(--muted)]">Cargando obras…</div>
          ) : projects.length === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-[var(--muted)]">No hay obras todavía.</div>
          ) : (
            <>
              {activos.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] hover:bg-[var(--hover)]"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[11px] text-[var(--muted)] font-mono shrink-0">{p.code}</span>
                </Link>
              ))}
              {otros.length > 0 ? (
                <>
                  {activos.length > 0 ? <div className="border-t border-[var(--border)] my-1" /> : null}
                  {otros.map((p) => (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-[11px] font-mono shrink-0">{p.code}</span>
                    </Link>
                  ))}
                </>
              ) : null}
            </>
          )}
          <div className="border-t border-[var(--border)] mt-1 pt-1">
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
            >
              <LayoutGrid size={13} />
              Ver portafolio completo
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
