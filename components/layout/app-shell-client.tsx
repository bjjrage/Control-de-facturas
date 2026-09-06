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
] as const;

type SectionKey = (typeof SHELL_PATHS)[number];

function isSectionPath(path: string): path is SectionKey {
  return (SHELL_PATHS as readonly string[]).includes(path);
}

type SectionLoader = () => Promise<ReactNode>;

const LOADERS: Record<SectionKey, SectionLoader> = {
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

function SectionSkeleton() {
  return (
    <div className="max-w-5xl space-y-5 animate-pulse">
      <div className="h-6 w-48 rounded bg-[var(--hover)]" />
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--hover)]" />
        ))}
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="h-10 border-b border-[var(--border)] bg-[var(--panel-2)]" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-10 border-b border-[var(--border)] last:border-0 flex items-center px-4 gap-4"
          >
            <div className="h-3 w-16 rounded bg-[var(--hover)]" />
            <div className="h-3 w-48 rounded bg-[var(--hover)]" />
            <div className="h-3 w-12 rounded bg-[var(--hover)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppShellClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mode, setMode] = useState<"server" | "loading" | "client">("server");
  const [activePath, setActivePath] = useState<SectionKey | null>(null);
  const [sections, setSections] = useState<Map<SectionKey, ReactNode>>(new Map());

  // Ref so event handlers always see the latest sections without stale closures.
  const sectionsRef = useRef<Map<SectionKey, ReactNode>>(new Map());
  // True when WE triggered a history change (vs. Next.js navigating).
  const isOurNavRef = useRef(false);

  function addSection(path: SectionKey, node: ReactNode) {
    sectionsRef.current.set(path, node);
    setSections(new Map(sectionsRef.current));
  }

  // niupack:navigate — fired by sidebar buttons for shell-managed sections.
  useEffect(() => {
    const handler = async (e: Event) => {
      const path = (e as CustomEvent<string>).detail as SectionKey;
      if (!isSectionPath(path)) return;
      isOurNavRef.current = true;
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
        setMode("client");
      } catch {
        // Si ya había algo en pantalla lo dejamos; si no, que Next.js
        // renderice la página normalmente.
        if (!cached) {
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
      isOurNavRef.current = true;
      if (isSectionPath(path)) {
        // Mismo stale-while-revalidate que en niupack:navigate.
        const cached = sectionsRef.current.has(path);
        setActivePath(path);
        setMode(cached ? "client" : "loading");
        try {
          const node = await LOADERS[path]();
          sectionsRef.current.set(path, node);
          setSections(new Map(sectionsRef.current));
          setMode("client");
        } catch {
          if (!cached) setMode("server");
        }
      } else {
        // Not a shell path — let Next.js handle it properly.
        setMode("server");
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []); // stable: only refs + state setters

  // Detect real Next.js navigations: <Link> clicks (e.g. "← Volver a
  // Órdenes"), router.push, or redirect() from a server action (e.g. after
  // deleting something and returning to the list). usePathname() updates
  // only for these, never for our own pushState.
  //
  // If the destination is a shell path, load its live client section instead
  // of falling back to the plain server-rendered page — that copy is a
  // separate, older implementation kept only for direct/first-load access,
  // and can be stale right after a mutation (e.g. a delete redirecting back
  // to the list wouldn't reflect the removed row). Always re-fetch rather
  // than reuse a cached copy, since a real navigation here usually means
  // something just changed server-side.
  useEffect(() => {
    if (isOurNavRef.current) {
      isOurNavRef.current = false;
      return;
    }
    if (!isSectionPath(pathname)) {
      setMode("server");
      return;
    }
    const path = pathname;
    setMode("loading");
    setActivePath(path);
    LOADERS[path]()
      .then((node) => {
        sectionsRef.current.set(path, node);
        setSections(new Map(sectionsRef.current));
        setMode("client");
      })
      .catch(() => setMode("server"));
  }, [pathname]);

  // Pre-warm ALL sections in background on first mount — first-click on any
  // section will be instant. We load the current path first, then the rest.
  useEffect(() => {
    const currentPath = window.location.pathname as SectionKey;

    async function warmAll() {
      // Current section first so it's ready soonest.
      const ordered = [
        ...SHELL_PATHS.filter((p) => p === currentPath),
        ...SHELL_PATHS.filter((p) => p !== currentPath),
      ] as SectionKey[];

      for (const path of ordered) {
        if (sectionsRef.current.has(path)) continue;
        try {
          const node = await LOADERS[path]();
          if (!sectionsRef.current.has(path)) {
            addSection(path, node);
            // La ruta actual: en cuanto su data fresca está lista, reemplaza
            // el HTML server-rendered (que puede haber quedado desactualizado
            // — un refresh directo se quedaba pegado en "server" para
            // siempre, porque nada más dispara la transición a "client")
            // por el componente vivo del shell.
            // Guard: solo activar si el usuario no navegó a otro path mientras
            // warmAll corría en background (evita sobrescribir una navegación
            // explícita a una ruta fuera del shell, como /invoices/revision).
            if (path === currentPath && window.location.pathname === currentPath) {
              setActivePath(path);
              setMode("client");
            }
          }
        } catch {
          // ignore — section will load on demand when clicked
        }
      }
    }

    warmAll();
  }, []); // only on mount

  const showSections = mode === "client";

  return (
    <>
      {/* Server-rendered content — shown on initial load and real Next.js navigations */}
      <div hidden={mode !== "server"}>{children}</div>

      {/* Loading skeleton — shown while fetching a new section */}
      {mode === "loading" ? <SectionSkeleton /> : null}

      {/* Keep-alive client sections — stay mounted once loaded */}
      {Array.from(sections.entries()).map(([path, node]) => (
        <div key={path} hidden={!showSections || path !== activePath}>
          {node}
        </div>
      ))}
    </>
  );
}
