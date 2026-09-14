"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GenerarPlanillaButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/planillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modulo: "computo_presupuesto", contexto: { projectId } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "No se pudo generar la plantilla.");
      const volver = encodeURIComponent(`/projects/${projectId}?tab=presupuesto`);
      router.push(`/planillas/${body.id}?volver=${volver}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar la plantilla.");
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col">
      <Button variant="secondary" onClick={handleClick} disabled={loading}>
        <Sheet size={14} className="mr-1.5" />
        {loading ? "Generando…" : "Generar plantilla de trabajo"}
      </Button>
      {error ? <span className="text-[11px] text-[var(--error)] mt-1">{error}</span> : null}
    </div>
  );
}
