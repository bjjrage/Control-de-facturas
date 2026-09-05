"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { PaymentOrder } from "@/lib/types";

type ColKey = "code" | "provider" | "status" | "date";

export function ProyectoPagosTable({
  rows,
  providerNameById,
}: {
  rows: PaymentOrder[];
  providerNameById: Map<string, string>;
}) {
  const [q, setQ] = useState("");
  const providerName = (po: PaymentOrder) => providerNameById.get(po.provider_id) ?? "—";
  const dateLabel = (po: PaymentOrder) => formatDate(po.created_at);

  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    code: null,
    provider: null,
    status: null,
    date: null,
  });

  const uniques = useMemo(
    () => ({
      code: uniqueValues(rows, (r) => r.code),
      provider: uniqueValues(rows, providerName),
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
    return rows.filter((po) => {
      if (!passesColumnFilter(po.code, colFilters.code)) return false;
      if (!passesColumnFilter(providerName(po), colFilters.provider)) return false;
      if (!passesColumnFilter(po.status, colFilters.status)) return false;
      if (!passesColumnFilter(dateLabel(po), colFilters.date)) return false;
      if (!term) return true;
      return po.code.toLowerCase().includes(term) || providerName(po).toLowerCase().includes(term);
    });
  }, [rows, q, colFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por código o proveedor…"
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
                Código OP
                <ColumnFilter values={uniques.code} selected={colFilters.code} onChange={(v) => setCol("code", v)} />
              </th>
              <th>
                Proveedor
                <ColumnFilter values={uniques.provider} selected={colFilters.provider} onChange={(v) => setCol("provider", v)} />
              </th>
              <th>
                Estado
                <ColumnFilter values={uniques.status} selected={colFilters.status} onChange={(v) => setCol("status", v)} />
              </th>
              <th>
                Emitida
                <ColumnFilter values={uniques.date} selected={colFilters.date} onChange={(v) => setCol("date", v)} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0
                    ? "Sin órdenes de pago que incluyan facturas de este proyecto."
                    : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((po) => (
                <tr key={po.id}>
                  <td>
                    <Link href={`/pagos/${po.id}`} className="text-action font-medium">
                      {po.code}
                    </Link>
                  </td>
                  <td>{providerName(po)}</td>
                  <td><StatusBadge status={po.status} /></td>
                  <td>{formatDate(po.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 ? (
        <p className="text-[11px] text-[var(--muted)]">
          Nota: una OP puede incluir facturas de otros proyectos si el mismo proveedor trabaja en varios — acá se
          muestra completa si al menos una de sus facturas pertenece a esta obra.
        </p>
      ) : null}
    </div>
  );
}
