"use client";

import { useState } from "react";
import type { OperationalProjection } from "@/lib/planillas/operational-projection";

const num = (value: number | null | undefined) => value == null ? "Pendiente" : value.toLocaleString("es-PY", { maximumFractionDigits: 6 });

export function OperationalScheduleView({ projection, onSelect }: { projection: OperationalProjection; onSelect?: (id: string) => void }) {
  const [search, setSearch] = useState("");
  return <section className="p-4 space-y-4" aria-label="Proyección vigente de la obra">
    <h2 className="font-semibold">Cronograma · proyección vigente</h2>
    <p className="text-xs text-[var(--muted)]">Cantidades y receta APU vigentes, distribuidas según los períodos del plan de origen. Los días y proporciones se conservan; las necesidades y montos se recalculan. El precio de venta se edita en Partidas y el costo directo se calcula con el APU.</p>
    <dl className="flex flex-wrap gap-6 text-sm"><div><dt>Presupuesto de venta (Gs)</dt><dd data-projection-sale className="font-semibold">{num(projection.sale)}</dd></div><div><dt>Costo directo APU (Gs)</dt><dd data-projection-cost className="font-semibold">{num(projection.cost)}</dd></div></dl>
    {projection.issues.length ? <p role="status" className="text-sm text-amber-300">Planificación parcial: {projection.issues.length} partida(s) requieren distribución. {projection.issues.slice(0, 3).join(" ")}</p> : null}
    <table className="w-full text-sm" aria-label="Montos y materiales por mes"><thead><tr><th>Período</th><th>Venta programada (Gs)</th><th>Costo APU programado (Gs)</th><th>Materiales necesarios</th></tr></thead><tbody>{projection.months.map(month => <tr key={month.month} className="border-t border-[var(--border)]"><td>Mes {month.month}</td><td data-month-sale={month.month}>{num(month.sale)}</td><td data-month-cost={month.month}>{num(month.cost)}</td><td><details><summary className="cursor-pointer py-2">{month.materials.length} materiales</summary><ul className="space-y-1 pb-2">{month.materials.map(material => <li key={material.key}>{material.description}: <span data-schedule-material={`${material.key}:${month.month}`}>{num(material.quantity)}</span> {material.unit}</li>)}</ul></details></td></tr>)}</tbody></table>
    <details><summary className="cursor-pointer text-sm">Ver {projection.items.length} partidas vinculadas</summary>
    <label className="block text-xs mt-3">Buscar partida en la proyección<input aria-label="Buscar partida en cronograma" value={search} onChange={event => setSearch(event.target.value)} className="ml-2 rounded border border-[var(--border)] p-2" /></label>
    <table className="w-full text-sm" aria-label="Partidas del cronograma vigente"><thead><tr><th className="text-left">Partida</th><th>Cantidad</th><th>Día inicio</th><th>Día fin</th><th>Venta por mes</th><th>Costo APU por mes</th></tr></thead><tbody>{projection.items.filter(item => `${item.code} ${item.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item => <tr key={item.rowId} data-schedule-item={item.rowId} className="border-t border-[var(--border)]"><td className="py-2">{onSelect ? <button className="text-left underline" onClick={() => onSelect(item.rowId)}>{item.code} · {item.description}</button> : `${item.code} · ${item.description}`}</td><td>{num(item.quantity)}</td><td>{num(item.schedule?.startDay)}</td><td>{num(item.schedule?.endDay)}</td><td>{item.months.map(month => `M${month.month}: ${num(month.sale)}`).join(" · ") || "Pendiente"}</td><td>{item.months.map(month => `M${month.month}: ${num(month.cost)}`).join(" · ") || "Pendiente"}</td></tr>)}</tbody></table>
    </details>
  </section>;
}
