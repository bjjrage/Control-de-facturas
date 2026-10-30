"use client";

import { useEffect, useState } from "react";
import { listApuAction } from "@/app/(internal)/projects/[id]/apu-actions";
import { getCostBudgetAction } from "@/app/(internal)/projects/[id]/costeo-actions";
import { ApuDialog } from "@/app/(internal)/projects/[id]/apu-dialog";
import { Button } from "@/components/ui/button";
import type { PlanillaGridRow } from "./PlanillaGrid";

type Apu = NonNullable<Awaited<ReturnType<typeof listApuAction>>["data"]>;
const display = (n: number | null | undefined) => n == null ? "Pendiente" : n.toLocaleString("es-PY", { maximumFractionDigits: 6 });

export function WorkspaceApuPanel({ projectId, row, editable }: { projectId: string; row?: PlanillaGridRow; editable: boolean }) {
  const [data, setData] = useState<Apu | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const id = row?._rowId;
  useEffect(() => {
    if (!id || id.startsWith("new:")) return;
    let active = true;
    Promise.all([listApuAction({ projectId, budgetItemId: id }), getCostBudgetAction(projectId)])
      .then(([apu, budget]) => {
        if (!active) return;
        if (apu.error || budget.error) { setError(apu.error ?? budget.error); return; }
        setError(null); setData(apu.data); setCost(budget.data?.partidas.find(p => p.id === id)?.cost?.costoUnitario ?? null);
      }).catch(() => { if (active) setError("No se pudo consultar el APU. Reintentá."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, projectId, reload]);
  const quantity = typeof row?.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : null;
  if (!id) return <aside className="p-4">Seleccioná una partida para ver su receta y materiales.</aside>;
  if (id.startsWith("new:")) return <aside className="p-4">Guardá y confirmá la nueva partida para vincular su APU. El borrador de cómputo conserva tus cambios.</aside>;
  return <aside className="p-4 space-y-4 overflow-auto" aria-label="APU y materiales de la partida">
    <h2 className="font-semibold">{String(row?.code ?? "")} · {String(row?.description ?? "")}</h2>
    <p className="text-xs text-[var(--muted)]">APU vigente aplicado a la cantidad del borrador: {display(quantity)} {String(row?.unit ?? "")}. Editar la receta actualiza el APU de la obra; confirmar aplica el cómputo y precio del borrador.</p>
    <div className="flex gap-2">
      {editable ? <ApuDialog projectId={projectId} budgetItemId={id} budgetItemLabel={String(row?.description ?? "")} onUpdated={() => { setLoading(true); setReload(v => v + 1); }} /> : null}
      <Button variant="secondary" onClick={() => { setLoading(true); setReload(v => v + 1); }} disabled={loading}>Actualizar APU</Button>
    </div>
    {loading ? <p role="status">Consultando receta y precios…</p> : error ? <p role="alert">{error}</p> : data ? <>
      <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Costo unitario APU</dt><dd>{display(cost)}</dd><dt>Costo para el cómputo</dt><dd>{display(cost != null && quantity != null ? cost * quantity : null)}</dd></dl>
      <h3 className="font-semibold">Materiales · necesidad bruta</h3>
      <table className="w-full text-xs"><thead><tr><th className="text-left">Recurso</th><th>Por unidad</th><th>Merma %</th><th>Necesidad</th></tr></thead><tbody>{data.materials.map(m => <tr key={m.id}><td>{m.producto_nombre} ({m.unidad_medida})</td><td>{display(m.cantidad_por_unidad_ejecutada)}</td><td>{display(m.desperdicio_pct)}</td><td>{display(quantity == null ? null : quantity * m.cantidad_por_unidad_ejecutada * (1 + m.desperdicio_pct / 100))}</td></tr>)}</tbody></table>
      {!data.materials.length ? <p className="text-xs">Sin materiales vinculados.</p> : null}
      <h3 className="font-semibold">Mano de obra y equipos</h3>
      <ul className="text-xs space-y-2">{data.labor.map(l => <li key={l.id}>{l.rol}: {display(l.horas_por_unidad_ejecutada)} h/u × {display(l.costo_hora)}</li>)}{data.equipment.map(e => <li key={e.id}>{e.tipo_equipo}: {display(e.horas_por_unidad_ejecutada)} h/u × {display(e.costo_hora)}</li>)}</ul>
      <h3 className="font-semibold">Subcontratos y servicios</h3><ul className="text-xs">{data.subcontracts.map(s => <li key={s.id}>{s.descripcion}: {display(s.precio_por_unidad)} / unidad</li>)}</ul>
    </> : null}
  </aside>;
}
