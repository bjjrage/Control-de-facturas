"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";

type Row = {
  id: string;
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  subtotal: number;
  execPct: number | null;
};

export function PresupuestoTable({ rows, total }: { rows: Row[]; total: number }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => r.code.toLowerCase().includes(term) || r.description.toLowerCase().includes(term));
  }, [rows, q]);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por código o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      ) : null}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>Unid.</th>
              <th className="num">Cantidad</th>
              <th className="num">P. Unit.</th>
              <th className="num">Subtotal</th>
              <th className="num">Ejecutado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin ítems todavía." : "Sin resultados para esa búsqueda."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.code}</td>
                  <td>{r.description}</td>
                  <td className="text-[var(--muted)]">{r.unit ?? "—"}</td>
                  <td className="num">{r.quantity ?? "—"}</td>
                  <td className="num">{r.unitPrice != null ? formatMoney(r.unitPrice, "PYG") : "—"}</td>
                  <td className="num font-medium">{formatMoney(r.subtotal, "PYG")}</td>
                  <td className="num text-[var(--muted)]">{r.execPct !== null ? `${r.execPct}%` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right font-semibold">TOTAL</td>
                <td className="num font-semibold">{formatMoney(total, "PYG")}</td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
