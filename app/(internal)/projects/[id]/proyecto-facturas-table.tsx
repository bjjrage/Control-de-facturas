"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/format";
import { Invoice } from "@/lib/types";

type ColKey = "invoice_number" | "provider" | "total" | "date" | "status";

export function ProyectoFacturasTable({
  rows,
  providerNameById,
}: {
  rows: Invoice[];
  providerNameById: Map<string, string>;
}) {
  const [q, setQ] = useState("");
  const providerName = (inv: Invoice) => providerNameById.get(inv.provider_id) ?? "—";
  const totalLabel = (inv: Invoice) => formatMoney(inv.total, inv.currency);
  const dateLabel = (inv: Invoice) => formatDate(inv.invoice_date);

  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    invoice_number: null,
    provider: null,
    total: null,
    date: null,
    status: null,
  });

  const uniques = useMemo(
    () => ({
      invoice_number: uniqueValues(rows, (r) => r.invoice_number),
      provider: uniqueValues(rows, providerName),
      total: uniqueValues(rows, totalLabel),
      date: uniqueValues(rows, dateLabel),
      status: uniqueValues(rows, (r) => r.status),
    }),
    [rows] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((inv) => {
      if (!passesColumnFilter(inv.invoice_number, colFilters.invoice_number)) return false;
      if (!passesColumnFilter(providerName(inv), colFilters.provider)) return false;
      if (!passesColumnFilter(totalLabel(inv), colFilters.total)) return false;
      if (!passesColumnFilter(dateLabel(inv), colFilters.date)) return false;
      if (!passesColumnFilter(inv.status, colFilters.status)) return false;
      if (!term) return true;
      return inv.invoice_number.toLowerCase().includes(term) || providerName(inv).toLowerCase().includes(term);
    });
  }, [rows, q, colFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = filtered.reduce((s, inv) => s + inv.total, 0);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por N° de factura o proveedor…"
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
                N° Factura
                <ColumnFilter
                  values={uniques.invoice_number}
                  selected={colFilters.invoice_number}
                  onChange={(v) => setCol("invoice_number", v)}
                />
              </th>
              <th>
                Proveedor
                <ColumnFilter values={uniques.provider} selected={colFilters.provider} onChange={(v) => setCol("provider", v)} />
              </th>
              <th>
                Estado
                <ColumnFilter values={uniques.status} selected={colFilters.status} onChange={(v) => setCol("status", v)} />
              </th>
              <th className="num">
                Total
                <ColumnFilter values={uniques.total} selected={colFilters.total} onChange={(v) => setCol("total", v)} />
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
                  {rows.length === 0 ? "Sin facturas vinculadas a este proyecto." : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/invoices/${inv.id}`} className="text-action font-medium">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td>{providerName(inv)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td className="num">{formatMoney(inv.total, inv.currency)}</td>
                  <td>{formatDate(inv.invoice_date)}</td>
                </tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={3} className="font-medium">Total</td>
                <td className="num font-medium">{formatMoney(total, filtered[0]?.currency ?? "PYG")}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
