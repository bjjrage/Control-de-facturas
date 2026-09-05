"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { AuthorizedOrder, Provider } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { orderRemaining, orderStep, ORDER_STEPS } from "@/lib/reconciliation";
import { Badge } from "@/components/ui/badge";
import { Select, Label } from "@/components/ui/input";
import { OrderDialog } from "./order-dialog";
import { OrdersSectionData } from "./section-action";
import { DeleteOrderButton } from "./delete-order-button";

function ProgressBar({ facturado, total }: { facturado: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((facturado / total) * 100)) : 0;
  const over = facturado > total;
  return (
    <div className="w-28">
      <div className="h-1.5 rounded-full bg-[var(--hover)] overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-[var(--error)]" : "bg-[var(--primary)]"}`}
          style={{ width: `${Math.max(pct, over ? 100 : 0)}%` }}
        />
      </div>
      <div className="text-[10px] text-[var(--muted)] mt-0.5">{pct}%</div>
    </div>
  );
}

function getParam(key: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

export function OrdersSection({ initialData }: { initialData: OrdersSectionData }) {
  const { orders, providers, isAdmin } = initialData;
  const [filterProduct, setFilterProduct] = useState(() => getParam("product"));
  const [filterProvider, setFilterProvider] = useState(() => getParam("provider"));
  const [filterEtapa, setFilterEtapa] = useState(() => getParam("etapa"));
  const [filterEstado, setFilterEstado] = useState(() => getParam("estado"));
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtersRef = useRef({ filterProduct, filterProvider, filterEtapa, filterEstado });
  filtersRef.current = { filterProduct, filterProvider, filterEtapa, filterEstado };

  function buildParams(f: typeof filtersRef.current) {
    const p = new URLSearchParams();
    if (f.filterProduct) p.set("product", f.filterProduct);
    if (f.filterProvider) p.set("provider", f.filterProvider);
    if (f.filterEtapa) p.set("etapa", f.filterEtapa);
    if (f.filterEstado) p.set("estado", f.filterEstado);
    return p.toString();
  }

  useEffect(() => {
    if (window.location.pathname !== "/orders") return;
    const qs = buildParams({ filterProduct, filterProvider, filterEtapa, filterEstado });
    window.history.replaceState({}, "", qs ? `/orders?${qs}` : "/orders");
  }, [filterProduct, filterProvider, filterEtapa, filterEstado]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/orders") return;
      // Restaurar filtros desde la URL al navegar a esta sección
      const p = new URLSearchParams(window.location.search);
      setFilterProduct(p.get("product") ?? "");
      setFilterProvider(p.get("provider") ?? "");
      setFilterEtapa(p.get("etapa") ?? "");
      setFilterEstado(p.get("estado") ?? "");
      setTimeout(() => {
        const qs = buildParams(filtersRef.current);
        window.history.replaceState({}, "", qs ? `/orders?${qs}` : "/orders");
      }, 0);
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, []);

  const productOptions = useMemo(
    () => [...new Set(orders.map((o) => o.product))].sort((a, b) => a.localeCompare(b, "es")),
    [orders]
  );
  const providerOptions = useMemo(
    () => [...new Set(orders.map((o) => o.provider_name))].sort((a, b) => a.localeCompare(b, "es")),
    [orders]
  );

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        if (filterProduct && o.product !== filterProduct) return false;
        if (filterProvider && o.provider_name !== filterProvider) return false;
        if (filterEtapa) {
          const step = orderStep({
            status: o.status,
            totalPrice: o.total_price,
            facturadoAmount: o.facturado_amount,
          });
          if (ORDER_STEPS[step] !== filterEtapa) return false;
        }
        if (filterEstado) {
          const abierta = orderRemaining(o.total_price, o.facturado_amount) > 0;
          if (filterEstado === "Abierta" && !abierta) return false;
          if (filterEstado === "Cerrada" && abierta) return false;
        }
        return true;
      }),
    [orders, filterProduct, filterProvider, filterEtapa, filterEstado]
  );

  const hasFilters = !!(filterProduct || filterProvider || filterEtapa || filterEstado);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4 mt-1">
        <div>
          <h1 className="text-[17px] font-semibold">Órdenes de compra</h1>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            Todas tus compras y en qué etapa están.
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="shrink-0 h-9 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 text-[13px] font-medium text-white hover:bg-[var(--primary-hover)]"
        >
          + Nueva compra
        </button>
      </div>

      <OrderDialog
        providers={providers}
        defaultOpen={dialogOpen}
        key={dialogOpen ? "open" : "closed"}
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div>
          <Label htmlFor="ord-product">Producto</Label>
          <Select
            id="ord-product"
            value={filterProduct}
            onChange={(e) => setFilterProduct((e.target as HTMLSelectElement).value)}
            className="w-48"
          >
            <option value="">Todos</option>
            {productOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ord-provider">Proveedor</Label>
          <Select
            id="ord-provider"
            value={filterProvider}
            onChange={(e) => setFilterProvider((e.target as HTMLSelectElement).value)}
            className="w-48"
          >
            <option value="">Todos</option>
            {providerOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ord-etapa">Etapa</Label>
          <Select
            id="ord-etapa"
            value={filterEtapa}
            onChange={(e) => setFilterEtapa((e.target as HTMLSelectElement).value)}
            className="w-40"
          >
            <option value="">Todas</option>
            {Object.values(ORDER_STEPS).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ord-estado">Estado</Label>
          <Select
            id="ord-estado"
            value={filterEstado}
            onChange={(e) => setFilterEstado((e.target as HTMLSelectElement).value)}
            className="w-36"
          >
            <option value="">Todos</option>
            <option value="Abierta">Abierta</option>
            <option value="Cerrada">Cerrada</option>
          </Select>
        </div>
        {hasFilters ? (
          <button
            onClick={() => { setFilterProduct(""); setFilterProvider(""); setFilterEtapa(""); setFilterEstado(""); }}
            className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Proveedor</th>
                <th className="num">Total</th>
                <th>Facturado</th>
                <th>Estado</th>
                <th>Autorizada</th>
                {isAdmin ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="hover:bg-[var(--hover)]">
                  <td>
                    <Link href={`/orders/${o.id}`} className="text-action font-medium">
                      {o.code}
                    </Link>
                  </td>
                  <td>{o.product}</td>
                  <td className="text-[var(--muted)]">{o.provider_name}</td>
                  <td className="num">{formatMoney(o.total_price, o.currency)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <ProgressBar facturado={o.facturado_amount} total={o.total_price} />
                      <span className="text-[11px] text-[var(--muted)] num">
                        saldo {formatMoney(orderRemaining(o.total_price, o.facturado_amount), o.currency)}
                      </span>
                    </div>
                  </td>
                  <td>
                    {orderRemaining(o.total_price, o.facturado_amount) > 0 ? (
                      <Badge tone="ok">Abierta</Badge>
                    ) : (
                      <Badge tone="error">Cerrada</Badge>
                    )}
                  </td>
                  <td className="text-[var(--muted)]">{formatDate(o.authorized_at)}</td>
                  {isAdmin ? (
                    <td>
                      {o.facturado_amount === 0 ? <DeleteOrderButton orderId={o.id} compact /> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="text-center text-[var(--muted)] py-8">
                    {orders.length === 0
                      ? 'No hay órdenes todavía. Usá "+ Nueva compra" para registrar la primera.'
                      : "Ninguna orden coincide con los filtros."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
