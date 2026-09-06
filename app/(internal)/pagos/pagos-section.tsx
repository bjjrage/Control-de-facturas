"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { PaymentOrder, Provider } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { PagosSectionData } from "./section-action";

const STATUS_TONE = { EMITIDA: "warn", EJECUTADA: "ok" } as const;
const STATUS_LABELS = { EMITIDA: "Emitida", EJECUTADA: "Ejecutada" };

function getParam(key: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

export function PagosSection({ initialData }: { initialData: PagosSectionData }) {
  const { ops, providers, opTotals } = initialData;
  const [filterStatus, setFilterStatus] = useState(() => getParam("status"));
  const [filterProvider, setFilterProvider] = useState(() => getParam("provider"));
  const [filterQuery, setFilterQuery] = useState(() => getParam("q"));
  const [filterFrom, setFilterFrom] = useState(() => getParam("from"));
  const [filterTo, setFilterTo] = useState(() => getParam("to"));

  const filtersRef = useRef({ filterStatus, filterProvider, filterQuery, filterFrom, filterTo });
  filtersRef.current = { filterStatus, filterProvider, filterQuery, filterFrom, filterTo };

  function buildParams(f: typeof filtersRef.current) {
    const p = new URLSearchParams();
    if (f.filterStatus) p.set("status", f.filterStatus);
    if (f.filterProvider) p.set("provider", f.filterProvider);
    if (f.filterQuery) p.set("q", f.filterQuery);
    if (f.filterFrom) p.set("from", f.filterFrom);
    if (f.filterTo) p.set("to", f.filterTo);
    return p.toString();
  }

  useEffect(() => {
    // Solo la sección visible puede tocar la URL (las precargadas en
    // background también montan este efecto).
    if (window.location.pathname !== "/pagos") return;
    const qs = buildParams({ filterStatus, filterProvider, filterQuery, filterFrom, filterTo });
    window.history.replaceState({}, "", qs ? `/pagos?${qs}` : "/pagos");
  }, [filterStatus, filterProvider, filterQuery, filterFrom, filterTo]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/pagos") return;
      const p = new URLSearchParams(window.location.search);
      setFilterStatus(p.get("status") ?? "");
      setFilterProvider(p.get("provider") ?? "");
      setFilterQuery(p.get("q") ?? "");
      setFilterFrom(p.get("from") ?? "");
      setFilterTo(p.get("to") ?? "");
      setTimeout(() => {
        const qs = buildParams(filtersRef.current);
        window.history.replaceState({}, "", qs ? `/pagos?${qs}` : "/pagos");
      }, 0);
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, []);

  const providerById = useMemo(
    () => new Map(providers.map((p) => [p.id, p.name])),
    [providers]
  );

  const filtered = useMemo(() => {
    let list = ops;
    if (filterStatus) list = list.filter((op) => op.status === filterStatus);
    if (filterProvider) list = list.filter((op) => op.provider_id === filterProvider);
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (op) =>
          op.code.toLowerCase().includes(q) ||
          (providerById.get(op.provider_id) ?? "").toLowerCase().includes(q)
      );
    }
    if (filterFrom) list = list.filter((op) => op.created_at.slice(0, 10) >= filterFrom);
    if (filterTo) list = list.filter((op) => op.created_at.slice(0, 10) <= filterTo);
    return list;
  }, [ops, filterStatus, filterProvider, filterQuery, filterFrom, filterTo, providerById]);

  const hasFilters = !!(filterStatus || filterProvider || filterQuery || filterFrom || filterTo);

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">Órdenes de Pago</h1>
        <Link href="/pagos/nueva">
          <Button>Nueva OP</Button>
        </Link>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="pag-q">Buscar</Label>
            <Input
              id="pag-q"
              type="search"
              placeholder="Código o proveedor…"
              value={filterQuery}
              onChange={(e) => setFilterQuery((e.target as HTMLInputElement).value)}
              className="w-56"
            />
          </div>
          <div>
            <Label htmlFor="pag-provider">Proveedor</Label>
            <Select
              id="pag-provider"
              value={filterProvider}
              onChange={(e) => setFilterProvider((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todos</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="pag-status">Estado</Label>
            <Select
              id="pag-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value)}
              className="w-40"
            >
              <option value="">Todos</option>
              <option value="EMITIDA">Emitida</option>
              <option value="EJECUTADA">Ejecutada</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="pag-from">Emitida desde</Label>
            <Input
              id="pag-from"
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom((e.target as HTMLInputElement).value)}
              className="w-36"
            />
          </div>
          <div>
            <Label htmlFor="pag-to">Emitida hasta</Label>
            <Input
              id="pag-to"
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo((e.target as HTMLInputElement).value)}
              className="w-36"
            />
          </div>
          {hasFilters ? (
            <button
              onClick={() => {
                setFilterStatus("");
                setFilterProvider("");
                setFilterQuery("");
                setFilterFrom("");
                setFilterTo("");
              }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          No hay órdenes de pago para estos filtros.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Proveedor</th>
                <th className="num">Facturas</th>
                <th className="num">Total</th>
                <th>Estado</th>
                <th>Emitida</th>
                <th>Ejecutada</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((op) => {
                const entry = opTotals[op.id];
                const totals = entry?.byCurrency ?? [];
                return (
                  <tr key={op.id}>
                    <td>
                      <Link href={`/pagos/${op.id}`} className="text-action font-medium">
                        {op.code}
                      </Link>
                    </td>
                    <td>{providerById.get(op.provider_id) ?? "—"}</td>
                    <td className="num">{entry?.count ?? 0}</td>
                    <td className="num">
                      {totals.length > 0
                        ? totals.map(([c, v]) => formatMoney(v, c as never)).join(" · ")
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[op.status]}>{STATUS_LABELS[op.status]}</Badge>
                    </td>
                    <td>{formatDate(op.created_at)}</td>
                    <td>{op.executed_at ? formatDate(op.executed_at) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
