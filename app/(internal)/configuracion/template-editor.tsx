"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SalesDocType } from "@/lib/types";
import { generateTemplate, saveTemplate, deleteTemplate } from "./actions";

export function TemplateEditor({
  docType,
  label,
  empresaId,
  hasTemplate,
}: {
  docType: SalesDocType;
  label: string;
  empresaId: string;
  hasTemplate: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "generated" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [saved, setSaved] = useState(hasTemplate);
  const [deleting, setDeleting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleFileChange(file: File | null) {
    if (!file) return;
    setSelectedFile(file);
    setError(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleFileChange(file);
    }
  }

  async function handleGenerate() {
    const file = selectedFile ?? fileRef.current?.files?.[0];
    if (!file) { setError("Primero seleccioná una imagen."); return; }
    setError(null);
    setStatus("generating");
    const fd = new FormData();
    fd.append("imagen", file);
    fd.append("doc_type", docType);
    const result = await generateTemplate(fd);
    if (result.error || !result.html || !result.previewHtml) {
      setError(result.error ?? "No se pudo preparar la vista previa segura.");
      setStatus("idle");
      return;
    }
    const html = result.html;
    setRawHtml(html);
    setPreviewHtml(result.previewHtml);
    setStatus("generated");
  }

  async function handleSave() {
    if (!rawHtml) return;
    setStatus("saving");
    setError(null);
    const result = await saveTemplate(empresaId, docType, rawHtml);
    if (result.error) { setError(result.error); setStatus("generated"); return; }
    setSaved(true);
    setStatus("saved");
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar la plantilla de ${label}?`)) return;
    setDeleting(true);
    await deleteTemplate(empresaId, docType);
    setSaved(false);
    setRawHtml(null);
    setPreviewHtml(null);
    setSelectedFile(null);
    setStatus("idle");
    setDeleting(false);
  }

  const busy = status === "generating" || status === "saving";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold">{label}</h3>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            {saved
              ? "✓ Plantilla guardada — se usa al imprimir"
              : "Sin plantilla — se usa el diseño por defecto"}
          </p>
        </div>
        {saved && status !== "generated" ? (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]"
          >
            {deleting ? "Eliminando…" : "Eliminar plantilla"}
          </button>
        ) : null}
      </div>

      {/* Upload zone */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
      />

      <div
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={[
          "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
          busy ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          dragging
            ? "border-[var(--primary)] bg-[var(--primary-bg)]"
            : selectedFile
              ? "border-[var(--primary)]/40 bg-[var(--primary-bg)]/40"
              : "border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--hover)]",
        ].join(" ")}
      >
        {selectedFile ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={URL.createObjectURL(selectedFile)}
              alt="Vista previa"
              className="max-h-28 max-w-full rounded object-contain"
            />
            <div className="text-[12px] text-[var(--muted)]">{selectedFile.name}</div>
            <div className="text-[11px] text-[var(--primary)]">Clic para cambiar imagen</div>
          </>
        ) : (
          <>
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-[var(--muted)]"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <div className="text-[13px] font-medium">
              Clic para subir una foto del formato
            </div>
            <div className="text-[12px] text-[var(--muted)]">
              o arrastrá la imagen acá · JPG, PNG, WEBP
            </div>
          </>
        )}
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      {/* Generate button (only shown when file is selected and not yet generating) */}
      {selectedFile && status !== "generated" && status !== "saved" ? (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
          >
            {status === "generating" ? "Analizando imagen…" : "Generar plantilla con IA"}
          </Button>
        </div>
      ) : null}

      {previewHtml ? (
        <div className="space-y-2">
          <div className="text-[12px] text-[var(--muted)]">
            Vista previa (con datos de ejemplo):
          </div>
          <iframe
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>body{margin:0;background:white;color:black;font-family:sans-serif;font-size:13px;}</style></head><body>${previewHtml}</body></html>`}
            className="w-full rounded border border-[var(--border)] bg-white"
            style={{ height: "600px" }}
            title={`Preview ${label}`}
            sandbox=""
            referrerPolicy="no-referrer"
          />
          <div className="flex gap-2 justify-end">
            {status !== "saved" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setPreviewHtml(null); setRawHtml(null); setStatus("idle"); }}
                  disabled={status === "saving"}
                >
                  Regenerar
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={status === "saving"}
                >
                  {status === "saving" ? "Guardando…" : "Guardar plantilla"}
                </Button>
              </>
            ) : (
              <span className="text-[13px] text-[var(--ok)] font-medium">✓ Guardada</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
