"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Label, Select } from "@/components/ui/input";
import { ORDER_STEPS } from "@/lib/reconciliation";

export function OrdersFilters({ products, providers }: { products: string[]; providers: string[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const product = params.get("product") ?? "";
  const provider = params.get("provider") ?? "";
  const etapa = params.get("etapa") ?? "";
  const estado = params.get("estado") ?? "";
  const desde = params.get("desde") ?? "";

  // Local state for the text search so it feels instant
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);

  const active = q || product || provider || etapa || estado || desde;

  function set(key: string, value: string) {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("nueva");
    router.push(`/orders${p.toString() ? `?${p.toString()}` : ""}`);
  }

  function submitSearch(value: string) {
    const p = new URLSearchParams(params.toString());
    if (value.trim()) p.set("q", value.trim());
    else p.delete("q");
    p.delete("nueva");
    router.push(`/orders${p.toString() ? `?${p.toString()}` : ""}`);
  }

  return (
    <div className="space-y-2">
      {/* Buscador — fila superior */}
      <input
        type="search"
        placeholder="Buscar por código, producto o proveedor…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submitSearch(q)}
        onBlur={() => submitSearch(q)}
        style={{ width: "100%", height: "36px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--fg)", fontSize: "13px", outline: "none" }}
      />

      {/* Filtros — una sola fila */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="f_product">Producto</Label>
          <Select id="f_product" className="w-48" value={product} onChange={(e) => set("product", e.target.value)}>
            <option value="">Todos</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="f_provider">Proveedor</Label>
          <Select id="f_provider" className="w-48" value={provider} onChange={(e) => set("provider", e.target.value)}>
            <option value="">Todos</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="f_etapa">Etapa</Label>
          <Select id="f_etapa" className="w-40" value={etapa} onChange={(e) => set("etapa", e.target.value)}>
            <option value="">Todas</option>
            {ORDER_STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="f_estado">Estado</Label>
          <Select id="f_estado" className="w-36" value={estado} onChange={(e) => set("estado", e.target.value)}>
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
            style={{ height: "36px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--fg)", fontSize: "12px", padding: "0 8px", outline: "none", width: "140px" }}
          />
        </div>
        {active ? (
          <button
            type="button"
            onClick={() => { setQ(""); router.push("/orders"); }}
            style={{ fontSize: "12px", color: "var(--muted)", paddingBottom: "4px", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>
    </div>
  );
}
