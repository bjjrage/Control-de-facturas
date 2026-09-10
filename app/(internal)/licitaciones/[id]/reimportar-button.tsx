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
