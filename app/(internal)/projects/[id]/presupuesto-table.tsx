"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { formatMoney, formatDate } from "@/lib/format";
import { EditBudgetItemDialog } from "./edit-budget-item-dialog";

type Row = {
  id: string;
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  subtotal: number;
  execPct: number | null;
  startDate: string | null;
  endDate: string | null;
};

const unitLabel = (r: Row) => r.unit ?? "—";
const qtyLabel = (r: Row) => (r.quantity ?? "—").toString();
const priceLabel = (r: Row) => (r.unitPrice != null ? formatMoney(r.unitPrice, "PYG") : "—");
const subtotalLabel = (r: Row) => formatMoney(r.subtotal, "PYG");
const execLabel = (r: Row) => (r.execPct !== null ? `${r.execPct}%` : "—");

type ColKey = "code" | "description" | "unit" | "quantity" | "unitPrice" | "subtotal" | "execPct";

export function PresupuestoTable({ rows, total, projectId }: { rows: Row[]; total: number; projectId: string }) {
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    code: null,
    description: null,
    unit: null,
    quantity: null,
    unitPrice: null,
    subtotal: null,
    execPct: null,
  });

  const uniques = useMemo(
    () => ({
      code: uniqueValues(rows, (r) => r.code),
      description: uniqueValues(rows, (r) => r.description),
      unit: uniqueValues(rows, unitLabel),
      quantity: uniqueValues(rows, qtyLabel),
      unitPrice: uniqueValues(rows, priceLabel),
      subtotal: uniqueValues(rows, subtotalLabel),
      execPct: uniqueValues(rows, execLabel),
    }),
    [rows]
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!passesColumnFilter(r.code, colFilters.code)) return false;
      if (!passesColumnFilter(r.description, colFilters.description)) return false;
      if (!passesColumnFilter(unitLabel(r), colFilters.unit)) return false;
      if (!passesColumnFilter(qtyLabel(r), colFilters.quantity)) return false;
      if (!passesColumnFilter(priceLabel(r), colFilters.unitPrice)) return false;
      if (!passesColumnFilter(subtotalLabel(r), colFilters.subtotal)) return false;
      if (!passesColumnFilter(execLabel(r), colFilters.execPct)) return false;
      if (!term) return true;
      return r.code.toLowerCase().includes(term) || r.description.toLowerCase().includes(term);
    });
  }, [rows, q, colFilters]);

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
              <th>
                Código
                <ColumnFilter values={uniques.code} selected={colFilters.code} onChange={(v) => setCol("code", v)} />
              </th>
              <th>
                Descripción
                <ColumnFilter
                  values={uniques.description}
                  selected={colFilters.description}
                  onChange={(v) => setCol("description", v)}
                />
              </th>
              <th>
                Unid.
                <ColumnFilter values={uniques.unit} selected={colFilters.unit} onChange={(v) => setCol("unit", v)} />
              </th>
              <th className="num">
                Cantidad
                <ColumnFilter values={uniques.quantity} selected={colFilters.quantity} onChange={(v) => setCol("quantity", v)} />
              </th>
              <th className="num">
                P. Unit.
                <ColumnFilter values={uniques.unitPrice} selected={colFilters.unitPrice} onChange={(v) => setCol("unitPrice", v)} />
              </th>
              <th className="num">
                Subtotal
                <ColumnFilter values={uniques.subtotal} selected={colFilters.subtotal} onChange={(v) => setCol("subtotal", v)} />
              </th>
              <th className="num">
                Ejecutado
                <ColumnFilter values={uniques.execPct} selected={colFilters.execPct} onChange={(v) => setCol("execPct", v)} />
              </th>
              <th>Cronograma</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "Sin ítems todavía." : "Sin resultados para ese filtro."}
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
                  <td className="text-[12px] text-[var(--muted)]">
                    {r.startDate && r.endDate ? `${formatDate(r.startDate)} → ${formatDate(r.endDate)}` : "Sin fecha"}
                  </td>
                  <td>
                    <EditBudgetItemDialog projectId={projectId} row={r} />
                  </td>
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
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
