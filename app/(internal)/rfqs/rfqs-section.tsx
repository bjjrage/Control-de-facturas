"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { Rfq } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { isRfqOpen, rfqClosedReason } from "@/lib/rfq-status";
import { RfqDialog } from "./rfq-dialog";
import { RfqsSectionData } from "./section-action";

export function RfqsSection({ initialData }: { initialData: RfqsSectionData }) {
  const { rfqs, products } = initialData;
  const [q, setQ] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterOpen, setFilterOpen] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const filtersRef = useRef({ q, filterProduct, filterOpen, filterFrom, filterTo });
  filtersRef.current = { q, filterProduct, filterOpen, filterFrom, filterTo };

  function buildParams(f: typeof filtersRef.current) {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.filterProduct) p.set("product", f.filterProduct);
    if (f.filterOpen) p.set("open", f.filterOpen);
    if (f.filterFrom) p.set("from", f.filterFrom);
    if (f.filterTo) p.set("to", f.filterTo);
    return p.toString();
  }

  useEffect(() => {
    const qs = buildParams({ q, filterProduct, filterOpen, filterFrom, filterTo });
    window.history.replaceState({}, "", qs ? `/rfqs?${qs}` : "/rfqs");
  }, [q, filterProduct, filterOpen, filterFrom, filterTo]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/rfqs") return;
      setTimeout(() => {
        const qs = buildParams(filtersRef.current);
        window.history.replaceState({}, "", qs ? `/rfqs?${qs}` : "/rfqs");
      }, 0);
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rfqs.filter((r) => {
      if (filterProduct && r.product !== filterProduct) return false;
      if (filterOpen === "1" && !isRfqOpen(r)) return false;
      if (filterOpen === "0" && isRfqOpen(r)) return false;
      if (filterFrom && r.created_at < filterFrom) return false;
      if (filterTo) {
        const toExclusive = new Date(filterTo + "T00:00:00Z");
        toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
        if (r.created_at >= toExclusive.toISOString().slice(0, 10)) return false;
      }
      if (!term) return true;
      return (
        r.code.toLowerCase().includes(term) ||
        r.product.toLowerCase().includes(term) ||
        (r.specifications ?? "").toLowerCase().includes(term) ||
        (r.internal_reference ?? "").toLowerCase().includes(term)
      );
    });
  }, [rfqs, q, filterProduct, filterOpen, filterFrom, filterTo]);

  const hasFilters = !!(q || filterProduct || filterOpen || filterFrom || filterTo);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4 mt-1">
        <h1 className="text-[17px] font-semibold">Cotizaciones</h1>
        <RfqDialog trigger={<Button>Nueva solicitud</Button>} />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3">
        <div>
          <Label htmlFor="rfq-q">Buscar por código, producto o referencia</Label>
          <Input
            id="rfq-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ej: COT-001"
            className="w-72"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="rfq-product">Producto</Label>
            <Select
              id="rfq-product"
              value={filterProduct}
              onChange={(e) => setFilterProduct((e.target as HTMLSelectElement).value)}
              className="w-48"
            >
              <option value="">Todos</option>
              {products.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rfq-open">Estado</Label>
            <Select
              id="rfq-open"
              value={filterOpen}
              onChange={(e) => setFilterOpen((e.target as HTMLSelectElement).value)}
              className="w-36"
            >
              <option value="">Todos</option>
              <option value="1">Abierta</option>
              <option value="0">Cerrada</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="rfq-from">Desde</Label>
            <Input
              id="rfq-from"
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="rfq-to">Hasta</Label>
            <Input
              id="rfq-to"
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="w-40"
            />
          </div>
          {hasFilters ? (
            <button
              onClick={() => { setQ(""); setFilterProduct(""); setFilterOpen(""); setFilterFrom(""); setFilterTo(""); }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Estado</th>
              <th>Creada</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/rfqs/${r.id}`} className="text-action font-medium">
                    {r.code}
                  </Link>
                </td>
                <td>{r.product}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge tone={isRfqOpen(r) ? "warn" : "neutral"}>
                      {isRfqOpen(r) ? "Abierta" : "Cerrada"}
                    </Badge>
                    {rfqClosedReason(r) ? (
                      <span className="text-[11px] text-[var(--muted)]">{rfqClosedReason(r)}</span>
                    ) : null}
                  </span>
                </td>
                <td>{formatDate(r.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-[var(--muted)] py-8">
                  {rfqs.length === 0
                    ? "No hay solicitudes todavía."
                    : "Ninguna solicitud coincide con los filtros."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
