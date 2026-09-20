"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Package,
  Boxes,
  Truck,
  ChevronsLeft,
  ChevronsRight,
  ChevronRight,
  ImagePlus,
  ReceiptText,
  Contact,
  FileClock,
  ClipboardList,
  Banknote,
  Wallet,
  ClipboardCheck,
  GanttChartSquare,
  Hammer,
  Users,
  FolderOpen,
  X,
  MessagesSquare,
  FileCheck2,
  FileX,
  Landmark,
  ChevronDown,
  Gavel,
  Radar,
  Bot,
  FlaskConical,
  ShoppingCart,
  BadgeDollarSign,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";
import { UserRole } from "@/lib/types";
import { logout } from "@/app/(internal)/actions";
import { EmpresaPlan } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { uploadLogo } from "./branding-actions";
import { LOGO_STORAGE_PATH } from "./branding-constants";
import { getProjectNavInfo } from "@/app/(internal)/projects/actions";
import { SHELL_PATHS } from "./app-shell-client";
import { workspaceForPath } from "./workspace";

// Sub-secciones de un proyecto — mismas tabs que /projects/[id]?tab=X, pero
// como items de sidebar cuando estás "adentro" del proyecto (modo carpeta).
// Agrupadas por fase del ciclo de una obra: preparás → comprás → ejecutás →
// certificás y controlás. El orden sigue el flujo real de trabajo.
type ProjectTab = { key: string; label: string; icon: typeof LayoutDashboard; caterpillarOnly?: boolean };
const PROJECT_TAB_GROUPS: { label: string; tabs: ProjectTab[] }[] = [
  { label: "Preparar", tabs: [
    { key: "presupuesto", label: "Presupuesto", icon: ClipboardCheck },
    { key: "cronograma", label: "Cronograma", icon: GanttChartSquare },
    { key: "bim", label: "BIM", icon: Boxes, caterpillarOnly: true },
  ]},
  { label: "Comprar", tabs: [
    { key: "proveedores", label: "Proveedores", icon: Truck },
    { key: "cotizaciones", label: "Cotizaciones", icon: MessagesSquare },
    { key: "compras", label: "OC", icon: Package },
    { key: "facturas", label: "Facturas", icon: Receipt },
    { key: "pagos", label: "Pagos", icon: Wallet },
  ]},
  { label: "Ejecutar", tabs: [
    { key: "ejecucion", label: "Ejecución", icon: Hammer },
    { key: "stock", label: "Stock / Materiales", icon: Boxes },
    { key: "personal", label: "Personal", icon: Users, caterpillarOnly: true },
    { key: "subcontratistas", label: "Subcontratistas", icon: Truck, caterpillarOnly: true },
  ]},
  { label: "Certificar", tabs: [
    { key: "certificados", label: "Certificados", icon: FileCheck2, caterpillarOnly: true },
    { key: "avance-fisico", label: "Avance físico", icon: GanttChartSquare, caterpillarOnly: true },
    { key: "informes", label: "Informes", icon: FileText },
  ]},
];

// UUID v4-ish: alcanza para distinguir /projects/{id} de /projects (lista) y
// /projects/nuevo si algún día existiera esa ruta.
const PROJECT_ID_RE = /^\/projects\/([0-9a-f-]{20,})/i;

// Cache a nivel módulo: persiste durante la sesión de browser y evita el flash
// global→proyecto cuando el usuario vuelve a un proyecto que ya visitó.
const _navCache = new Map<string, { id: string; name: string; code: string }>();

type Module = "compras" | "ventas";

type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  icon: typeof LayoutDashboard;
  superAdmin?: boolean;
  module?: Module;
  minPlan?: EmpresaPlan;
};

const GLOBAL_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["comercial", "administracion", "admin"], icon: LayoutDashboard },
];

const OPERATIVO_ITEMS: NavItem[] = [
  { href: "/projects", label: "Dashboard", roles: ["administracion", "admin"], icon: FolderOpen, minPlan: "pro" },
];

