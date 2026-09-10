"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { dejarDeSeguirLicitacion, importarLicitacion, convertirLicitacionAProyecto } from "../actions";

export function ReimportarButton({ nro, id }: { nro: string; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [busyConvert, setBusyConvert] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || busyConvert}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await importarLicitacion(nro);
            setBusy(false);
            if (res.error) setError(res.error);
            else router.refresh();
          }}
        >
          {busy ? "Sincronizando…" : "Re-sincronizar con DNCP"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || busyConvert}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const { generarPliegoOfertaCompleto } = await import("../actions");
            const res = await generarPliegoOfertaCompleto(id);
            setBusy(false);
            if (res.error) {
              setError(res.error);
            } else {
              const errTxt = res.validationErrors && res.validationErrors.length > 0
                ? `\n\nObservaciones pendientes:\n• ${res.validationErrors.join('\n• ')}`
                : '';
              alert(`Paquete de licitación ensamblado:\n• Estado: ${res.packageStatus}\n• Formularios generados: ${res.formsCount}\n• Documentos de bóveda vinculados: ${res.attachedDocsCount}\n• Monto total ofertado: Gs. ${res.totalAmountPyg?.toLocaleString('es-PY')}${errTxt}`);
              router.refresh();
            }
          }}
        >
          {busy ? "Ensamblando…" : "Ensamblar Pliego y Formularios"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || busyConvert}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const { persistirEvaluacionComercial } = await import("../actions");
            const res = await persistirEvaluacionComercial(id);
            setBusy(false);
            if (res.error) {
              setError(res.error);
            } else {
              alert(`Corrida de análisis congelada con éxito:\n• Dictamen: ${res.decision}\n• Score: ${res.score}/100\n• Hash SHA-256: ${res.hash?.slice(0, 16)}...`);
              router.refresh();
            }
          }}
        >
          {busy ? "Evaluando…" : "Congelar Análisis (SHA-256)"}
        </Button>
        <Button
          disabled={busy || busyConvert}
          className="bg-[var(--primary)] text-white hover:opacity-90"
          onClick={async () => {
            if (!confirm("¿Convertir esta licitación en un Proyecto activo en el ERP? Se creará la obra, el cómputo métrico y el pañol.")) return;
            setBusyConvert(true);
            setError(null);
            const res = await convertirLicitacionAProyecto(id);
            setBusyConvert(false);
            if (res.error) {
              setError(res.error);
            } else if (res.projectId) {
              router.push(`/projects/${res.projectId}`);
            }
          }}
        >
          {busyConvert ? "Creando obra…" : "Adjudicada → Convertir en Obra"}
        </Button>
        <Button
          variant="danger"
          disabled={busy || busyConvert}
          onClick={async () => {
            if (!confirm("¿Dejar de seguir esta licitación? Se borra de tu lista (no de la DNCP).")) return;
            setBusy(true);
            const res = await dejarDeSeguirLicitacion(id);
            setBusy(false);
            if (res.error) setError(res.error);
            else router.push("/licitaciones");
          }}
        >
          Dejar de seguir
        </Button>
      </div>
      {error ? <span className="text-[11px] text-[var(--error)]">{error}</span> : null}
    </div>
  );
}
