"use client";

import { useState } from "react";
import { Camera, FileText, Plus, Trash2, X } from "lucide-react";
import { CameraCapture } from "@/app/scanner/components/camera-capture";
import { QuadEditor } from "@/app/scanner/components/quad-editor";
import { FilterSelector } from "@/app/scanner/components/filter-selector";
import { buildPdfFromJpegPages, dataUrlToUint8Array } from "@/lib/scanner/pdf-builder";
import type { QuadPoints } from "@/lib/scanner/types";

type Capture = { dataUrl: string; width: number; height: number; detectedQuad?: QuadPoints };
type Page = { dataUrl: string; width: number; height: number };
type Stage = "camera" | "crop" | "filter" | "pages";

const MAX_PAGES = 20;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function WarehouseDocumentScanner({
  onAttach,
  onClose,
}: {
  onAttach: (file: File) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("camera");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [cropped, setCropped] = useState<Capture | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);

  function savePdf() {
    if (pages.length === 0) return;
    try {
      const bytes = buildPdfFromJpegPages(
        pages.map((page) => ({
          jpegBytes: dataUrlToUint8Array(page.dataUrl),
          width: page.width,
          height: page.height,
        }))
      );
      if (bytes.byteLength > MAX_PDF_BYTES) {
        setError("El PDF supera 20 MB. Quitá páginas y volvé a intentar.");
        return;
      }
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const file = new File(
        [copy.buffer],
        `escaneo-deposito-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`,
        { type: "application/pdf" }
      );
      onAttach(file);
      onClose();
    } catch {
      setError("No se pudo generar el PDF. Volvé a intentar.");
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Escanear documento" className="fixed inset-0 z-[100] bg-slate-950 text-white">
      {stage === "camera" && (
        <CameraCapture
          pageCount={pages.length}
          onCancel={() => pages.length ? setStage("pages") : onClose()}
          onCapture={(dataUrl, width, height, detectedQuad) => {
            setCapture({ dataUrl, width, height, detectedQuad });
            setError(null);
            setStage("crop");
          }}
        />
      )}
      {stage === "crop" && capture && (
        <QuadEditor
          imageDataUrl={capture.dataUrl}
          initialQuad={capture.detectedQuad}
          onCancel={() => setStage("camera")}
          onConfirmCrop={(dataUrl, width, height) => {
            setCropped({ dataUrl, width, height });
            setStage("filter");
          }}
        />
      )}
      {stage === "filter" && cropped && (
        <FilterSelector
          croppedDataUrl={cropped.dataUrl}
          onBack={() => setStage("crop")}
          onConfirmFilter={(dataUrl) => {
            setPages((current) => [...current, { dataUrl, width: cropped.width, height: cropped.height }]);
            setCapture(null);
            setCropped(null);
            setStage("pages");
          }}
        />
      )}
      {stage === "pages" && (
        <div className="flex h-[100dvh] flex-col">
          <header className="flex items-center justify-between border-b border-slate-700 px-4 py-4">
            <span className="flex items-center gap-2 font-semibold"><FileText size={18} /> Documento escaneado</span>
            <button type="button" onClick={onClose} aria-label="Cerrar escáner" className="rounded-lg p-2"><X size={20} /></button>
          </header>
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-4 text-sm text-slate-300">{pages.length} {pages.length === 1 ? "página" : "páginas"} listas para adjuntar</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {pages.map((page, index) => (
                <div key={index} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
                  <img src={page.dataUrl} alt={`Página ${index + 1}`} className="h-44 w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => setPages((current) => current.filter((_, i) => i !== index))}
                    className="flex w-full items-center justify-center gap-1 border-t border-slate-700 p-2 text-xs text-red-300"
                  >
                    <Trash2 size={14} /> Quitar página {index + 1}
                  </button>
                </div>
              ))}
            </div>
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
          </div>
          <footer className="grid gap-2 border-t border-slate-700 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button type="button" disabled={pages.length >= MAX_PAGES} onClick={() => setStage("camera")} className="flex items-center justify-center gap-2 rounded-xl border border-slate-500 p-3 text-sm font-semibold disabled:opacity-50"><Plus size={17} /> Agregar página</button>
            <button type="button" disabled={pages.length === 0} onClick={savePdf} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 p-3 text-sm font-semibold disabled:opacity-50"><Camera size={17} /> Adjuntar PDF al formulario</button>
          </footer>
        </div>
      )}
    </div>
  );
}
