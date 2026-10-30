"use client";

import { useState } from "react";
import type { CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import type { PlanillaRow } from "@/lib/planillas/types";
import { materialNeed, type WorkspaceMaterial } from "@/lib/workbook-interpretation/import-workspace";

export const displayWorkspaceNumber = (value: number | null | undefined) => value == null ? "Pendiente" : value.toLocaleString("es-PY", { maximumFractionDigits: 6 });
const num = displayWorkspaceNumber;
const kinds = { MATERIAL: "Material", LABOR: "Mano de obra", EQUIPMENT: "Equipo", TRANSPORT: "Transporte" };

export function SourceApuView({ candidate, row }: { candidate: CanonicalImportCandidate; row?: PlanillaRow }) {
  const recipe = candidate.linkedRecipes?.recipes.find(recipe => recipe.budgetCode === row?.code);
  if (!recipe) return <p className="p-4">Esta partida no tiene un APU vinculado verificado. Revisá las fuentes antes de aplicarla.</p>;
  return <section className="space-y-3 p-4" aria-label="Receta APU vinculada">
    <h2 className="font-semibold">{recipe.budgetCode} · {recipe.description}</h2>
    <p className="text-xs text-[var(--muted)]">Fuente: {recipe.sheet} · filas {recipe.startRow}–{recipe.endRow}. La receta conserva sus consumos; las necesidades usan la cantidad del borrador.</p>
    <p>Precio documental APU: <strong>{num(recipe.adoptedPrice)}</strong> · Cantidad de trabajo: <strong>{num(typeof row?.quantity === "number" ? row.quantity : null)} {recipe.unit}</strong></p>
    <table className="w-full text-sm"><caption className="sr-only">Componentes de la receta</caption><thead><tr><th>Tipo</th><th className="text-left">Recurso</th><th>Unidad</th><th>Consumo/u</th><th>Precio fuente</th><th>Necesidad</th><th>Celda</th></tr></thead><tbody>{recipe.lines.map((line, index) => <tr key={`${line.source.cell}-${index}`} className="border-t border-[var(--border)]"><td>{kinds[line.kind]}</td><td className="py-2">{line.description}</td><td>{line.unit}</td><td>{num(line.quantity)}</td><td>{num(line.price)}</td><td>{num(typeof row?.quantity === "number" ? row.quantity * line.quantity : null)}</td><td className="text-xs">{line.source.sheet}!{line.source.cell}</td></tr>)}</tbody></table>
    {recipe.adjustments.length ? <p className="text-xs">Ajustes documentales: {recipe.adjustments.map(a => `${a.label}: ${num(a.amount)}`).join(" · ")}</p> : null}
    <p className="text-xs text-[var(--muted)]">El APU importado se revisa aquí. Su edición se habilita al crear la obra, usando el mismo editor APU del workspace.</p>
  </section>;
}

export function MaterialsWorkspaceView({ materials, rows, onSelect }: { materials: WorkspaceMaterial[]; rows: PlanillaRow[]; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = materials.filter(material => material.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="p-4 space-y-3" aria-label="Materiales vinculados">
    <h2 className="font-semibold">Materiales · necesidades del cómputo</h2>
    <p className="text-xs text-[var(--muted)]">Consumo de cada receta × cantidad de su partida. La merma vigente está incluida. Estas necesidades no son movimientos de stock ni pedidos de compra.</p>
    <input aria-label="Buscar material" placeholder="Buscar material…" value={search} onChange={e => setSearch(e.target.value)} className="w-full max-w-md rounded border border-[var(--border)] p-2" />
    <p className="text-sm">{materials.length} materiales vinculados · {visible.length} visibles</p>
    <table className="w-full text-sm"><caption className="sr-only">Necesidades de materiales por partida</caption><thead><tr><th className="text-left">Material</th><th>Unidad</th><th>Necesidad bruta</th><th>Procedencia</th></tr></thead><tbody>{visible.map(material => <tr key={material.key} className="border-t border-[var(--border)]"><td className="py-2">{material.description}</td><td>{material.unit}</td><td data-material-need={material.key}>{num(materialNeed(material, rows))}</td><td><button className="underline" onClick={() => setExpanded(expanded === material.key ? null : material.key)}>{new Set(material.links.map(link => link.rowId)).size} partidas</button>{expanded === material.key ? <div className="flex max-w-sm flex-wrap gap-2 p-2">{[...new Map(material.links.map(link => [link.rowId, link])).values()].map(link => <button key={link.rowId} className="underline" onClick={() => onSelect(link.rowId)}>Ver APU {link.code}</button>)}</div> : null}</td></tr>)}</tbody></table>
    {!materials.length ? <p>No hay materiales vinculados verificados.</p> : null}
  </section>;
}

export function ScheduleWorkspaceView({ candidate, rows, onSelect }: { candidate: CanonicalImportCandidate; rows: PlanillaRow[]; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const schedules = candidate.linkedRecipes?.relativeSchedule ?? [];
  const byCode = new Map(rows.filter(row => !row._deleted).map(row => [row.code, row]));
  return <section className="p-4 space-y-4" aria-label="Cronograma vinculado">
    <h2 className="font-semibold">Cronograma · {schedules.length} partidas vinculadas</h2>
    <p className="text-xs text-[var(--muted)]">Los días son relativos al inicio de obra. Los valores mensuales y la curva son los documentados en Excel; cambiar el cómputo no redistribuye automáticamente el plazo ni esos importes.</p>
    {candidate.schedulePlans.map(plan => <div key={plan.planVersion} className="rounded border border-[var(--border)] p-3"><h3>{plan.label}</h3><div className="mt-2 flex flex-wrap gap-4 text-sm">{plan.months.map(month => <span key={month.monthIndex}>Mes {month.monthIndex}: {num(month.programadoPct)} %</span>)}</div></div>)}
    <input aria-label="Buscar partida en cronograma" placeholder="Buscar partida…" value={search} onChange={e => setSearch(e.target.value)} className="rounded border border-[var(--border)] p-2" />
    <table className="w-full text-sm"><thead><tr><th className="text-left">Partida</th><th>Cantidad del borrador</th><th>Día inicio</th><th>Día fin</th><th>Distribución documental</th><th>Fuente</th></tr></thead><tbody>{schedules.filter(schedule => `${schedule.budgetCode} ${byCode.get(schedule.budgetCode)?.description ?? ""}`.toLowerCase().includes(search.toLowerCase())).map(schedule => {
      const row = byCode.get(schedule.budgetCode);
      return <tr key={schedule.budgetCode} className="border-t border-[var(--border)]"><td className="py-2"><button className="text-left underline" onClick={() => row && onSelect(row._rowId)}>{schedule.budgetCode} · {String(row?.description ?? "Sin partida")}</button></td><td>{num(typeof row?.quantity === "number" ? row.quantity : null)}</td><td>{num(schedule.startDay)}</td><td>{num(schedule.endDay)}</td><td className="text-xs">{schedule.monthlyValues.map(month => `M${month.month}: ${num(month.value)}`).join(" · ")}</td><td className="text-xs">{schedule.source.sheet} · fila {schedule.source.row}</td></tr>;
    })}</tbody></table>
    {!schedules.length && !candidate.schedulePlans.length ? <p>No se detectó un cronograma verificable. Queda pendiente de planificación.</p> : null}
  </section>;
}
