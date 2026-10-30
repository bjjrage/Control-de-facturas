"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { saveBudgetItemMaterialAction, saveBudgetItemLaborAction, saveBudgetItemEquipmentAction, saveBudgetItemSubcontractAction, type listApuAction } from "@/app/(internal)/projects/[id]/apu-actions";

type Apu = NonNullable<Awaited<ReturnType<typeof listApuAction>>["data"]>;
type Field = { key: string; label: string; value: number; disabled?: boolean; max?: number };

function LineEditor({ lineId, label, fields, save, onSaved }: {
  lineId: string; label: string; fields: Field[]; save: (values: Record<string, number>) => Promise<{ success: boolean; error: string | null }>; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return <form data-apu-line={lineId} aria-label={`Editar ${label}`} onChange={() => setSaved(false)} className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] p-3" onSubmit={async event => {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const values: Record<string, number> = {};
    for (const field of fields) {
      // HTML number controls serialize canonical numbers, without locale grouping.
      const raw = field.disabled ? String(field.value) : String(form.get(field.key) ?? "");
      const value = raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value < 0 || (field.max !== undefined && value > field.max)) { setError(`Revisá ${field.label.toLowerCase()}.`); return; }
      values[field.key] = value;
    }
    setSaving(true);
    try {
      const result = await save(values);
      if (result.error || !result.success) { setError(result.error ?? "No se pudo guardar el componente."); return; }
      setSaved(true); onSaved();
    } catch { setError("No se pudo guardar el componente. Tus valores siguen en el editor para reintentar."); }
    finally { setSaving(false); }
  }}>
    <p className="min-w-40 flex-1 text-sm font-medium">{label}</p>
    {fields.map(field => <label key={field.key} className="text-xs">{field.label}<input aria-label={field.label} name={field.key} type="number" min="0" max={field.max} step="any" required defaultValue={field.value} disabled={saving || field.disabled} className="mt-1 block w-32 rounded border border-[var(--border)] p-2 disabled:opacity-60" /></label>)}
    <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar componente"}</Button>
    {saved ? <span role="status" className="text-xs text-emerald-300">Guardado</span> : null}
    {error ? <p role="alert" className="w-full text-xs text-[var(--error)]">{error}</p> : null}
  </form>;
}

export function WorkspaceApuEditor({ projectId, budgetItemId, data, onSaved }: { projectId: string; budgetItemId: string; data: Apu; onSaved: () => void }) {
  return <section aria-label="Editor de APU" className="space-y-3">
    <h3 className="font-semibold">Editar componentes del APU</h3>
    <p className="text-xs text-[var(--muted)]">Guardás cada componente en la receta vigente de la obra. El cómputo continúa en su borrador. Los precios documentales de materiales se conservan.</p>
    <h4 className="font-semibold">Materiales</h4>
    {data.materials.map(material => <LineEditor key={material.id} lineId={material.id} label={`material ${material.producto_nombre}`} fields={[{key:"quantity",label:`Consumo por unidad (${material.unidad_medida})`,value:material.cantidad_por_unidad_ejecutada},{key:"waste",label:"Merma (%)",value:material.desperdicio_pct}]} onSaved={onSaved} save={values => saveBudgetItemMaterialAction({ projectId,budgetItemId,productoId:material.producto_id,cantidadPorUnidad:values.quantity,desperdicioPct:values.waste })} />)}
    {!data.materials.length ? <p className="text-xs">Sin materiales vinculados a esta partida.</p> : null}
    <h4 className="font-semibold">Mano de obra</h4>
    {data.labor.map(labor => <LineEditor key={labor.id} lineId={labor.id} label={`mano de obra ${labor.rol}`} fields={[{key:"hours",label:"Horas por unidad",value:labor.horas_por_unidad_ejecutada},{key:"cost",label:labor.labor_rate_id ? "Costo de categoría (Gs/h)" : "Costo por hora (Gs)",value:labor.costo_hora,disabled:Boolean(labor.labor_rate_id)}]} onSaved={onSaved} save={values => saveBudgetItemLaborAction({ projectId,budgetItemId,rol:labor.rol,horasPorUnidad:values.hours,costoHora:values.cost,laborRateId:labor.labor_rate_id })} />)}
    <h4 className="font-semibold">Equipos</h4>
    {data.equipment.map(equipment => <LineEditor key={equipment.id} lineId={equipment.id} label={`equipo ${equipment.tipo_equipo}`} fields={[{key:"hours",label:"Horas por unidad",value:equipment.horas_por_unidad_ejecutada},{key:"cost",label:"Costo por hora (Gs)",value:equipment.costo_hora}]} onSaved={onSaved} save={values => saveBudgetItemEquipmentAction({ projectId,budgetItemId,tipoEquipo:equipment.tipo_equipo,horasPorUnidad:values.hours,costoHora:values.cost })} />)}
    <h4 className="font-semibold">Subcontratos y servicios</h4>
    {data.subcontracts.map(service => <LineEditor key={service.id} lineId={service.id} label={`servicio ${service.descripcion}`} fields={[{key:"price",label:"Precio por unidad (Gs)",value:service.precio_por_unidad}]} onSaved={onSaved} save={values => saveBudgetItemSubcontractAction({ projectId,budgetItemId,descripcion:service.descripcion,precioPorUnidad:values.price })} />)}
  </section>;
}