const LICITACIONES_ITEMS: NavItem[] = [
  { href: "/licitaciones", label: "Dashboard", roles: ["comercial", "administracion", "admin"], icon: Gavel, minPlan: "pro" },
  { href: "/licitaciones/competidores", label: "Competidores", roles: ["comercial", "administracion", "admin"], icon: Radar, minPlan: "pro" },
  { href: "/licitaciones/documentos", label: "Documentos", roles: ["comercial", "administracion", "admin"], icon: FileText, minPlan: "pro" },
  { href: "/licitaciones/auction-bot", label: "Auction Bot", roles: ["comercial", "administracion", "admin"], icon: Bot, minPlan: "pro" },
  { href: "/licitaciones/auction-lab", label: "Auction Lab", roles: ["comercial", "administracion", "admin"], icon: FlaskConical, minPlan: "pro" },
];

const COMPRAS_ITEMS: NavItem[] = [
  { href: "/providers", label: "Proveedores", roles: ["admin"], icon: Truck, module: "compras" },
  { href: "/rfqs", label: "Cotizaciones", roles: ["comercial", "admin"], icon: FileText, module: "compras" },
  { href: "/orders", label: "OC", roles: ["comercial", "administracion", "admin"], icon: Package, module: "compras" },
  { href: "/invoices", label: "Facturas", roles: ["administracion", "admin"], icon: Receipt, module: "compras" },
  { href: "/pagos", label: "Pagos", roles: ["administracion", "admin"], icon: Wallet, module: "compras" },
  { href: "/stock", label: "Stock", roles: ["administracion", "admin"], icon: Boxes, module: "compras", minPlan: "pro" },
];

const FINANZAS_ITEMS: NavItem[] = [
  { href: "/tesoreria", label: "Tesorería", roles: ["administracion", "admin"], icon: Landmark },
  { href: "/flujo-caja", label: "Flujo de caja", roles: ["administracion", "admin"], icon: GanttChartSquare },
];

const VENTAS_ITEMS: NavItem[] = [
  { href: "/clientes", label: "Clientes", roles: ["administracion", "admin"], icon: Contact, module: "ventas" },
  { href: "/proformas", label: "Proformas", roles: ["administracion", "admin"], icon: FileClock, module: "ventas" },
  { href: "/ordenes-trabajo", label: "OT", roles: ["administracion", "admin"], icon: Hammer, module: "ventas" },
  { href: "/remisiones", label: "Remisiones", roles: ["administracion", "admin"], icon: ClipboardList, module: "ventas" },
  { href: "/facturas-venta", label: "Facturas", roles: ["administracion", "admin"], icon: ReceiptText, module: "ventas" },
  { href: "/notas-credito", label: "NC", roles: ["administracion", "admin"], icon: FileX, module: "ventas" },
  { href: "/cobros", label: "Cobros", roles: ["administracion", "admin"], icon: Banknote, module: "ventas" },
];

const logoBucketUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${LOGO_STORAGE_PATH}`
  : null;

const PLAN_RANK: Record<EmpresaPlan, number> = { basico: 0, pro: 1, caterpillar: 2 };

function SidebarUserMenu({
  collapsed,
  fullName,
  initial,
  role,
}: {
  collapsed: boolean;
  fullName: string;
  initial: string;
  role: string;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (userRef.current && !userRef.current.contains(event.target as Node)) setUserOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={userRef} className="relative border-t border-white/[0.08] p-1.5">
      <button
        type="button"
        onClick={() => setUserOpen((value) => !value)}
        className={cn(
          "w-full flex items-center h-10 rounded-xl transition-colors hover:bg-white/[0.055]",
          collapsed ? "justify-center px-0" : "gap-2 px-2"
        )}
        title={collapsed ? fullName : undefined}
      >
        <div className="h-7 w-7 rounded-full bg-[var(--primary)] text-[#08111f] flex items-center justify-center text-[12px] font-semibold shrink-0">
          {initial}
        </div>
        {!collapsed ? (
          <>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-[11px] font-medium leading-tight">{fullName}</div>
              <div className="truncate text-[10px] text-[var(--muted)] capitalize leading-tight">{role}</div>
            </div>
            <ChevronDown size={12} className={cn("shrink-0 text-[var(--muted)] transition-transform", userOpen && "rotate-180")} />
          </>
        ) : null}
      </button>

      {userOpen ? (
        <div
          className={cn(
            "absolute bottom-[calc(100%+6px)] z-[80] w-48 overflow-hidden rounded-xl border border-white/[0.10] bg-[#0b1728]/[0.985] shadow-[0_24px_60px_rgba(0,0,0,.46)] backdrop-blur-2xl",
            collapsed ? "left-1.5" : "left-1.5"
          )}
        >
          <div className="border-b border-white/[0.08] px-3 py-2">
            <div className="truncate text-[12px] font-medium">{fullName}</div>
            <div className="text-[10px] text-[var(--muted)] capitalize">{role}</div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-full px-3 py-2 text-left text-[11px] text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

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
  const workspace = workspaceForPath(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [openSection, setOpenSection] = useState<{
    label: string;
    items: NavItem[];
  } | null>(null);
  const [openProjectSection, setOpenProjectSection] = useState<string | null>(null);
  // Tracks the "active" path for shell-managed sections, since pushState doesn't
  // update usePathname(). Syncs from both our custom events and real Next.js nav.
  const [navPath, setNavPath] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [normalizedLogoSrc, setNormalizedLogoSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === "admin";
  const initial = fullName.trim().charAt(0).toUpperCase() || "?";

  // Modo "carpeta": adentro de un proyecto, todo el nav de la izquierda pasa
  // a ser sub-secciones de ESE proyecto (Compras/Facturas/Pagos incluidos)
  // en vez del listado global de la empresa entera.
  const projectMatch = pathname.match(PROJECT_ID_RE);
  const activeProjectId = projectMatch?.[1] ?? null;
  // Cache module-level para que el sidebar aparezca sin flash en visitas repetidas.
  const [projectInfo, setProjectInfo] = useState<{ id: string; name: string; code: string } | null>(
    () => (activeProjectId ? (_navCache.get(activeProjectId) ?? null) : null)
  );
  // true mientras hay un fetch en vuelo para el proyecto actual
  const [fetchingId, setFetchingId] = useState<string | null>(() =>
    activeProjectId && !_navCache.has(activeProjectId) ? activeProjectId : null
  );

  useEffect(() => {
    if (!activeProjectId) {
      // Clear project-specific navigation when the route leaves a project.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjectInfo(null);
      setFetchingId(null);
      return;
    }
    const cached = _navCache.get(activeProjectId);
    if (cached) {
      setProjectInfo(cached);
      setFetchingId(null);
    } else {
      setFetchingId(activeProjectId);
    }
    let cancelled = false;
    getProjectNavInfo(activeProjectId).then((info) => {
      if (!cancelled) {
        if (info) {
          _navCache.set(activeProjectId, info);
          setProjectInfo(info);
        }
        setFetchingId(null); // siempre termina el loading, haya info o no
      }
    });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const inProjectMode = activeProjectId !== null && projectInfo !== null && projectInfo.id === activeProjectId;
  // Skeleton solo mientras hay un fetch activo para este proyecto
  const isLoadingProjectMode = fetchingId === activeProjectId && activeProjectId !== null;
  const isCaterpillarPlan = plan === "caterpillar";

  // Tab activo en modo proyecto — se sincroniza sin Next.js navigation para
  // que los clicks del sidebar no disparen re-renders del servidor.
  const [currentTab, setCurrentTab] = useState("presupuesto");
  useEffect(() => {
    // The tab is initialized from the URL whenever the route changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTab(new URLSearchParams(window.location.search).get("tab") ?? "presupuesto");
  }, [pathname]);
  useEffect(() => {
    const handler = (e: Event) => setCurrentTab((e as CustomEvent<string>).detail);
    window.addEventListener("niupack:tab", handler);
    return () => window.removeEventListener("niupack:tab", handler);
  }, []);

  // Sync navPath from our custom navigation events and browser popstate.
  useEffect(() => {
    // This keeps the client-side active styling synchronized with Next navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavPath(pathname);
  }, [pathname]);
  useEffect(() => {
    const onNavigate = (e: Event) => setNavPath((e as CustomEvent<string>).detail);
    const onPop = () => setNavPath(window.location.pathname);
    window.addEventListener("niupack:navigate", onNavigate);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("niupack:navigate", onNavigate);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  function filterItems(items: NavItem[]) {
    return items.filter((item) => {
      if (item.superAdmin) return isSuperAdmin;
      if (!item.roles.includes(role)) return false;
      if (item.module && !modules[item.module] && !isSuperAdmin) return false;
      if (item.minPlan && PLAN_RANK[plan] < PLAN_RANK[item.minPlan] && !isSuperAdmin) return false;
      return true;
    });
  }

  const globalItems = filterItems(GLOBAL_ITEMS);
  const operativoItems = filterItems(OPERATIVO_ITEMS);
  const licitacionesItems = filterItems(LICITACIONES_ITEMS);
  const comprasItems = filterItems(COMPRAS_ITEMS);
  const ventasItems = filterItems(VENTAS_ITEMS);
  const finanzasItems = filterItems(FINANZAS_ITEMS);
  // Proyectos/Licitaciones dejaron de listarse acá porque son, cada uno, la
  // entrada a su propio workspace (elegido con el switcher de la topbar) —
  // el resto (Comprar/Vender/Finanzas) son funciones globales del ERP, no
  // exclusivas de un workspace, así que siguen visibles siempre: esconderlas
  // fuera de Administración dejaba el nav vacío al entrar a Operativo o
  // Licitaciones.

  function normalizeLogoToFixedSlot(event: React.SyntheticEvent<HTMLImageElement>) {
    if (normalizedLogoSrc) return;

    const img = event.currentTarget;
    try {
      const sourceWidth = img.naturalWidth;
      const sourceHeight = img.naturalHeight;
      if (!sourceWidth || !sourceHeight) return;

      // Sample at a bounded resolution so large logos don't block the UI.
      const sampleScale = Math.min(1, 1000 / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * sampleScale));
      const height = Math.max(1, Math.round(sourceHeight * sampleScale));

      const sample = document.createElement("canvas");
      sample.width = width;
      sample.height = height;
      const ctx = sample.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);

      const image = ctx.getImageData(0, 0, width, height);
      const data = image.data;

      // Estimate background from the four corners instead of assuming white.
      const corners = [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1],
      ];
      let bgR = 0;
      let bgG = 0;
      let bgB = 0;
      let bgCount = 0;
      for (const [x, y] of corners) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 12) continue;
        bgR += data[i];
        bgG += data[i + 1];
        bgB += data[i + 2];
        bgCount += 1;
      }
      if (bgCount > 0) {
        bgR /= bgCount;
        bgG /= bgCount;
        bgB /= bgCount;
      } else {
        bgR = 255;
        bgG = 255;
        bgB = 255;
      }

      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const alpha = data[i + 3];
          if (alpha < 12) continue;

          const dr = data[i] - bgR;
          const dg = data[i + 1] - bgG;
          const db = data[i + 2] - bgB;
          const distance = Math.sqrt(dr * dr + dg * dg + db * db);

          // Conservative threshold: keeps antialiasing and light logo details.
          if (distance < 10) continue;

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      if (maxX < minX || maxY < minY) return;

      // Safety padding so no valid logo pixel is ever clipped.
      const contentWidth = maxX - minX + 1;
      const contentHeight = maxY - minY + 1;
      const padX = Math.max(2, Math.round(contentWidth * 0.035));
      const padY = Math.max(2, Math.round(contentHeight * 0.06));
      minX = Math.max(0, minX - padX);
      minY = Math.max(0, minY - padY);
      maxX = Math.min(width - 1, maxX + padX);
      maxY = Math.min(height - 1, maxY + padY);

      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;

      // FINAL SLOT IS FIXED. Navbar never changes size for the logo.
      const SLOT_W = 120;
      const SLOT_H = 40;
      const SLOT_PADDING_X = 2;
      const SLOT_PADDING_Y = 2;
      // El slot es autoritativo: el asset se normaliza al espacio disponible.
      // No dejamos letterboxing por diferencias de aspect ratio.
      const drawW = SLOT_W - SLOT_PADDING_X * 2;
      const drawH = SLOT_H - SLOT_PADDING_Y * 2;
      const drawX = SLOT_PADDING_X;
      const drawY = SLOT_PADDING_Y;

      const output = document.createElement("canvas");
      output.width = SLOT_W;
      output.height = SLOT_H;
      const out = output.getContext("2d");
      if (!out) return;

      // Transparent final canvas: only the actual logo occupies the slot.
      out.clearRect(0, 0, SLOT_W, SLOT_H);
      out.drawImage(
        sample,
        minX,
        minY,
        cropW,
        cropH,
        drawX,
        drawY,
        drawW,
        drawH
      );

      setNormalizedLogoSrc(output.toDataURL("image/png"));
    } catch {
      // Cross-origin/SVG edge case: original logo still renders inside fixed slot.
    }
  }

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
        setNormalizedLogoSrc(null);
        setLogoVersion((v) => v + 1);
      }
    } catch {
      alert("Se cortó la conexión al subir el logo — probá de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-nav-overlay]") || target.closest("[data-nav-trigger]")) return;
      setOpenSection(null);
      setOpenProjectSection(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    // Close transient menus when their route context changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenSection(null);
    setOpenProjectSection(null);
  }, [pathname, collapsed]);

  function renderLink(item: NavItem) {
    const effectivePath = navPath ?? pathname;
    const active = effectivePath === item.href || effectivePath.startsWith(item.href + "/");
    const Icon = item.icon;
    const isShellPath = (SHELL_PATHS as readonly string[]).includes(item.href);

    function handleClick(e: React.MouseEvent) {
      setOpenSection(null);
      if (isShellPath) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("niupack:navigate", { detail: item.href }));
      }
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        onClick={handleClick}
        className={cn(
          "flex items-center gap-2.5 h-9 rounded-xl text-[13px] transition-colors",
          collapsed ? "justify-center px-0" : "px-2.5",
          active
            ? "bg-[linear-gradient(180deg,rgba(83,129,239,.54),rgba(48,82,162,.42))] text-white font-medium"
            : "text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
        )}
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  function renderLicitacionesLink(item: NavItem) {
    const effectivePath = navPath ?? pathname;
    const active =
      item.href === "/licitaciones"
        ? effectivePath === item.href
        : effectivePath === item.href || effectivePath.startsWith(item.href + "/");
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex items-center gap-2.5 h-9 rounded-xl text-[13px] transition-colors",
          collapsed ? "justify-center px-0" : "px-2.5",
          active
            ? "bg-white/[0.055] text-[var(--foreground)] font-medium shadow-[inset_3px_0_0_rgba(192,132,252,.78)]"
            : "text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
        )}
      >
        <Icon size={16} className={cn("shrink-0", active && "text-[var(--accent-purple)]")} />
        {!collapsed ? <span className="truncate">{item.label}</span> : null}
      </Link>
    );
  }

  function sectionIcon(label: string) {
    if (label === "Comprar") return ShoppingCart;
    if (label === "Vender") return BadgeDollarSign;
    if (label === "Finanzas") return Landmark;
    return LayoutDashboard;
  }

  function projectGroupIcon(label: string) {
    if (label === "Preparar") return ClipboardCheck;
    if (label === "Comprar") return ShoppingCart;
    if (label === "Ejecutar") return PlayCircle;
    if (label === "Certificar") return ShieldCheck;
    return LayoutDashboard;
  }

  function renderLockedSection(label: string) {
    const SectionIcon = sectionIcon(label);
    return (
      <div
        key={label}
        className={cn(
          "flex h-9 w-full cursor-not-allowed items-center rounded-xl text-[12px] text-[var(--muted)] opacity-40",
          collapsed ? "justify-center px-0" : "justify-between px-2.5"
        )}
        title="Elegí una obra para habilitar"
        aria-disabled="true"
      >
        {!collapsed ? (
          <span className="flex items-center gap-2">
            <SectionIcon size={15} className="shrink-0" />
            <span>{label}</span>
          </span>
        ) : (
          <SectionIcon size={15} />
        )}
        {!collapsed ? <ChevronRight size={13} /> : null}
      </div>
    );
  }

  function renderSection(label: string, items: NavItem[]) {
    if (items.length === 0) return null;
    const isOpen = openSection?.label === label;
    const SectionIcon = sectionIcon(label);
    return (
      <div className={cn("relative py-0.5", isOpen && "z-[60]")}>
        <button
          type="button"
          data-nav-trigger
          data-open={isOpen ? "true" : "false"}
          title={collapsed ? label : undefined}
          onClick={() => {
            setOpenSection((current) =>
              current?.label === label ? null : { label, items }
            );
          }}
          className={cn(
            "w-full flex items-center h-9 rounded-xl text-[12px] font-medium transition-colors",
            label === "Comprar" && "nav-domain-compras",
            label === "Vender" && "nav-domain-ventas",
            label === "Finanzas" && "nav-domain-finanzas",
            collapsed ? "justify-center px-0" : "justify-between px-2.5",
            isOpen
              ? "text-[var(--foreground)]"
              : "text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
          )}
        >
          {!collapsed ? (
            <span className="flex items-center gap-2">
              <SectionIcon size={15} className="shrink-0" />
              <span>{label}</span>
            </span>
          ) : <SectionIcon size={15} />}
          {!collapsed ? (
            <ChevronRight
              size={13}
              className={cn("transition-transform duration-150", isOpen && "rotate-90 text-[#8fb0ff]")}
            />
          ) : null}
        </button>

        {isOpen ? (
          <div
            data-nav-overlay
            className={cn(
              "absolute top-[calc(100%+4px)] overflow-hidden rounded-2xl border border-white/[0.11] bg-[#0b1728]/[0.985] p-1.5",
              "shadow-[0_24px_58px_rgba(0,0,0,.48),inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur-2xl",
              collapsed ? "left-0 w-[210px]" : "left-0 right-0"
            )}
          >
            <div className="space-y-0.5">
              {items.map(renderLink)}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderProjectSection(group: (typeof PROJECT_TAB_GROUPS)[number]) {
    const tabs = group.tabs.filter((t) => !t.caterpillarOnly || isCaterpillarPlan);
    if (tabs.length === 0) return null;
    const isOpen = openProjectSection === group.label;
    const isActiveGroup = tabs.some((tab) => tab.key === currentTab);
    const GroupIcon = projectGroupIcon(group.label);

    return (
      <div key={group.label} className={cn("relative py-0.5", isOpen && "z-[60]")}>
        <button
          type="button"
          data-nav-trigger
          data-open={isOpen ? "true" : "false"}
          data-active={isActiveGroup ? "true" : "false"}
          title={collapsed ? group.label : undefined}
          onClick={() => setOpenProjectSection((current) => current === group.label ? null : group.label)}
          className={cn(
            "w-full flex items-center h-9 rounded-xl text-[12px] font-medium transition-colors",
            group.label === "Preparar" && "nav-domain-preparar",
            group.label === "Comprar" && "nav-domain-compras",
            group.label === "Ejecutar" && "nav-domain-ejecutar",
            group.label === "Certificar" && "nav-domain-certificar",
            collapsed ? "justify-center px-0" : "justify-between px-2.5",
            isOpen || isActiveGroup
              ? "text-[var(--foreground)]"
              : "text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]"
          )}
        >
          {!collapsed ? (
            <span className="flex items-center gap-2">
              <GroupIcon size={15} className="shrink-0" />
              <span>{group.label}</span>
            </span>
          ) : <GroupIcon size={15} />}
          {!collapsed ? (
            <ChevronRight
              size={13}
              className={cn("transition-transform duration-150", isOpen && "rotate-90 text-[#8fb0ff]")}
            />
          ) : null}
        </button>

        {isOpen ? (
          <div
            data-nav-overlay
            className={cn(
              "absolute top-[calc(100%+4px)] overflow-hidden rounded-2xl border border-white/[0.11] bg-[#0b1728]/[0.985] p-1.5",
              "shadow-[0_24px_58px_rgba(0,0,0,.48),inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur-2xl",
              collapsed ? "left-0 w-[210px]" : "left-0 right-0"
            )}
          >
            <div className="space-y-0.5">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = currentTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setOpenProjectSection(null);
                      const url = `/projects/${activeProjectId}?tab=${t.key}`;
                      window.history.pushState({}, "", url);
                      window.dispatchEvent(new CustomEvent("niupack:tab", { detail: t.key }));
                    }}
                    className={cn(
                      "w-full flex items-center gap-2.5 h-9 rounded-xl text-[13px] transition-colors text-left",
                      active
                        ? "bg-[linear-gradient(180deg,rgba(83,129,239,.54),rgba(48,82,162,.42))] text-white font-medium"
                        : "text-[var(--muted)] hover:bg-white/[0.055] hover:text-[var(--foreground)]",
                      collapsed ? "px-2.5" : "px-2.5"
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "relative shrink-0 border-r border-white/[0.08] bg-[#0a1626]/88 flex flex-col h-screen sticky top-0 transition-[width] duration-150",
        collapsed ? "w-[52px]" : "w-[164px]"
      )}
    >
      <div className="h-14 flex items-center justify-between gap-2 px-2 border-b border-white/[0.08]">
        <div
          className={cn(
            "relative group flex items-center rounded-md",
            isAdmin && "cursor-pointer hover:bg-white/[0.055]",
            collapsed ? "h-10 w-10 justify-center" : "h-10 w-[120px] shrink-0 justify-center"
          )}
          onClick={() => isAdmin && !uploading && fileInputRef.current?.click()}
          title={isAdmin ? "Subir logo de la empresa" : undefined}
        >
          {logoBucketUrl && !logoFailed ? (
            <div
              className={cn(
                "flex items-center justify-center overflow-visible",
                collapsed ? "h-8 w-8" : "h-10 w-[120px]"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={normalizedLogoSrc ?? `${logoBucketUrl}?v=${logoVersion}`}
                alt="Logo"
                crossOrigin="anonymous"
                onLoad={normalizeLogoToFixedSlot}
                className={cn(
                  "block object-contain",
                  collapsed ? "h-8 w-8 object-fill" : "h-10 w-[120px] object-fill"
                )}
                onError={() => setLogoFailed(true)}
              />
            </div>
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
          className="h-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] border-b border-white/[0.08]"
          title="Expandir menú"
        >
          <ChevronsRight size={16} />
        </button>
      ) : null}

      {inProjectMode && projectInfo ? (
        <div className={cn("border-b border-white/[0.08] bg-[var(--panel-2)]", collapsed ? "px-1 py-2" : "px-2 py-2")}>
          {!collapsed ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--primary)]">
                <FolderOpen size={12} className="shrink-0" />
                <span className="truncate">{projectInfo.code}</span>
              </span>
              <Link
                href="/projects"
                className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
                title={`Salir de ${projectInfo.name}`}
              >
                <X size={10} /> Salir
              </Link>
            </div>
          ) : (
            <Link href="/projects" title={`Salir de ${projectInfo.name}`} className="flex justify-center text-[var(--primary)]">
              <FolderOpen size={15} />
            </Link>
          )}
        </div>
      ) : isLoadingProjectMode && !collapsed ? (
        <div className="border-b border-white/[0.08] bg-[var(--panel-2)] px-3 py-2.5 space-y-1.5">
          <div className="h-2 w-14 rounded bg-white/[0.06]" />
          <div className="h-3.5 w-36 rounded bg-white/[0.06]" />
          <div className="h-2 w-20 rounded bg-white/[0.06]" />
        </div>
      ) : null}

      <nav className="flex-1 py-3 px-1.5 space-y-0.5 overflow-y-auto">
        {inProjectMode ? (
          <>
            {globalItems.map(renderLink)}
            {PROJECT_TAB_GROUPS.map(renderProjectSection)}
          </>
        ) : isLoadingProjectMode ? (
          <div className="space-y-1">
            {[...Array(7)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-9 rounded-xl bg-white/[0.06]",
                  collapsed ? "w-8 mx-auto" : "w-full"
                )}
              />
            ))}
          </div>
        ) : workspace === "licitaciones" ? (
          <>
            {!collapsed ? (
              <div className="px-2.5 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-purple)]">
                Licitaciones
              </div>
            ) : null}
            {licitacionesItems.map(renderLicitacionesLink)}
          </>
        ) : workspace === "operativo" ? (
          <>
            {operativoItems.map(renderLink)}
            {!collapsed ? (
              <div className="mx-1 my-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--muted)]">
                Elegí una obra para habilitar las herramientas operativas.
              </div>
            ) : null}
            {renderLockedSection("Comprar")}
            {renderLockedSection("Vender")}
            {renderLockedSection("Finanzas")}
          </>
        ) : (
          <>
            {globalItems.map(renderLink)}
            {renderSection("Comprar", comprasItems)}
            {renderSection("Vender", ventasItems)}
            {renderSection("Finanzas", finanzasItems)}
          </>
        )}
      </nav>

      <SidebarUserMenu collapsed={collapsed} fullName={fullName} initial={initial} role={role} />

    </aside>
  );
}
