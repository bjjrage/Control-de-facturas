"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Receipt,
  Package,
  Truck,
  Users,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ImagePlus,
  ChevronDown,
  ReceiptText,
  Contact,
  FileClock,
  ClipboardList,
  Settings,
  Banknote,
} from "lucide-react";
import { UserRole } from "@/lib/types";
import { cn } from "@/lib/cn";
import { logout } from "@/app/(internal)/actions";
import { uploadLogo } from "./branding-actions";
import { LOGO_STORAGE_PATH } from "./branding-constants";

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

const COMPRAS_ITEMS: NavItem[] = [
  { href: "/rfqs", label: "Cotizaciones", roles: ["comercial", "admin"], icon: FileText, module: "compras" },
  { href: "/orders", label: "Órdenes de compra", roles: ["comercial", "administracion", "admin"], icon: Package, module: "compras" },
  { href: "/invoices", label: "Facturas", roles: ["administracion", "admin"], icon: Receipt, module: "compras" },
  { href: "/providers", label: "Proveedores", roles: ["admin"], icon: Truck, module: "compras" },
];

const VENTAS_ITEMS: NavItem[] = [
  { href: "/proformas", label: "Proformas", roles: ["administracion", "admin"], icon: FileClock, module: "ventas" },
  { href: "/remisiones", label: "Remisiones", roles: ["administracion", "admin"], icon: ClipboardList, module: "ventas" },
  { href: "/facturas-venta", label: "Facturas de Venta", roles: ["administracion", "admin"], icon: ReceiptText, module: "ventas" },
  { href: "/cobros", label: "Cobros", roles: ["administracion", "admin"], icon: Banknote, module: "ventas" },
  { href: "/clientes", label: "Clientes", roles: ["administracion", "admin"], icon: Contact, module: "ventas" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/configuracion", label: "Configuración", roles: ["admin"], icon: Settings },
  { href: "/users", label: "Usuarios", roles: ["admin"], icon: Users },
];

const SUPER_ADMIN_ITEMS: NavItem[] = [
  { href: "/empresas", label: "Empresas", roles: [], icon: Building2, superAdmin: true },
];

const logoBucketUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${LOGO_STORAGE_PATH}`
  : null;

export function Sidebar({
  role,
  fullName,
  isSuperAdmin = false,
  modules,
}: {
  role: UserRole;
  fullName: string;
  isSuperAdmin?: boolean;
  modules: { compras: boolean; ventas: boolean };
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === "admin";
  const initial = fullName.trim().charAt(0).toUpperCase() || "?";

  function filterItems(items: NavItem[]) {
    return items.filter((item) => {
      if (item.superAdmin) return isSuperAdmin;
      if (!item.roles.includes(role)) return false;
      if (item.module && !modules[item.module] && !isSuperAdmin) return false;
      return true;
    });
  }

  const globalItems = filterItems(GLOBAL_ITEMS);
  const comprasItems = filterItems(COMPRAS_ITEMS);
  const ventasItems = filterItems(VENTAS_ITEMS);
  const adminItems = filterItems(ADMIN_ITEMS);
  const superAdminItems = isSuperAdmin ? SUPER_ADMIN_ITEMS : [];

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

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {globalItems.map(renderLink)}
        {renderSection("Compras", comprasItems)}
        {renderSection("Ventas", ventasItems)}
        {adminItems.length > 0 ? (
          <div className="space-y-0.5">
            <div className="border-t border-[var(--border)] my-1.5" />
            {adminItems.map(renderLink)}
          </div>
        ) : null}
        {superAdminItems.map(renderLink)}
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
            <button className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] underline">
              Cerrar sesión
            </button>
          </form>
        ) : null}
      </div>
    </aside>
  );
}
