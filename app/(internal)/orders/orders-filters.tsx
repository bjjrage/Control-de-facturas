"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Label, Select } from "@/components/ui/input";
import { ORDER_STEPS } from "@/lib/reconciliation";

export function OrdersFilters({ products, providers }: { products: string[]; providers: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const q = params.get("q") ?? "";
  const product = params.get("product") ?? "";
  const provider = params.get("provider") ?? "";
  const etapa = params.get("etapa") ?? "";
  const estado = params.get("estado") ?? "";
  const desde = params.get("desde") ?? "";

  const active = q || product || provider || etapa || estado || desde;

  const set = useCallback(
    (key: string, value: string) => {
      const p = new URLSearchParams(params.toString());
      if (value) p.set(key, value);
      else p.delete(key);
      p.delete("nueva");
      startTransition(() => {
        router.push(`/orders${p.toString() ? `?${p.toString()}` : ""}`);
      });
    },
    [params, router]
  );

  return (
    <div className="space-y-2">
      {/* Buscador */}
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="6.5" cy="6.5" r="5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          type="search"
          placeholder="Código, producto, proveedor…"
          value={q}
          onChange={(e) => set("q", e.target.value)}
          className="w-full pl-8 pr-3 h-9 rounded-lg border border-[var(--border)] bg-[var(--input)] text-[13px] text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
        />
      </div>

      {/* Filtros en una sola fila */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="f_product">Producto</Label>
          <Select
            id="f_product"
            className="w-48"
            value={product}
            onChange={(e) => set("product", e.target.value)}
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f_provider">Proveedor</Label>
          <Select
            id="f_provider"
            className="w-48"
            value={provider}
            onChange={(e) => set("provider", e.target.value)}
          >
            <option value="">Todos</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f_etapa">Etapa</Label>
          <Select
            id="f_etapa"
            className="w-40"
            value={etapa}
            onChange={(e) => set("etapa", e.target.value)}
          >
            <option value="">Todas</option>
            {ORDER_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f_estado">Estado</Label>
          <Select
            id="f_estado"
            className="w-36"
            value={estado}
            onChange={(e) => set("estado", e.target.value)}
          >
            <option value="">Todos</option>
            <option value="abierta">Abierta</option>
            <option value="cerrada">Cerrada</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="f_desde">Autorizada desde</Label>
          <input
            id="f_desde"
            type="date"
            value={desde}
            onChange={(e) => set("desde", e.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 text-[12px] text-[var(--fg)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] w-36"
          />
        </div>

        {active ? (
          <button
            type="button"
            onClick={() => router.push("/orders")}
            className="text-action text-[12px] text-[var(--muted)] pb-1"
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>
    </div>
  );
}
