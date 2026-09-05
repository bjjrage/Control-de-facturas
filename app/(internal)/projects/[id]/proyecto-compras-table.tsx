"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { AuthorizedOrder } from "@/lib/types";

export function ProyectoComprasTable({ rows }: { rows: AuthorizedOrder[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (o) =>
        o.code.toLowerCase().includes(term) ||
        o.product.toLowerCase().includes(term) ||
        o.provider_name.toLowerCase().includes(term)
    );
  }, [rows, q]);

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
              <th>Código OC</th>
              <th>Producto</th>
              <th>Proveedor</th>
              <th className="num">Total</th>
              <th>Autorizada</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin OCs vinculadas." : "Sin resultados para esa búsqueda."}
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
