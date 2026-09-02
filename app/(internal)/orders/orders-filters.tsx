"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Label, Select } from "@/components/ui/input";
import { ORDER_STEPS } from "@/lib/reconciliation";

export function OrdersFilters({ products, providers }: { products: string[]; providers: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const product = params.get("product") ?? "";
  const provider = params.get("provider") ?? "";
  const etapa = params.get("etapa") ?? "";
  const active = product || provider || etapa;

  function set(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("nueva");
    router.push(`/orders${p.toString() ? `?${p.toString()}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="f_product">Producto</Label>
        <Select
          id="f_product"
          className="w-52"
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
          className="w-56"
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
        <Select id="f_etapa" className="w-40" value={etapa} onChange={(e) => set("etapa", e.target.value)}>
          <option value="">Todas</option>
          {ORDER_STEPS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      {active ? (
        <button
          type="button"
          onClick={() => router.push("/orders")}
          className="text-[12px] text-[var(--muted)] hover:underline pb-1.5"
        >
          Limpiar filtros
        </button>
      ) : null}
    </div>
  );
}
