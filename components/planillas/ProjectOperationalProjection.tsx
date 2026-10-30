"use client";

import { useEffect, useState } from "react";
import type { OperationalProjection } from "@/lib/planillas/operational-projection";
import { OperationalScheduleView } from "./OperationalScheduleView";

export function ProjectOperationalProjection({ projectId, onLoaded }: { projectId: string; onLoaded?: (value: OperationalProjection) => void }) {
  const [projection, setProjection] = useState<OperationalProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${projectId}/operational-projection`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return await response.json() as OperationalProjection; })
      .then(value => { setError(null); setProjection(value); onLoaded?.(value); })
      .catch(() => { if (!controller.signal.aborted) setError("No se pudo actualizar la proyección de la obra."); });
    return () => controller.abort();
  }, [projectId, revision, onLoaded]);
  return <section className="rounded-xl border border-[var(--border)]" aria-label="Planificación operativa del ERP">
    <div className="flex items-center justify-between p-3"><h2 className="font-semibold">Planificación del cómputo vigente</h2><button className="underline text-sm" onClick={() => setRevision(value => value + 1)}>Actualizar planificación</button></div>
    {error ? <p role="alert" className="p-4">{error}</p> : projection ? <OperationalScheduleView projection={projection} /> : <p role="status" className="p-4">Calculando cantidades, costos y materiales por período…</p>}
  </section>;
}
