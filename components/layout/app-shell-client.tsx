"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isSectionPath, type SectionKey } from "@/lib/navigation/sections";
import { SectionRequests } from "@/lib/navigation/section-requests";
import { getDashboardData } from "@/app/(internal)/dashboard/section-action";
import { getInvoicesData } from "@/app/(internal)/invoices/section-action";
import { getOrdersData } from "@/app/(internal)/orders/section-action";
import { getPagosData } from "@/app/(internal)/pagos/section-action";
import { getProvidersData } from "@/app/(internal)/providers/section-action";
import { getRfqsData } from "@/app/(internal)/rfqs/section-action";
import { getClientesData } from "@/app/(internal)/clientes/section-action";
import { getCobrosData } from "@/app/(internal)/cobros/section-action";
import { getSalesListData } from "@/app/(internal)/ventas/_components/sales-list-section-action";
import { getProjectsData } from "@/app/(internal)/projects/section-action";
import { getStockData } from "@/app/(internal)/stock/section-action";
import { getInventarioData } from "@/app/(internal)/inventario/section-action";
import { ProjectsSection } from "@/app/(internal)/projects/projects-section";
import { StockSection } from "@/app/(internal)/stock/stock-section";
import { InventarioGlobalSection } from "@/app/(internal)/inventario/inventario-global-section";
import { SectionSkeleton } from "./section-skeleton";
import { DashboardSection } from "@/app/(internal)/dashboard/dashboard-section";
import { InvoicesSection } from "@/app/(internal)/invoices/invoices-section";
import { OrdersSection } from "@/app/(internal)/orders/orders-section";
import { PagosSection } from "@/app/(internal)/pagos/pagos-section";
import { ProvidersSection } from "@/app/(internal)/providers/providers-section";
import { RfqsSection } from "@/app/(internal)/rfqs/rfqs-section";
import { ClientesSection } from "@/app/(internal)/clientes/clientes-section";
import { CobrosSection } from "@/app/(internal)/cobros/cobros-section";
import { SalesListSection } from "@/app/(internal)/ventas/_components/sales-list-section";

type SectionLoader = () => Promise<ReactNode>;

const LOADERS: Record<SectionKey, SectionLoader> = {
  "/projects": async () => <ProjectsSection data={await getProjectsData()} />,
  "/stock": async () => <StockSection {...await getStockData()} />,
  "/inventario": async () => <InventarioGlobalSection {...await getInventarioData()} />,
  "/dashboard": async () => {
    const data = await getDashboardData();
    return <DashboardSection data={data} />;
  },
  "/invoices": async () => {
    const data = await getInvoicesData();
    return <InvoicesSection initialData={data} />;
  },
  "/orders": async () => {
    const data = await getOrdersData();
    return <OrdersSection initialData={data} />;
  },
  "/pagos": async () => {
    const data = await getPagosData();
    return <PagosSection initialData={data} />;
  },
  "/providers": async () => {
    const data = await getProvidersData();
    return <ProvidersSection initialData={data} />;
  },
  "/rfqs": async () => {
    const data = await getRfqsData();
    return <RfqsSection initialData={data} />;
  },
  "/clientes": async () => {
    const data = await getClientesData();
    return <ClientesSection initialData={data} />;
  },
  "/proformas": async () => {
    const data = await getSalesListData("PROFORMA");
    return <SalesListSection initialData={data} docType="PROFORMA" basePath="/proformas" title="Proformas" newLabel="Nueva proforma" />;
  },
  "/remisiones": async () => {
    const data = await getSalesListData("REMISION");
    return <SalesListSection initialData={data} docType="REMISION" basePath="/remisiones" title="Remisiones" newLabel="Nueva remisión" />;
  },
  "/facturas-venta": async () => {
    const data = await getSalesListData("FACTURA");
    return <SalesListSection initialData={data} docType="FACTURA" basePath="/facturas-venta" title="Facturas de Venta" newLabel="Nueva factura" />;
  },
  "/cobros": async () => {
    const data = await getCobrosData();
    return <CobrosSection initialData={data} />;
  },
};

