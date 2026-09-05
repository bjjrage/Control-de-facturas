"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Package,
  Truck,
  ChevronsLeft,
  ChevronsRight,
  ImagePlus,
  ChevronDown,
  ReceiptText,
  Contact,
  FileClock,
  ClipboardList,
  Banknote,
  Wallet,
  HardHat,
  ClipboardCheck,
  GanttChartSquare,
  Hammer,
  Users,
  FolderOpen,
  X,
} from "lucide-react";
import { UserRole } from "@/lib/types";
import { EmpresaPlan } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { logout } from "@/app/(internal)/actions";
import { uploadLogo } from "./branding-actions";
import { LOGO_STORAGE_PATH } from "./branding-constants";
import { getProjectNavInfo } from "@/app/(internal)/projects/actions";

// Sub-secciones de un proyecto — mismas tabs que /projects/[id]?tab=X, pero
// como items de sidebar cuando estás "adentro" del proyecto (modo carpeta).
const PROJECT_TABS: { key: string; label: string; icon: typeof LayoutDashboard; caterpillarOnly?: boolean }[] = [
  { key: "presupuesto", label: "Presupuesto", icon: ClipboardCheck },
  { key: "cronograma", label: "Cronograma", icon: GanttChartSquare },
  { key: "ejecucion", label: "Ejecución", icon: Hammer },
  { key: "compras", label: "Compras", icon: Package },
  { key: "facturas", label: "Facturas", icon: Receipt },
  { key: "pagos", label: "Pagos", icon: Wallet },
  { key: "personal", label: "Personal", icon: Users, caterpillarOnly: true },
  { key: "subcontratistas", label: "Subcontratistas", icon: Truck, caterpillarOnly: true },
  { key: "informes", label: "Informes", icon: FileText },
];

// UUID v4-ish: alcanza para distinguir /projects/{id} de /projects (lista) y
// /projects/nuevo si algún día existiera esa ruta.
const PROJECT_ID_RE = /^\/projects\/([0-9a-f-]{20,})/i;

type Module = "compras" | "ventas";

type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  icon: typeof LayoutDashboard;
  superAdmin?: boolean;
  module?: Module;
};

const GLOBAL_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["comercial", "administracion", "admin"], icon: LayoutDashboard },
];

// Proyectos va justo debajo de Dashboard — es una acción/módulo de trabajo,
// no una configuración, así que vive en el nav izquierdo con todo lo demás.
// Gateado por plan (Pro o superior), no por module: no depende de compras/ventas.
const PROYECTOS_ITEM: NavItem = {
  href: "/projects",
  label: "Proyectos",
  roles: ["administracion", "admin"],
  icon: HardHat,
};

const COMPRAS_ITEMS: NavItem[] = [
  { href: "/providers", label: "Proveedores", roles: ["admin"], icon: Truck, module: "compras" },
  { href: "/rfqs", label: "Cotizaciones", roles: ["comercial", "admin"], icon: FileText, module: "compras" },
  { href: "/orders", label: "Órdenes de compra", roles: ["comercial", "administracion", "admin"], icon: Package, module: "compras" },
  { href: "/invoices", label: "Facturas", roles: ["administracion", "admin"], icon: Receipt, module: "compras" },
  { href: "/pagos", label: "Pagos", roles: ["administracion", "admin"], icon: Wallet, module: "compras" },
];

const VENTAS_ITEMS: NavItem[] = [
  { href: "/clientes", label: "Clientes", roles: ["administracion", "admin"], icon: Contact, module: "ventas" },
  { href: "/proformas", label: "Proformas", roles: ["administracion", "admin"], icon: FileClock, module: "ventas" },
  { href: "/remisiones", label: "Remisiones", roles: ["administracion", "admin"], icon: ClipboardList, module: "ventas" },
  { href: "/facturas-venta", label: "Facturas de Venta", roles: ["administracion", "admin"], icon: ReceiptText, module: "ventas" },
  { href: "/cobros", label: "Cobros", roles: ["administracion", "admin"], icon: Banknote, module: "ventas" },
];

const logoBucketUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${LOGO_STORAGE_PATH}`
  : null;

const PLAN_RANK: Record<EmpresaPlan, number> = { basico: 0, pro: 1, caterpillar: 2 };

export function Sidebar({
  role,
  fullName,
  isSuperAdmin = false,
  modules,
  plan = "basico",
}: {
  role: UserRole;
  fullName: string;
  isSuperAdmin?: boolean;
  modules: { compras: boolean; ventas: boolean };
  plan?: EmpresaPlan;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === "admin";
  const initial = fullName.trim().charAt(0).toUpperCase() || "?";

  // Modo "carpeta": adentro de un proyecto, todo el nav de la izquierda pasa
  // a ser sub-secciones de ESE proyecto (Compras/Facturas/Pagos incluidos)
  // en vez del listado global de la empresa entera.
  const projectMatch = pathname.match(PROJECT_ID_RE);
  const activeProjectId = projectMatch?.[1] ?? null;
  const [projectInfo, setProjectInfo] = useState<{ id: string; name: string; code: string } | null>(null);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectInfo(null);
      return;
    }
    let cancelled = false;
    getProjectNavInfo(activeProjectId).then((info) => {
      if (!cancelled) setProjectInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const inProjectMode = activeProjectId !== null && projectInfo !== null && projectInfo.id === activeProjectId;
  const isCaterpillarPlan = plan === "caterpillar";
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") ?? "presupuesto";

  function filterItems(items: NavItem[]) {
    return items.filter((item) => {
      if (item.superAdmin) return isSuperAdmin;
      if (!item.roles.includes(role)) return false;
      if (item.module && !modules[item.module] && !isSuperAdmin) return false;
      return true;
    });
  }

  // Pro/Caterpillar SUMAN Proyectos sobre todo lo que la empresa ya tiene —
  // no reemplazan ni ocultan Compras/Ventas. Un plan más alto nunca debe
  // sacar funciones que la empresa ya usaba en Básico.
  const globalItems = filterItems(GLOBAL_ITEMS);
  const proyectosItems = PLAN_RANK[plan] >= PLAN_RANK.pro ? filterItems([PROYECTOS_ITEM]) : [];
  const comprasItems = filterItems(COMPRAS_ITEMS);
  const ventasItems = filterItems(VENTAS_ITEMS);

  async function handleLogoFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const result = await uploadLogo(fd);
      if (result.error) {
        alert(result.error);
      } else {
        setLogoFailed(false);
        setLogoVersion((v) => v + 1);
      }
    } catch {
      alert("Se cortó la conexión al subir el logo — probá de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  function renderLink(item: NavItem) {
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

  function renderSection(label: string, items: NavItem[]) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {!collapsed ? (
          <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {label}
          </div>
        ) : (
          <div className="border-t border-[var(--border)] my-1.5" />
        )}
        {items.map(renderLink)}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col h-screen sticky top-0 transition-[width] duration-150",
        collapsed ? "w-[68px]" : "w-[220px]"
      )}
    >
      <div className="h-14 flex items-center justify-between px-3 border-b border-[var(--border)]">
        <div
          className={cn(
            "relative group h-9 flex items-center rounded-md",
            isAdmin && "cursor-pointer hover:bg-[var(--hover)]",
            collapsed ? "w-9 justify-center" : "px-1.5 flex-1 min-w-0"
          )}
          onClick={() => isAdmin && !uploading && fileInputRef.current?.click()}
          title={isAdmin ? "Subir logo de la empresa" : undefined}
        >
          {logoBucketUrl && !logoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${logoBucketUrl}?v=${logoVersion}`}
              alt="Logo"
              className="h-8 max-w-full object-contain"
              onError={() => setLogoFailed(true)}
            />
          ) : !collapsed ? (
            <span className="text-[17px] font-semibold truncate">
              <span className="text-[var(--primary)]">niu</span>.pack
            </span>
          ) : (
            <span className="text-[15px] font-semibold text-[var(--primary)]">n</span>
          )}
          {isAdmin ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              {uploading ? (
                <span className="text-[10px] text-white">Subiendo…</span>
              ) : (
                <ImagePlus size={14} className="text-white" />
              )}
            </div>
          ) : null}
        </div>
        {isAdmin ? (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
          />
        ) : null}
        {!collapsed ? (
          <button
            onClick={() => setCollapsed(true)}
            className="text-[var(--muted)] hover:text-[var(--foreground)] shrink-0"
            title="Colapsar menú"
          >
            <ChevronsLeft size={16} />
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="h-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] border-b border-[var(--border)]"
          title="Expandir menú"
        >
          <ChevronsRight size={16} />
        </button>
      ) : null}

      {inProjectMode && projectInfo ? (
        <div className={cn("border-b border-[var(--border)] bg-[var(--panel-2)]", collapsed ? "px-1.5 py-2" : "px-3 py-2.5")}>
          {!collapsed ? (
            <>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--primary)]">
                <FolderOpen size={12} />
                Proyecto
              </div>
              <div className="text-[13px] font-medium truncate mt-0.5" title={projectInfo.name}>
                {projectInfo.name}
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[11px] text-[var(--muted)] font-mono">{projectInfo.code}</span>
                <Link
                  href="/projects"
                  className="flex items-center gap-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                  title="Salir del proyecto"
                >
                  <X size={11} /> Salir
                </Link>
              </div>
            </>
          ) : (
            <Link href="/projects" title={`Salir de ${projectInfo.name}`} className="flex justify-center text-[var(--primary)]">
              <FolderOpen size={16} />
            </Link>
          )}
        </div>
      ) : null}

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {inProjectMode ? (
          <>
            {globalItems.map(renderLink)}
            {PROJECT_TABS.filter((t) => !t.caterpillarOnly || isCaterpillarPlan).map((t) => {
              const Icon = t.icon;
              const active = currentTab === t.key;
              return (
                <Link
                  key={t.key}
                  href={`/projects/${activeProjectId}?tab=${t.key}`}
                  title={collapsed ? t.label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 h-9 rounded-lg text-[13px] transition-colors",
                    collapsed ? "justify-center px-0" : "px-3",
                    active
                      ? "bg-[var(--primary)] text-white font-medium"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  {!collapsed ? <span className="truncate">{t.label}</span> : null}
                </Link>
              );
            })}
          </>
        ) : (
          <>
            {globalItems.map(renderLink)}
            {proyectosItems.map(renderLink)}
            {renderSection("Compras", comprasItems)}
            {renderSection("Ventas", ventasItems)}
          </>
        )}
      </nav>

      <div className="border-t border-[var(--border)] p-3">
        <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
          <div className="h-8 w-8 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-[13px] font-semibold shrink-0">
            {initial}
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium truncate">{fullName}</div>
              <div className="text-[11px] text-[var(--muted)] capitalize truncate">{role}</div>
            </div>
          ) : null}
          {!collapsed ? <ChevronDown size={14} className="text-[var(--muted)] shrink-0" /> : null}
        </div>
        {!collapsed ? (
          <form action={logout} className="mt-2">
            <button className="text-action text-[11px] text-[var(--muted)]">
              Cerrar sesión
            </button>
          </form>
        ) : null}
      </div>
    </aside>
  );
}
