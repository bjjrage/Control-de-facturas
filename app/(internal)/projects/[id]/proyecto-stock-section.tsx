"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney, formatNumber } from "@/lib/format";

export type StockProyectoRow = {
  producto_id: string;
  producto: string;
  unidad: string;
  costo_promedio: number;
  qty_comprada: number;
  qty_consumida: number;
  qty_disponible: number;
  costo_comprado: number;
  costo_consumido: number;
};

type SortKey = "producto" | "qty_comprada" | "qty_consumida" | "qty_disponible" | "costo_comprado" | "costo_consumido";

export function ProyectoStockSection({
  rows,
  panoles,
}: {
  rows: StockProyectoRow[];
  panoles: { id: string; nombre: string }[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("producto");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const panolBanner = panoles.length > 0 ? (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 flex items-center justify-between gap-4">
      <div className="text-[13px]">
        <span className="text-[11px] text-[var(--muted)] block mb-0.5">Depósito / Pañol vinculado</span>
        <span className="font-medium">{panoles.map((p) => p.nombre).join(", ")}</span>
      </div>
      <Link href="/stock" className="text-action text-[12px] shrink-0">
        Ver stock global →
      </Link>
    </div>
  ) : (
    <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 flex items-center justify-between gap-4 text-[13px] text-[var(--muted)]">
      <span>Esta obra no tiene un depósito/pañol asignado.</span>
      <Link href="/stock" className="text-action text-[12px] shrink-0">
        Gestionar depósitos →
      </Link>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {panolBanner}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-10 text-center text-[13px] text-[var(--muted)]">
          Aún no hay movimientos de stock imputados a esta obra.
          <div className="mt-2 text-[12px]">
            Al registrar una{" "}
            <span className="font-medium text-[var(--foreground)]">Entrada</span> o{" "}
            <span className="font-medium text-[var(--foreground)]">Salida</span> de stock,
            elegí este proyecto para que aparezca aquí.{" "}
            <Link href="/stock" className="text-action">Ir a Stock →</Link>
          </div>
        </div>
      </div>
    );
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...rows].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "producto") return mul * a.producto.localeCompare(b.producto, "es");
    return mul * (a[sortKey] - b[sortKey]);
  });

  const totalComprado  = rows.reduce((s, r) => s + r.costo_comprado,  0);
  const totalConsumido = rows.reduce((s, r) => s + r.costo_consumido, 0);

  function Th({ k, label, right }: { k: SortKey; label: string; right?: boolean }) {
    const active = sortKey === k;
    return (
      <th
        className={`cursor-pointer select-none ${right ? "num" : ""}`}
        onClick={() => toggleSort(k)}
      >
        {label}{" "}
        <span className={`text-[10px] ${active ? "text-[var(--primary)]" : "text-[var(--muted)] opacity-40"}`}>
          {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </th>
    );
  }

  return (
    <div className="space-y-3">
      {panolBanner}
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Stock imputado a esta obra</h3>
        <span className="text-[11px] text-[var(--muted)]">
          Al registrar movimientos de stock, seleccioná este proyecto para ver el seguimiento aquí.
        </span>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <Th k="producto" label="Producto" />
              <th>Unidad</th>
              <Th k="qty_comprada"  label="Comprado"  right />
              <Th k="qty_consumida" label="Consumido" right />
              <Th k="qty_disponible" label="Disponible" right />
              <Th k="costo_comprado"  label="Valor comprado"  right />
              <Th k="costo_consumido" label="Valor consumido" right />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const escaso = r.qty_disponible < 0;
              return (
                <tr key={r.producto_id}>
                  <td className="font-medium">{r.producto}</td>
                  <td className="text-[var(--muted)]">{r.unidad}</td>
                  <td className="num">{formatNumber(r.qty_comprada,  2)}</td>
                  <td className="num">{formatNumber(r.qty_consumida, 2)}</td>
                  <td className={`num font-semibold ${escaso ? "text-[var(--error)]" : r.qty_disponible === 0 ? "text-[var(--muted)]" : "text-[var(--ok)]"}`}>
                    {formatNumber(r.qty_disponible, 2)}
                  </td>
                  <td className="num text-[var(--muted)]">{formatMoney(r.costo_comprado,  "PYG")}</td>
                  <td className="num text-[var(--muted)]">{formatMoney(r.costo_consumido, "PYG")}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="font-semibold">Total</td>
              <td className="num font-semibold">{formatMoney(totalComprado,  "PYG")}</td>
              <td className="num font-semibold">{formatMoney(totalConsumido, "PYG")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Entradas y salidas de stock con este proyecto seleccionado. "Disponible" puede ser negativo si
        se consumió más de lo que se compró para la obra.
      </p>
    </div>
  );
}