export function AppShellClient({ children, warmPaths }: { children: ReactNode; warmPaths: readonly string[] }) {
  const pathname = usePathname();
  const [mode, setMode] = useState<"server" | "loading" | "client">("server");
  const [activePath, setActivePath] = useState<SectionKey | null>(null);
  const [sections, setSections] = useState<Map<SectionKey, ReactNode>>(new Map());
  const [requests] = useState(() => new SectionRequests<SectionKey, ReactNode>((path) => LOADERS[path]()));
  // Prefetch stores nodes without mounting screens or running their effects.
  const snapshotsRef = useRef<Map<SectionKey, ReactNode>>(new Map());
  const sectionsRef = useRef<Map<SectionKey, ReactNode>>(new Map());
  const serverRenderRef = useRef({ pathname, children });
  const clientNavigationRef = useRef<string | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchTargetRef = useRef<string | null>(null);

  const stopPrefetch = useCallback(() => {
    if (prefetchTimerRef.current !== null) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
    prefetchTargetRef.current = null;
  }, []);

  const readSnapshot = useCallback(async (path: SectionKey) => {
    const node = await requests.read(path);
    if (node !== undefined) snapshotsRef.current.set(path, node);
    return node;
  }, [requests]);

  const openSection = useCallback(async (path: SectionKey, serverReady = false) => {
    stopPrefetch();
    const cached = snapshotsRef.current.has(path);
    if (cached) {
      sectionsRef.current.set(path, snapshotsRef.current.get(path));
      setSections(new Map(sectionsRef.current));
    }
    setActivePath(path);
    setMode(cached ? "client" : serverReady ? "server" : "loading");
    try {
      // Navigation, intent prefetch and route synchronization share this read.
      const node = await readSnapshot(path);
      if (node === undefined) return; // Invalidated by a newer server render.
      if (window.location.pathname === path || sectionsRef.current.has(path)) {
        sectionsRef.current.set(path, node);
        setSections(new Map(sectionsRef.current));
      }
      // A late response may warm its route, but cannot take over another page.
      if (window.location.pathname === path) {
        setActivePath(path);
        setMode("client");
      }
    } catch {
      if (!cached && window.location.pathname === path) {
        setMode("server");
        if (!serverReady) window.location.assign(path);
      }
    }
  }, [readSnapshot, stopPrefetch]);

  // Both history events and Link clicks enter through the same foreground path.
  useEffect(() => {
    const navigate = (e: Event) => {
      const path: unknown = (e as CustomEvent<unknown>).detail;
      if (typeof path !== "string" || !isSectionPath(path)) return;
      clientNavigationRef.current = path;
      if (window.location.pathname !== path) window.history.pushState({}, "", path);
      void openSection(path);
    };
    const popstate = () => {
      const path = window.location.pathname;
      clientNavigationRef.current = path;
      stopPrefetch();
      if (isSectionPath(path)) {
        void openSection(path);
      } else {
        setActivePath(null);
        setMode("server");
      }
    };
    window.addEventListener("niupack:navigate", navigate);
    window.addEventListener("popstate", popstate);
    return () => {
      window.removeEventListener("niupack:navigate", navigate);
      window.removeEventListener("popstate", popstate);
    };
  }, [openSection, stopPrefetch]);

  useEffect(() => {
    const previous = serverRenderRef.current;
    serverRenderRef.current = { pathname, children };
    const serverChanged = previous.children !== children;
    // Initial SSR already has the data; don't request that page again on mount.
    if (previous.pathname === pathname && !serverChanged) return;

    stopPrefetch();
    if (serverChanged) {
      // revalidatePath/router.refresh can follow a save/delete. Neither cached
      // data nor a request that began before that response may override it.
      requests.invalidate();
      snapshotsRef.current.clear();
    }
    if (!isSectionPath(pathname)) {
      // Synchronize the keep-alive view when Next leaves the shell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivePath(null);
      setMode("server");
      return;
    }
    // Native history can notify usePathname before our popstate listener runs.
    // Let all listeners finish before deciding this needs a separate read.
    if (!serverChanged) {
      const timer = setTimeout(() => {
        if (window.location.pathname !== pathname || clientNavigationRef.current === pathname) return;
        void openSection(pathname, true);
      }, 0);
      return () => clearTimeout(timer);
    }
    clientNavigationRef.current = null;
    void openSection(pathname, true);
  }, [pathname, children, openSection, requests, stopPrefetch]);

  const warmKey = warmPaths.join("|");
  useEffect(() => {
    const allowed = new Set(warmKey.split("|"));
    const prefetch = (e: Event) => {
      const path: unknown = (e as CustomEvent<unknown>).detail;
      if (typeof path !== "string") return;
      if (!isSectionPath(path)) return;
      stopPrefetch();
      if (!allowed.has(path) || path === window.location.pathname || snapshotsRef.current.has(path)) return;
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (connection?.saveData || document.visibilityState === "hidden") return;
      prefetchTargetRef.current = path;
      prefetchTimerRef.current = setTimeout(() => {
        prefetchTimerRef.current = null;
        prefetchTargetRef.current = null;
        // Actions serialize in Next. Never enqueue background reads behind a
        // foreground read (or another prefetch), and never sweep all modules.
        if (requests.busy || window.location.pathname === path) return;
        void readSnapshot(path).catch(() => { /* Navigation can retry. */ });
      }, 180);
    };
    const cancel = (e: Event) => {
      if ((e as CustomEvent<unknown>).detail === prefetchTargetRef.current) stopPrefetch();
    };
    window.addEventListener("niupack:prefetch", prefetch);
    window.addEventListener("niupack:cancel-prefetch", cancel);
    return () => {
      stopPrefetch();
      window.removeEventListener("niupack:prefetch", prefetch);
      window.removeEventListener("niupack:cancel-prefetch", cancel);
    };
  }, [warmKey, readSnapshot, requests, stopPrefetch]);

  useEffect(() => () => { requests.invalidate(); }, [requests]);

  const showSections = mode === "client";

  return (
    <>
      {/* Server-rendered content — shown on initial load and real Next.js navigations */}
      <div className="erp-workspace" hidden={mode !== "server"}>{children}</div>

      {/* Loading skeleton — shown while fetching a new section */}
      {mode === "loading" ? <div className="erp-workspace"><SectionSkeleton /></div> : null}

      {/* Keep-alive client sections — stay mounted once loaded */}
      {Array.from(sections.entries()).map(([path, node]) => (
        <div className="erp-workspace" key={path} hidden={!showSections || path !== activePath}>
          {node}
        </div>
      ))}
    </>
  );
}
