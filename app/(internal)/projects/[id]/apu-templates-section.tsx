"use client";

import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listApuTemplatesAction, deleteApuTemplateAction, type ApuTemplateSummary } from "./apu-templates-actions";
import { ApuPlanillaImport } from "./apu-planilla-import";

export function ApuTemplatesSection() {
  const [templates, setTemplates] = useState<ApuTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ApuTemplateSummary | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await listApuTemplatesAction();
      if (res.error) setError(res.error);
      else if (res.data) setTemplates(res.data);
    } catch {
      setError("No se pudieron cargar las plantillas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete() {
    if (!deleting || deletePending) return;
    setDeletePending(true);
    setError(null);
    try {
      const res = await deleteApuTemplateAction(deleting.id);
      if (res.error) { setError(res.error); return; }
      setDeleting(null);
      await refresh();
    } catch {
      setError("No se pudo borrar la plantilla. Reintentá.");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-[15px] font-semibold">Plantillas de APU<InfoTooltip className="ml-1" label={"Plantillas de APU"} content={"Cargá UNA VEZ las recetas (APU) que ya usa tu empresa, con el formato que tengan. Después, en cualquier obra, se aplican solas a toda partida cuya descripción coincida."} /></h2>


      <ApuPlanillaImport onDone={refresh} />
      {error ? <p role="alert" className="text-[12px] text-[var(--error)]">{error}</p> : null}

      <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
              <th className="py-1.5 px-2">Plantilla</th>
              <th className="py-1.5 px-2 text-right">Materiales</th>
              <th className="py-1.5 px-2 text-right">Mano de obra</th>
              <th className="py-1.5 px-2 text-right">Equipo</th>
              <th className="py-1.5 px-2 text-right">Subcontrato</th>
              <th className="py-1.5 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading ? (
              <tr><td colSpan={6} className="py-3 px-2 text-[var(--muted)]">Cargando…</td></tr>
            ) : templates.length === 0 ? (
              <tr><td colSpan={6} className="py-3 px-2 text-[var(--muted)]">Sin plantillas cargadas todavía.</td></tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 px-2">{t.nombre}</td>
                  <td className="py-1.5 px-2 text-right">{t.materialesCount}</td>
                  <td className="py-1.5 px-2 text-right">{t.laborCount}</td>
                  <td className="py-1.5 px-2 text-right">{t.equipoCount}</td>
                  <td className="py-1.5 px-2 text-right">{t.subcontratoCount}</td>
                  <td className="py-1.5 px-2 text-right">
                    <button type="button" aria-label={`Borrar plantilla ${t.nombre}`} onClick={(event) => { deleteTrigger.current = event.currentTarget; setError(null); setDeleting(t); }} className="rounded p-1 text-[var(--muted)] hover:text-[var(--error)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deletePending) setDeleting(null); }}>
        <DialogContent title="Borrar plantilla de APU" onCloseAutoFocus={(event) => { event.preventDefault(); deleteTrigger.current?.focus(); }}>
          <p className="text-sm">¿Borrar «{deleting?.nombre}»? Las obras donde ya se aplicó conservan sus recetas.</p>
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--error)]">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild><Button variant="secondary" disabled={deletePending}>Cancelar</Button></DialogClose>
            <Button variant="danger" disabled={deletePending} onClick={handleDelete}>{deletePending ? "Borrando…" : "Borrar plantilla"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
