"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyApuTemplatesToProjectAction } from "./apu-actions";

export function ApplyApuTemplatesButton({ projectId }: { projectId: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ aplicadas: number; yaTeniaApu: number; sinPlantilla: { code: string; description: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    setPending(true);
    setError(null);
    setResult(null);
    const res = await applyApuTemplatesToProjectAction(projectId);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    router.refresh();
  }

  return (
    <div className="space-y-1.5">
      <Button type="button" variant="secondary" onClick={handleClick} disabled={pending} className="gap-1.5">
        {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Aplicar plantillas de APU
      </Button>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      {result && (
        <div className="text-[11px] text-[var(--muted)] max-w-xl">
          <p>
            {result.aplicadas} partida(s) recibieron APU de una plantilla de empresa · {result.yaTeniaApu} ya tenían APU cargado.
          </p>
          {result.sinPlantilla.length > 0 && (
            <p className="mt-0.5 text-amber-500">
              Sin plantilla que coincida ({result.sinPlantilla.length}): {result.sinPlantilla.slice(0, 6).map((s) => s.description).join(", ")}
              {result.sinPlantilla.length > 6 ? "…" : ""} — cargalas manual con el ícono de calculadora, o agregá la plantilla en Configuración.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
