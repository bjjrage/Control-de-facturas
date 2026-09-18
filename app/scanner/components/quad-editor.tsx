"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { Point2D, QuadPoints } from "@/lib/scanner/types";
import { detectDefaultCorners, warpPerspective } from "@/lib/scanner/image-processing";

interface QuadEditorProps {
  imageDataUrl: string;
  onConfirmCrop: (croppedDataUrl: string, width: number, height: number, quad: QuadPoints) => void;
  onCancel: () => void;
}

type CornerKey = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

export function QuadEditor({ imageDataUrl, onConfirmCrop, onCancel }: QuadEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageObjRef = useRef<HTMLImageElement | null>(null);

  const [quad, setQuad] = useState<QuadPoints | null>(null);
  const [activeCorner, setActiveCorner] = useState<CornerKey | null>(null);
  const [dragPos, setDragPos] = useState<Point2D | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [displayScale, setDisplayScale] = useState<number>(1);
  const [processing, setProcessing] = useState(false);

  // Cargar imagen y detectar esquinas iniciales
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageObjRef.current = img;
      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      const initialQuad = detectDefaultCorners(img.naturalWidth, img.naturalHeight);
      setQuad(initialQuad);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  // Dibujar imagen y overlay de cuadrilátero
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imageObjRef.current;
    if (!canvas || !container || !img || !quad || imgDims.w === 0) return;

    const rect = container.getBoundingClientRect();
    const maxW = rect.width;
    const maxH = rect.height;

    // Calcular escala para encajar la imagen completa en pantalla
    const scale = Math.min(maxW / imgDims.w, maxH / imgDims.h, 1);
    setDisplayScale(scale);

    const canvasW = Math.round(imgDims.w * scale);
    const canvasH = Math.round(imgDims.h * scale);
    canvas.width = canvasW;
    canvas.height = canvasH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Dibujar imagen escalada
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(img, 0, 0, canvasW, canvasH);

    // Coordenadas en canvas
    const pTL = { x: quad.topLeft.x * scale, y: quad.topLeft.y * scale };
    const pTR = { x: quad.topRight.x * scale, y: quad.topRight.y * scale };
    const pBR = { x: quad.bottomRight.x * scale, y: quad.bottomRight.y * scale };
    const pBL = { x: quad.bottomLeft.x * scale, y: quad.bottomLeft.y * scale };

    // Sombra oscura fuera del documento
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, canvasW, canvasH);
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.closePath();
    ctx.fill("evenodd");

    // Líneas conectoras del polígono
    ctx.strokeStyle = "#10b981"; // Emerald
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.stroke();

    // Dibujar las 4 manijas / esquinas
    const corners: Array<{ key: CornerKey; pt: Point2D }> = [
      { key: "topLeft", pt: pTL },
      { key: "topRight", pt: pTR },
      { key: "bottomRight", pt: pBR },
      { key: "bottomLeft", pt: pBL },
    ];

    corners.forEach(({ key, pt }) => {
      const isActive = activeCorner === key;
      ctx.fillStyle = isActive ? "#34d399" : "#ffffff";
      ctx.strokeStyle = "#059669";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isActive ? 14 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Punto central
      ctx.fillStyle = "#059669";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [quad, imgDims, activeCorner]);

  // Manejo de eventos pointer/touch para mover las esquinas
  function getCanvasCoords(clientX: number, clientY: number): Point2D | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    return { x: cx, y: cy };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!quad || displayScale === 0) return;
    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;

    // Buscar si tocó cerca de alguna esquina (radio de tolerancia ~36px para dedos)
    const touchRadius = 36;
    const entries: Array<[CornerKey, Point2D]> = [
      ["topLeft", { x: quad.topLeft.x * displayScale, y: quad.topLeft.y * displayScale }],
      ["topRight", { x: quad.topRight.x * displayScale, y: quad.topRight.y * displayScale }],
      ["bottomRight", { x: quad.bottomRight.x * displayScale, y: quad.bottomRight.y * displayScale }],
      ["bottomLeft", { x: quad.bottomLeft.x * displayScale, y: quad.bottomLeft.y * displayScale }],
    ];

    let foundKey: CornerKey | null = null;
    let minDistance = touchRadius;

    for (const [key, pt] of entries) {
      const dist = Math.hypot(coords.x - pt.x, coords.y - pt.y);
      if (dist < minDistance) {
        minDistance = dist;
        foundKey = key;
      }
    }

    if (foundKey) {
      setActiveCorner(foundKey);
      setDragPos(coords);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!activeCorner || !quad || displayScale === 0) return;
    const coords = getCanvasCoords(e.clientX, e.clientY);
    if (!coords) return;

    setDragPos(coords);

    // Mapear de coordenadas canvas a coordenadas originales de imagen
    const origX = Math.max(0, Math.min(imgDims.w, Math.round(coords.x / displayScale)));
    const origY = Math.max(0, Math.min(imgDims.h, Math.round(coords.y / displayScale)));

    setQuad((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        [activeCorner]: { x: origX, y: origY },
      };
    });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (activeCorner) {
      setActiveCorner(null);
      setDragPos(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Silently ignore
      }
    }
  }

  async function handleApplyWarp() {
    if (!quad || !imageObjRef.current) return;
    setProcessing(true);

    try {
      // 1. Renderizar imagen original en un canvas fuera de pantalla para extraer ImageData
      const offCanvas = document.createElement("canvas");
      offCanvas.width = imgDims.w;
      offCanvas.height = imgDims.h;
      const offCtx = offCanvas.getContext("2d", { willReadFrequently: true });
      if (!offCtx) throw new Error("No se pudo crear contexto 2D");

      offCtx.drawImage(imageObjRef.current, 0, 0);
      const srcImageData = offCtx.getImageData(0, 0, imgDims.w, imgDims.h);

      // 2. Aplicar warp proyectivo
      const warpedImageData = warpPerspective(srcImageData, quad);

      // 3. Pintar en canvas destino y exportar DataURL
      const dstCanvas = document.createElement("canvas");
      dstCanvas.width = warpedImageData.width;
      dstCanvas.height = warpedImageData.height;
      const dstCtx = dstCanvas.getContext("2d");
      if (!dstCtx) throw new Error("No se pudo crear contexto destino");

      dstCtx.putImageData(warpedImageData, 0, 0);
      const croppedUrl = dstCanvas.toDataURL("image/jpeg", 0.92);

      onConfirmCrop(croppedUrl, warpedImageData.width, warpedImageData.height, quad);
    } catch (err) {
      console.error("Error al transformar perspectiva:", err);
      alert("No se pudo ajustar la perspectiva. Verificá que las esquinas formen un cuadrilátero válido.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-slate-950 select-none touch-none">
      {/* Barra superior */}
      <div className="p-4 flex items-center justify-between bg-slate-900/90 border-b border-slate-800 z-10">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-white px-2 py-1"
        >
          Volver a capturar
        </button>
        <span className="text-xs font-semibold text-slate-200">Ajustar bordes del papel</span>
        <button
          type="button"
          onClick={() => setQuad(detectDefaultCorners(imgDims.w, imgDims.h))}
          className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 px-2 py-1"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Restablecer
        </button>
      </div>

      {/* Área interactiva del Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 flex items-center justify-center p-3 overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="touch-none rounded-lg shadow-2xl cursor-crosshair max-w-full max-h-full"
        />

        {/* Lupa / Magnifier flotante cuando el usuario está arrastrando una esquina */}
        {activeCorner && dragPos && (
          <div
            className="absolute pointer-events-none w-28 h-28 rounded-full border-2 border-emerald-400 bg-black/90 shadow-2xl overflow-hidden z-30"
            style={{
              left: Math.max(16, Math.min(window.innerWidth - 128, dragPos.x - 56)),
              top: Math.max(16, dragPos.y - 120),
            }}
          >
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Cruz central de mira */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="w-5 h-0.5 bg-emerald-400" />
                <div className="h-5 w-0.5 bg-emerald-400 absolute" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Barra de acción inferior */}
      <div className="p-4 pb-8 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between gap-3 z-10">
        <p className="text-[11px] text-slate-400">
          Arrastrá los puntos para alinear las 4 esquinas del documento.
        </p>

        <button
          type="button"
          onClick={handleApplyWarp}
          disabled={processing}
          className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-medium text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-900/30 transition shrink-0"
        >
          <Check className="w-4 h-4" />
          {processing ? "Ajustando…" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
