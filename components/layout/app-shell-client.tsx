"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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

// Paths that AppShell manages client-side (keep-alive + instant navigation).
// Must match the nav items in sidebar.tsx that dispatch niupack:navigate.
export const SHELL_PATHS = [
  "/dashboard",
  "/invoices",
  "/orders",
  "/pagos",
  "/providers",
  "/rfqs",
  "/clientes",
  "/proformas",
  "/remisiones",
  "/facturas-venta",
  "/cobros",
  "/projects",
  "/stock",
  "/inventario",
] as const;

type SectionKey = (typeof SHELL_PATHS)[number];

function isSectionPath(path: string): path is SectionKey {
  return (SHELL_PATHS as readonly string[]).includes(path);
}

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
  const initialServerPath = useRef(pathname);
  const [mode, setMode] = useState<"server" | "loading" | "client">("server");
  const [activePath, setActivePath] = useState<SectionKey | null>(null);
  const [sections, setSections] = useState<Map<SectionKey, ReactNode>>(new Map());

  // Ref so event handlers always see the latest sections without stale closures.
  const sectionsRef = useRef<Map<SectionKey, ReactNode>>(new Map());

  // niupack:navigate — fired by sidebar buttons for shell-managed sections.
  useEffect(() => {
    const handler = async (e: Event) => {
      const path = (e as CustomEvent<string>).detail as SectionKey;
      if (!isSectionPath(path)) return;
      window.history.pushState({}, "", path);

      // Stale-while-revalidate: si ya tenemos la sección, se muestra al
      // instante (sin skeleton) y igual se re-fetcha por detrás; cuando llega
      // la data fresca se reemplaza el nodo. Así la navegación se siente
      // inmediata sin quedar mostrando datos viejos — p. ej. una factura que
      // se marcó apta para pago desde otra pantalla.
      const cached = sectionsRef.current.has(path);
      setActivePath(path);
      setMode(cached ? "client" : "loading");
      try {
        const node = await LOADERS[path]();
        sectionsRef.current.set(path, node);
        setSections(new Map(sectionsRef.current));
        if (window.location.pathname === path) {
          setActivePath(path);
          setMode("client");
        }
      } catch {
        // Si ya había algo en pantalla lo dejamos; si no, que Next.js
        // renderice la página normalmente.
        if (!cached && window.location.pathname === path) {
          setMode("server");
          window.location.href = path;
        }
      }
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, []); // stable: only refs + state setters used inside

  // popstate — browser back/forward through our pushState history entries.
  useEffect(() => {
    const handler = async () => {
      const path = window.location.pathname;
      if (isSectionPath(path)) {
        // Mismo stale-while-revalidate que en niupack:navigate.
        const cached = sectionsRef.current.has(path);
        setActivePath(path);
        setMode(cached ? "client" : "loading");
        try {
          const node = await LOADERS[path]();
          sectionsRef.current.set(path, node);
          setSections(new Map(sectionsRef.current));
          if (window.location.pathname === path) {
            setActivePath(path);
            setMode("client");
          }
        } catch {
          if (!cached) setMode("server");
        }
      } else {
        // Not a shell path — reveal the server-rendered workspace immediately.
        setActivePath(null);
        setMode("server");
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []); // stable: only refs + state setters

  // Detect real Next.js navigations: <Link> clicks (e.g. "← Volver a
  // Órdenes"), router.push, or redirect() from a server action (e.g. after
  // deleting something and returning to the list). usePathname() updates
  // for real Next.js navigations. The URL remains the source of truth even
  // if the browser/Next runtime also observes history.pushState.
  //
  // If the destination is a shell path, load its live client section instead
  // of falling back to the plain server-rendered page — that copy is a
  // separate, older implementation kept only for direct/first-load access,
  // and can be stale right after a mutation (e.g. a delete redirecting back
  // to the list wouldn't reflect the removed row). Always re-fetch rather
  // than reuse a cached copy, since a real navigation here usually means
  // something just changed server-side.
  useEffect(() => {
    // La URL es siempre la fuente de verdad. Si salimos del shell rápido
    // (p. ej. Administración -> Operativo/Licitaciones), mostramos de inmediato
    // el contenido server de la nueva ruta. Nunca dejamos un panel keep-alive
    // viejo tapando el workspace nuevo.
    if (!isSectionPath(pathname)) {
      // Switching shell mode is an intentional synchronization with the route.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivePath(null);
      setMode("server");
      return;
    }

    const path = pathname;
    // Keep an already warmed section visible while its fresh read runs.
    setMode((current) => {
      if (sectionsRef.current.has(path)) return "client";
      return current === "server" && initialServerPath.current === path ? "server" : "loading";
    });
    setActivePath(path);

    LOADERS[path]()
      .then((node) => {
        // Cacheamos aunque el usuario haya navegado mientras cargaba.
        sectionsRef.current.set(path, node);
        setSections(new Map(sectionsRef.current));

        // Pero solo activamos esta sección si la URL TODAVÍA corresponde.
        // Esto evita que una respuesta tardía de Administración tape Obras.
        if (window.location.pathname === path) {
          setActivePath(path);
          setMode("client");
        }
      })
      .catch(() => {
        if (window.location.pathname === path) {
          setActivePath(null);
          setMode("server");
        }
      });
  // A successful Server Action refreshes the RSC children without changing
  // pathname. Reload our separate keep-alive snapshot on that response too.
  }, [pathname, children]);

  // A stable scalar avoids restarting a sweep when RSC returns an equivalent array.
  const warmKey = warmPaths.join("|");
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    let cancelled = false;
    const currentPath = window.location.pathname;
    const allowed = new Set(warmKey.split("|"));
    // The route effect already loads the current section. Background responses
    // only fill the cache; they must never activate a route or navigate.
    const ordered = SHELL_PATHS.filter((p) => allowed.has(p) && p !== currentPath);
    async function warmAll() {
      for (const path of ordered) {
        if (cancelled) return;
        if (sectionsRef.current.has(path)) continue;
        try {
          const node = await LOADERS[path]();
          if (cancelled) return;
          if (!sectionsRef.current.has(path)) {
            sectionsRef.current.set(path, node);
            setSections(new Map(sectionsRef.current));
          }
        } catch {
          // On-demand navigation will retry and handle authorization/errors.
        }
      }
    }
    void warmAll();
    return () => { cancelled = true; };
  }, [warmKey]);

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
