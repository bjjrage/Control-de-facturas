"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  createInventoryLocation,
  setInventoryLocationActive,
  updateInventoryLocationName,
} from "@/app/(internal)/inventory/actions";
import type { InventoryLocationType } from "@/lib/inventory/types";

export type InventoryLocationAdminRow = {
  id: string;
  name: string;
  locationType: InventoryLocationType;
  projectId: string | null;
  projectName: string | null;
  parentLocationId: string | null;
  isPrimary: boolean;
  active: boolean;
};

export type InventoryProjectOption = { id: string; name: string; code: string };

const labels: Record<InventoryLocationType, string> = {
  CENTRAL: "Depósito central",
  PROJECT: "Depósito de obra",
  AUXILIARY: "Depósito auxiliar",
};
const fieldClass = "h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]";

export function UbicacionesDialog({
  locations,
  projects,
}: {
  locations: InventoryLocationAdminRow[];
  projects: InventoryProjectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [locationType, setLocationType] = useState<InventoryLocationType>("CENTRAL");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [parentLocationId, setParentLocationId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setMessage("Ubicación actualizada.");
      router.refresh();
    });
  }

  function createLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locationType === "PROJECT" && !projectId) return;
    if (locationType !== "PROJECT" && !name.trim()) return;
    startTransition(async () => {
      setMessage(null);
      const result = await createInventoryLocation({
        name: name.trim() || "Depósito de obra",
        locationType,
        projectId: locationType === "PROJECT" ? projectId : null,
        parentLocationId: locationType === "AUXILIARY" ? parentLocationId || null : null,
        isPrimary: locationType === "CENTRAL" && isPrimary,
      });
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setName("");
      setProjectId("");
      setParentLocationId("");
      setIsPrimary(false);
      setMessage("Ubicación creada o existente reutilizada.");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) { setMessage(null); setEditingId(null); } }}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="h-9 px-3 text-[12px]">Ubicaciones</Button>
      </DialogTrigger>
      <DialogContent title="Ubicaciones de stock" className="max-w-3xl">
        <div className="space-y-4">
          {message ? <p role="status" className="rounded border border-[var(--border)] px-3 py-2 text-[12px]">{message}</p> : null}

          <form onSubmit={createLocation} className="grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 sm:grid-cols-2">
            <label className="text-[11px] text-[var(--muted)]">Tipo
              <select className={`${fieldClass} mt-1`} value={locationType} onChange={(event) => setLocationType(event.target.value as InventoryLocationType)}>
                <option value="CENTRAL">Depósito central</option>
                <option value="PROJECT">Depósito de obra</option>
                <option value="AUXILIARY">Depósito auxiliar</option>
              </select>
            </label>
            {locationType === "PROJECT" ? (
              <label className="text-[11px] text-[var(--muted)]">Obra
                <select className={`${fieldClass} mt-1`} value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                  <option value="">Seleccionar obra</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="text-[11px] text-[var(--muted)]">Nombre
                <input className={`${fieldClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} maxLength={240} required placeholder={locationType === "CENTRAL" ? "Depósito central" : "Ej. Contenedor de herramientas"} />
              </label>
            )}
            {locationType === "AUXILIARY" ? (
              <label className="text-[11px] text-[var(--muted)]">Depende de (opcional)
                <select className={`${fieldClass} mt-1`} value={parentLocationId} onChange={(event) => setParentLocationId(event.target.value)}>
                  <option value="">Sin ubicación superior</option>
                  {locations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.projectName ? `${location.projectName} · ` : ""}{location.name}</option>)}
                </select>
              </label>
            ) : null}
            {locationType === "CENTRAL" ? (
              <label className="flex items-center gap-2 self-end pb-2 text-[12px]">
                <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
                Marcar como depósito central principal
              </label>
            ) : null}
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={pending || (locationType === "PROJECT" && !projectId)}>{pending ? "Guardando…" : locationType === "PROJECT" ? "Crear o reutilizar ubicación de obra" : "Crear ubicación"}</Button>
            </div>
          </form>

          <div className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border)]">
            {locations.length === 0 ? <p className="p-4 text-[12px] text-[var(--muted)]">Todavía no hay ubicaciones.</p> : (
              <table className="min-w-[680px]">
                <thead><tr><th>Ubicación</th><th>Tipo / obra</th><th>Estado</th><th></th></tr></thead>
                <tbody>{locations.map((location) => (
                  <tr key={location.id}>
                    <td>
                      {editingId === location.id ? (
                        <div className="flex gap-1">
                          <input className={fieldClass} value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={240} aria-label={`Nombre de ${location.name}`} />
                          <Button type="button" className="h-9" disabled={pending || !editingName.trim()} onClick={() => run(async () => {
                            const result = await updateInventoryLocationName(location.id, editingName);
                            if (!result.error) setEditingId(null);
                            return result;
                          })}>Guardar</Button>
                          <Button type="button" variant="secondary" className="h-9" onClick={() => setEditingId(null)}>Cancelar</Button>
                        </div>
                      ) : <span className="font-medium">{location.name}{location.isPrimary ? <span className="ml-2 text-[10px] text-[var(--muted)]">Principal</span> : null}</span>}
                    </td>
                    <td className="text-[11px] text-[var(--muted)]">{labels[location.locationType]}{location.projectName ? ` · ${location.projectName}` : ""}</td>
                    <td>{location.active ? "Activa" : "Inactiva"}</td>
                    <td className="text-right whitespace-nowrap">
                      {editingId !== location.id ? <button type="button" className="mr-3 text-[11px] text-action" onClick={() => { setEditingId(location.id); setEditingName(location.name); }}>Renombrar</button> : null}
                      <button type="button" disabled={pending} className={`text-[11px] ${location.active ? "text-[var(--error)]" : "text-[var(--ok)]"}`} onClick={() => run(() => setInventoryLocationActive(location.id, !location.active))}>{location.active ? "Desactivar" : "Reactivar"}</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)]">Las ubicaciones con stock positivo o un QR activo no se pueden desactivar. El historial de movimientos se conserva.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
