"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FlipHorizontal, RefreshCw, Zap, ZapOff, Upload } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (imageDataUrl: string, width: number, height: number) => void;
  pageCount: number;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, pageCount, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasCamera, setHasCamera] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  async function startCamera() {
    setIsInitializing(true);
    setCameraError(null);

    // Detener stream previo si existiera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHasCamera(false);
        setCameraError("Tu navegador no soporta acceso directo a cámara. Podés subir una foto.");
        setIsInitializing(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Comprobar soporte de linterna / flash
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchSupported(Boolean(capabilities?.torch));
    } catch (err: unknown) {
      console.warn("Camera access error:", err);
      setHasCamera(false);
      const name = (err as { name?: string }).name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCameraError("Permiso de cámara denegado. Podés seleccionar o tomar una foto con tu dispositivo.");
      } else {
        setCameraError("No se pudo iniciar la cámara trasera. Podés seleccionar o tomar una foto.");
      }
    } finally {
      setIsInitializing(false);
    }
  }

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function toggleTorch() {
    if (!streamRef.current || !torchSupported) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      const nextState = !torchOn;
      await (track.applyConstraints as unknown as (c: { advanced: Array<{ torch: boolean }> }) => Promise<void>)({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch (e) {
      console.warn("Torch error:", e);
    }
  }

  function handleCapture() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    if (navigator.vibrate) {
      navigator.vibrate(40);
    }

    onCapture(dataUrl, w, h);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        onCapture(dataUrl, img.width, img.height);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-black overflow-hidden select-none">
      {/* Viewport de video */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${!hasCamera ? "hidden" : ""}`}
        />

        {/* Guía visual de encuadre de documento */}
        {hasCamera && (
          <div className="absolute inset-8 pointer-events-none border border-emerald-500/40 rounded-xl flex flex-col justify-between p-4 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
            <div className="flex justify-between">
              <div className="w-6 h-6 border-t-2 border-l-2 border-emerald-400" />
              <div className="w-6 h-6 border-t-2 border-r-2 border-emerald-400" />
            </div>
            <p className="text-center text-xs font-medium text-emerald-300/80 bg-black/40 py-1 px-3 rounded-full self-center backdrop-blur-sm">
              Alineá el documento dentro del marco
            </p>
            <div className="flex justify-between">
              <div className="w-6 h-6 border-b-2 border-l-2 border-emerald-400" />
              <div className="w-6 h-6 border-b-2 border-r-2 border-emerald-400" />
            </div>
          </div>
        )}

        {/* Fallback de cámara denegada o no disponible */}
        {!hasCamera && (
          <div className="p-6 text-center max-w-sm space-y-4">
            <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-amber-400">
              <Camera className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-100">Captura de Documento</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{cameraError}</p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 active:scale-95 transition"
              >
                <Upload className="w-4 h-4" /> Tomar o subir foto
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {/* Barra superior de controles */}
      <div className="absolute top-0 inset-x-0 p-4 pt-6 flex justify-between items-center bg-gradient-to-b from-black/80 via-black/40 to-transparent z-10">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md text-xs font-medium text-slate-300 hover:text-white border border-slate-700/50"
        >
          Cerrar
        </button>

        {torchSupported && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`p-2.5 rounded-full backdrop-blur-md border transition ${
              torchOn
                ? "bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/20"
                : "bg-slate-900/80 text-slate-300 border-slate-700/50"
            }`}
          >
            {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Barra inferior de captura */}
      <div className="p-6 pb-10 bg-gradient-to-t from-black via-black/90 to-transparent flex items-center justify-around z-10">
        {/* Selector de foto alternativa */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-3 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white active:scale-95 transition"
          title="Subir desde galería"
        >
          <Upload className="w-5 h-5" />
        </button>

        {/* Botón principal de obturación */}
        {hasCamera && (
          <button
            type="button"
            onClick={handleCapture}
            disabled={isInitializing}
            className="w-18 h-18 rounded-full border-4 border-white p-1 flex items-center justify-center bg-transparent active:scale-90 transition shadow-2xl"
          >
            <div className="w-full h-full rounded-full bg-white hover:bg-slate-200 transition" />
          </button>
        )}

        {/* Indicador de páginas */}
        <div className="text-center min-w-12">
          <div className="text-xs font-bold text-slate-200 bg-slate-800/90 border border-slate-700 py-1.5 px-3 rounded-full">
            {pageCount} {pageCount === 1 ? "pág" : "págs"}
          </div>
        </div>
      </div>
    </div>
  );
}
