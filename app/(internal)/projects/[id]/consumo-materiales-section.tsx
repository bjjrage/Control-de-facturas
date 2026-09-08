"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatMoney, formatNumber } from "@/lib/format";
import type { BudgetItem } from "@/lib/types";

export type ConsumoRow = {
  budget_item_id: string | null;
  producto_id: string;
  producto: string;
  unidad: string;
  cantidad: number;
  costo_total: number;
};

export function ConsumoMaterialesSection({
  consumo,
  items,
}: {
  consumo: ConsumoRow[];
  items: BudgetItem[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (consumo.length === 0) return null;

  const itemById = new Map(items.map((i) => [i.id, i]));

  // Agrupar consumo por budget_item_id (null → "Sin rubro")
  const groups = new Map<string | null, ConsumoRow[]>();
  for (const r of consumo) {
    const key = r.budget_item_id ?? null;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  // Ordenar: rubros en el orden del presupuesto, luego "sin rubro"
  const rubroKeys = items.map((i) => i.id).filter((id) => groups.has(id));
  const sinRubro = groups.get(null);
  const orderedKeys: (string | null)[] = [...rubroKeys, ...(sinRubro ? [null] : [])];

  const totalPresupuestado = orderedKeys.reduce((s, k) => {
    if (k === null) return s;
    return s + (itemById.get(k)?.subtotal ?? 0);
  }, 0);
  const totalConsumido = consumo.reduce((s, r) => s + r.costo_total, 0);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div>
      <h3 className="text-[13px] font-semibold mb-2">Consumo de materiales por rubro</h3>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Rubro / Producto</th>
              <th className="num">Presupuestado</th>
              <th className="num">Consumido</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {orderedKeys.map((key) => {
              const rows = groups.get(key) ?? [];
              const item = key ? itemById.get(key) : null;
              const label = item ? `${item.code} ${item.description}` : "Sin rubro asignado";
              const presup = item?.subtotal ?? null;
              const consumido = rows.reduce((s, r) => s + r.costo_total, 0);
              const pct = presup != null && presup > 0 ? (consumido / presup) * 100 : null;
              const groupKey = key ?? "__sinrubro__";
              const open = expanded.has(groupKey);

              return [
                <tr
                  key={groupKey}
                  className="cursor-pointer hover:bg-[var(--hover)]"
                  onClick={() => toggle(groupKey)}
                >
                  <td className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {label}
                    </span>
                  </td>
                  <td className="num text-[var(--muted)]">
                    {presup != null ? formatMoney(presup, "PYG") : "—"}
                  </td>
                  <td className="num font-medium">{formatMoney(consumido, "PYG")}</td>
                  <td className={`num font-medium ${pct != null && pct > 100 ? "text-[var(--error)]" : pct != null && pct > 80 ? "text-[var(--warn)]" : "text-[var(--ok)]"}`}>
                    {pct != null ? `${pct.toFixed(1)}%` : "—"}
                  </td>
                </tr>,
                open
                  ? rows.map((r) => (
                      <tr key={r.producto_id} className="bg-[var(--panel-2)]">
                        <td className="pl-7 text-[12px] text-[var(--muted)]">
                          {r.producto}
                        </td>
                        <td className="num"></td>
                        <td className="num text-[12px] text-[var(--muted)]">
                          {formatNumber(r.cantidad, 2)} {r.unidad}
                          <span className="ml-2 tabular-nums">{formatMoney(r.costo_total, "PYG")}</span>
                        </td>
                        <td className="num"></td>
                      </tr>
                    ))
                  : [],
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="font-semibold">Total</td>
              <td className="num font-semibold">{formatMoney(totalPresupuestado, "PYG")}</td>
              <td className="num font-semibold">{formatMoney(totalConsumido, "PYG")}</td>
              <td className={`num font-semibold ${totalPresupuestado > 0 && totalConsumido / totalPresupuestado > 1 ? "text-[var(--error)]" : ""}`}>
                {totalPresupuestado > 0 ? `${((totalConsumido / totalPresupuestado) * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        Solo SALIDA de stock imputada a esta obra. La comparación es en pesos (costo de material vs monto presupuestado del rubro).
      </p>
    </div>
  );
}
