"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Upload is only the entry point. Review continues in a durable workspace. */
export function WorkbookImportPreview({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  async function upload(file: File | null) {
    if (!file) return;
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) { setError("Subí un archivo .xlsx."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("El archivo supera el límite de 10 MB."); return; }
    setUploading(true);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/import-sessions", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.sessionId) throw new Error(result.error ?? "No se pudo guardar la planilla.");
      router.push(`/projects/import/${result.sessionId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo subir la planilla."); setUploading(false); }
  }
  return <div className="space-y-4">
    <div className="rounded-xl border border-dashed border-sky-300/25 p-6 text-center">
      <FileSpreadsheet className="mx-auto text-sky-200" size={28} />
      <h2 className="mt-3 font-semibold">De tu planilla al workspace de obra</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">Luna vincula partidas, APU, materiales y cronograma. Revisás y editás el cómputo en el workspace; el Excel original y sus fórmulas se conservan.</p>
      <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded border border-[var(--border)] px-4 py-2 text-sm"><Upload size={15} />{uploading ? "Guardando y abriendo workspace…" : "Elegir planilla"}<input aria-label="Elegir planilla" className="sr-only" type="file" accept=".xlsx" disabled={uploading} onChange={event => { void upload(event.target.files?.[0] ?? null); }} /></label>
    </div>
    {error ? <p role="alert" className="text-sm text-[var(--error)]">{error}</p> : null}
    <Button variant="secondary" disabled={uploading} onClick={onBack}>Volver</Button>
  </div>;
}
