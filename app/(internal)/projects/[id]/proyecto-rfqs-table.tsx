"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { Rfq } from "@/lib/types";

type ColKey = "code" | "type" | "product" | "status" | "date";

export function ProyectoRfqsTable({ rows }: { rows: Rfq[] }) {
  const [q, setQ] = useState("");
  const dateLabel = (r: Rfq) => formatDate(r.created_at);
  const typeLabel = (r: Rfq) => r.quote_type === "RFQ" ? "RFQ" : "Cotización";

  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    code: null,
    type: null,
    product: null,
    status: null,
    date: null,
  });

  const uniques = useMemo(
    () => ({
      code: uniqueValues(rows, (r) => r.code),
      type: uniqueValues(rows, typeLabel),
      product: uniqueValues(rows, (r) => r.product),
      status: uniqueValues(rows, (r) => r.status),
      date: uniqueValues(rows, dateLabel),
    }),
    [rows] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!passesColumnFilter(r.code, colFilters.code)) return false;
      if (!passesColumnFilter(typeLabel(r), colFilters.type)) return false;
      if (!passesColumnFilter(r.product, colFilters.product)) return false;
      if (!passesColumnFilter(r.status, colFilters.status)) return false;
      if (!passesColumnFilter(dateLabel(r), colFilters.date)) return false;
      if (!term) return true;
      return r.code.toLowerCase().includes(term) || r.product.toLowerCase().includes(term);
    });
  }, [rows, q, colFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por código o producto…"
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
                Código
                <ColumnFilter values={uniques.code} selected={colFilters.code} onChange={(v) => setCol("code", v)} />
              </th>
              <th>
                Tipo
                <ColumnFilter values={uniques.type} selected={colFilters.type} onChange={(v) => setCol("type", v)} />
              </th>
              <th>
                Producto / Servicio
                <ColumnFilter values={uniques.product} selected={colFilters.product} onChange={(v) => setCol("product", v)} />
              </th>
              <th>
                Estado
                <ColumnFilter values={uniques.status} selected={colFilters.status} onChange={(v) => setCol("status", v)} />
              </th>
              <th>
                Fecha
                <ColumnFilter values={uniques.date} selected={colFilters.date} onChange={(v) => setCol("date", v)} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0
                    ? "Sin cotizaciones vinculadas a este proyecto."
                    : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/rfqs/${r.id}`} className="text-action font-medium">
                      {r.code}
                    </Link>
                  </td>
                  <td>{typeLabel(r)}</td>
                  <td className="max-w-[260px] truncate" title={r.product}>{r.product}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{formatDate(r.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
