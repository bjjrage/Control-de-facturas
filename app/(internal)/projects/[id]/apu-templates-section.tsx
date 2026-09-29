"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { listApuTemplatesAction, deleteApuTemplateAction, type ApuTemplateSummary } from "./apu-templates-actions";
import { ApuPlanillaImport } from "./apu-planilla-import";

export function ApuTemplatesSection() {
  const [templates, setTemplates] = useState<ApuTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  function refresh() {
    setLoading(true);
    listApuTemplatesAction().then((res) => {
      if (res.data) setTemplates(res.data);
      setLoading(false);
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string, nombre: string) {
    if (!window.confirm(`¿Borrar la plantilla "${nombre}"? Esto no afecta las obras donde ya se aplicó.`)) return;
    const res = await deleteApuTemplateAction(id);
    if (!res.error) refresh();
  }

  return (
    <div className="space-y-3">
      <h2 className="text-[15px] font-semibold">Plantillas de APU</h2>
      <p className="text-[13px] text-[var(--muted)]">
        Cargá UNA VEZ las recetas (APU) que ya usa tu empresa, con el formato que tengan. Después, en cualquier obra, se aplican solas a toda partida cuya descripción coincida.
      </p>

      <ApuPlanillaImport onDone={refresh} />

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
                    <button onClick={() => handleDelete(t.id, t.nombre)} className="text-[var(--muted)] hover:text-[var(--error)]">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
