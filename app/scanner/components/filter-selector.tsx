"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Sliders, ArrowLeft } from "lucide-react";
import { ScanFilter } from "@/lib/scanner/types";
import { applyScanFilter } from "@/lib/scanner/image-processing";

interface FilterSelectorProps {
  croppedDataUrl: string;
  initialFilter?: ScanFilter;
  onConfirmFilter: (processedDataUrl: string, filter: ScanFilter) => void;
  onBack: () => void;
}

export function FilterSelector({
  croppedDataUrl,
  initialFilter = "document",
  onConfirmFilter,
  onBack,
}: FilterSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentFilter, setCurrentFilter] = useState<ScanFilter>(initialFilter);
  const [cachedOriginalImageData, setCachedOriginalImageData] = useState<ImageData | null>(null);
  const [processing, setProcessing] = useState(false);

  // Cargar imagen recortada y extraer ImageData original
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const offCanvas = document.createElement("canvas");
      offCanvas.width = img.naturalWidth;
      offCanvas.height = img.naturalHeight;
      const ctx = offCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
      setCachedOriginalImageData(imgData);
    };
    img.src = croppedDataUrl;
  }, [croppedDataUrl]);

  // Aplicar filtro cuando cambia la selección o se carga la imagen
  useEffect(() => {
    if (!cachedOriginalImageData || !canvasRef.current) return;
    setProcessing(true);

    try {
      const filtered = applyScanFilter(cachedOriginalImageData, currentFilter);
      const canvas = canvasRef.current;
      canvas.width = filtered.width;
      canvas.height = filtered.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.putImageData(filtered, 0, 0);
      }
    } finally {
      setProcessing(false);
    }
  }, [cachedOriginalImageData, currentFilter]);

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const finalDataUrl = canvas.toDataURL("image/jpeg", 0.90);
    onConfirmFilter(finalDataUrl, currentFilter);
  }

  return (
    <div
      className="relative flex flex-col h-full w-full bg-slate-950 select-none overflow-hidden"
      style={{ height: "100dvh", minHeight: "100dvh" }}
    >
      {/* Barra superior */}
      <div
        className="p-4 flex items-center justify-between bg-slate-900/90 border-b border-slate-800 z-10 shrink-0"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver a recortar
        </button>
        <span className="text-xs font-semibold text-slate-200">Mejora de imagen</span>
        <div className="w-16" />
      </div>

      {/* Preview de la página procesada */}
      <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden bg-slate-950">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full rounded-md shadow-2xl border border-slate-800 object-contain"
        />
        {processing && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center">
            <span className="text-xs text-slate-200 bg-slate-900/90 py-1.5 px-3 rounded-full border border-slate-700">
              Aplicando filtro…
            </span>
          </div>
        )}
      </div>

      {/* Selector de filtros */}
      <div
        className="p-4 bg-slate-900/95 border-t border-slate-800 space-y-3 z-10 shrink-0"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setCurrentFilter("original")}
            className={`py-2 px-2 rounded-xl text-xs font-medium border transition text-center ${
              currentFilter === "original"
                ? "bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm"
                : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            Original
          </button>
          <button
            type="button"
            onClick={() => setCurrentFilter("document")}
            className={`py-2 px-2 rounded-xl text-xs font-medium border transition text-center ${
              currentFilter === "document"
                ? "bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm"
                : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            Documento
          </button>
          <button
            type="button"
            onClick={() => setCurrentFilter("bw")}
            className={`py-2 px-2 rounded-xl text-xs font-medium border transition text-center ${
              currentFilter === "bw"
                ? "bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-sm"
                : "bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            B & N
          </button>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-medium text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/30 transition"
        >
          <Check className="w-4 h-4" /> Guardar página
        </button>
      </div>
    </div>
  );
}
