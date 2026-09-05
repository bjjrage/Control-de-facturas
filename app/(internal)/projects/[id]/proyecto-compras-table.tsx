"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { formatDate, formatMoney } from "@/lib/format";
import { AuthorizedOrder } from "@/lib/types";

const totalLabel = (o: AuthorizedOrder) => formatMoney(o.total_price, o.currency);
const dateLabel = (o: AuthorizedOrder) => formatDate(o.authorized_at);

type ColKey = "code" | "product" | "provider_name" | "total" | "date";

export function ProyectoComprasTable({ rows }: { rows: AuthorizedOrder[] }) {
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    code: null,
    product: null,
    provider_name: null,
    total: null,
    date: null,
  });

  const uniques = useMemo(
    () => ({
      code: uniqueValues(rows, (r) => r.code),
      product: uniqueValues(rows, (r) => r.product),
      provider_name: uniqueValues(rows, (r) => r.provider_name),
      total: uniqueValues(rows, totalLabel),
      date: uniqueValues(rows, dateLabel),
    }),
    [rows]
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((o) => {
      if (!passesColumnFilter(o.code, colFilters.code)) return false;
      if (!passesColumnFilter(o.product, colFilters.product)) return false;
      if (!passesColumnFilter(o.provider_name, colFilters.provider_name)) return false;
      if (!passesColumnFilter(totalLabel(o), colFilters.total)) return false;
      if (!passesColumnFilter(dateLabel(o), colFilters.date)) return false;
      if (!term) return true;
      return (
        o.code.toLowerCase().includes(term) ||
        o.product.toLowerCase().includes(term) ||
        o.provider_name.toLowerCase().includes(term)
      );
    });
  }, [rows, q, colFilters]);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por código, producto o proveedor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      ) : null}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>
                Código OC
                <ColumnFilter values={uniques.code} selected={colFilters.code} onChange={(v) => setCol("code", v)} />
              </th>
              <th>
                Producto
                <ColumnFilter values={uniques.product} selected={colFilters.product} onChange={(v) => setCol("product", v)} />
              </th>
              <th>
                Proveedor
                <ColumnFilter
                  values={uniques.provider_name}
                  selected={colFilters.provider_name}
                  onChange={(v) => setCol("provider_name", v)}
                />
              </th>
              <th className="num">
                Total
                <ColumnFilter values={uniques.total} selected={colFilters.total} onChange={(v) => setCol("total", v)} />
              </th>
              <th>
                Autorizada
                <ColumnFilter values={uniques.date} selected={colFilters.date} onChange={(v) => setCol("date", v)} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin OCs vinculadas." : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.id}`} className="text-action font-medium">{o.code}</Link>
                  </td>
                  <td>{o.product}</td>
                  <td>{o.provider_name}</td>
                  <td className="num">{formatMoney(o.total_price, o.currency)}</td>
                  <td>{formatDate(o.authorized_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
