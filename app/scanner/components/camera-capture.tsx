"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera,
  RefreshCw,
  Zap,
  ZapOff,
  Upload,
  X,
  Sparkles,
  Search,
  ScanLine,
  CheckCircle2,
} from "lucide-react";
import { Point2D, QuadPoints } from "@/lib/scanner/types";
import { detectDocumentQuad } from "@/lib/scanner/document-detector";
import {
  calculateObjectCoverFit,
  mapVideoQuadToViewport,
  scaleQuad,
} from "@/lib/scanner/coordinate-mapping";
import {
  DocumentStabilityTracker,
  StabilityState,
} from "@/lib/scanner/stability-tracker";
import {
  checkCameraEnvironment,
  getCameraConstraintsForAttempt,
  parseCameraError,
  isVideoElementReady,
} from "@/lib/scanner/camera-helpers";

interface CameraCaptureProps {
  onCapture: (
    imageDataUrl: string,
    width: number,
    height: number,
    detectedQuad?: QuadPoints
  ) => void;
  pageCount: number;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, pageCount, onCancel }: CameraCaptureProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Módulos internos y refs de control de ejecución
  const stabilityTrackerRef = useRef<DocumentStabilityTracker>(
    new DocumentStabilityTracker({
      requiredDurationMs: 750,
      minStableFrames: 4,
      minConfidence: 0.40,
    })
  );
  const isAnalyzingRef = useRef(false);
  const captureLockedRef = useRef(false);
  const lastFullVideoQuadRef = useRef<QuadPoints | null>(null);
  const loopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const cameraSessionRef = useRef(0);

  // Estados de cámara y hardware
  const [hasCamera, setHasCamera] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);

  // Modos de escaneo y feedback
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [showFlash, setShowFlash] = useState(false);
  const [stabilityState, setStabilityState] = useState<StabilityState>({
    status: "searching",
    isStable: false,
    isReadyForAutoCapture: false,
    stabilityProgress: 0,
    confidence: 0,
    consecutiveFrames: 0,
    stableDurationMs: 0,
    averageDrift: 0,
    lastQuad: null,
    smoothedQuad: null,
  });

  // -------------------------------------------------------------
  // 1. GESTIÓN DE ACCESO A CÁMARA CON FALLBACKS PROGRESIVOS
  // -------------------------------------------------------------
  const startCamera = useCallback(async () => {
    const sessionId = ++cameraSessionRef.current;
    setIsVideoReady(false);
    setCameraError(null);
    setIsPermissionDenied(false);
    captureLockedRef.current = false;
    stabilityTrackerRef.current.reset();

    // Detener tracks anteriores si existían y resetear source
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Verificar HTTPS / MediaDevices
    const envCheck = checkCameraEnvironment();
    if (!envCheck.isSupported) {
      if (isMountedRef.current && sessionId === cameraSessionRef.current) {
        setHasCamera(false);
        setCameraError(envCheck.reason || "Cámara no soportada.");
      }
      return;
    }

    let activeStream: MediaStream | null = null;
    let lastErr: unknown = null;

    // Intentar progresivamente: intento 0 (ideal 1080p rear), intento 1 (facing rear simple), intento 2 (genérico)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const constraints = getCameraConstraintsForAttempt(attempt);
        activeStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (activeStream) break;
      } catch (err: unknown) {
        lastErr = err;
        const errInfo = parseCameraError(err);
        // Si el usuario bloqueó explícitamente el permiso, no reintentar
        if (errInfo.isPermissionDenied) {
          break;
        }
      }
    }

    // Si el componente se desmontó durante el await, liberar tracks de inmediato
    if (!isMountedRef.current || sessionId !== cameraSessionRef.current) {
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
      return;
    }

    if (!activeStream) {
      setHasCamera(false);
      const parsed = parseCameraError(lastErr);
      setCameraError(parsed.message);
      setIsPermissionDenied(parsed.isPermissionDenied);
      return;
    }

    streamRef.current = activeStream;
    setHasCamera(true);

    if (videoRef.current) {
      videoRef.current.srcObject = activeStream;
      try {
        await videoRef.current.play();
      } catch (playErr) {
        console.warn("Video play error:", playErr);
      }
    }

    // Comprobar soporte de linterna
    try {
      const track = activeStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchSupported(Boolean(capabilities?.torch));
    } catch {
      setTorchSupported(false);
    }
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    startCamera();
    return () => {
      isMountedRef.current = false;
      cameraSessionRef.current++;
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [startCamera]);

  // Listener para confirmar video listo con dimensiones reales
  function handleVideoPlaying() {
    if (isVideoElementReady(videoRef.current)) {
      setIsVideoReady(true);
    }
  }

  // Linterna / Flash
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
      console.warn("Torch toggle error:", e);
    }
  }

  // -------------------------------------------------------------
  // 2. CAPTURA A RESOLUCIÓN COMPLETA (Manual y Automática)
  // -------------------------------------------------------------
  const executeCapture = useCallback(() => {
    if (captureLockedRef.current || !videoRef.current) return;
    const video = videoRef.current;
    if (!isVideoElementReady(video)) return;

    // Bloquear inmediatamente para evitar dobles capturas
    captureLockedRef.current = true;
    stabilityTrackerRef.current.lockCapture();

    // Haptic feedback en dispositivos compatibles
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(40);
    }

    // Flash visual blanco de 80ms
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 80);

    // Capturar el frame REAL del sensor del video (sin downscale)
    const realW = video.videoWidth;
    const realH = video.videoHeight;
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = realW;
    captureCanvas.height = realH;
    const ctx = captureCanvas.getContext("2d");

    if (ctx) {
      ctx.drawImage(video, 0, 0, realW, realH);
      const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.92);

      // Pasar el mejor cuadrilátero detectado en coordenadas reales como initialQuad
      const detectedQuadToPass =
        stabilityState.smoothedQuad ??
        stabilityState.lastQuad ??
        lastFullVideoQuadRef.current ??
        undefined;
      onCapture(dataUrl, realW, realH, detectedQuadToPass);
    }
  }, [onCapture, stabilityState]);

  // -------------------------------------------------------------
  // 3. PIPELINE DE DETECCIÓN CONTINUA (Low-Res Analysis ~5-8 Hz)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!isVideoReady || !hasCamera) return;

    // Canvas de análisis reutilizable fuera de pantalla
    const analysisCanvas = document.createElement("canvas");
    const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
    const targetMaxDim = 360; // 360px permite detección de documentos <15ms

    // Bucle periódico a 160ms (~6 Hz) para equilibrar fluidez y bajo consumo de batería
    loopTimerRef.current = setInterval(() => {
      if (isAnalyzingRef.current || captureLockedRef.current || !videoRef.current || !analysisCtx) {
        return;
      }

      const video = videoRef.current;
      if (!isVideoElementReady(video)) return;

      isAnalyzingRef.current = true;

      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // Calcular escala de reducción para el análisis rápido
        const scale = Math.min(targetMaxDim / vw, targetMaxDim / vh, 1);
        const downW = Math.round(vw * scale);
        const downH = Math.round(vh * scale);

        if (analysisCanvas.width !== downW || analysisCanvas.height !== downH) {
          analysisCanvas.width = downW;
          analysisCanvas.height = downH;
        }

        // Dibujar en hardware canvas reducido
        analysisCtx.drawImage(video, 0, 0, downW, downH);
        const imgData = analysisCtx.getImageData(0, 0, downW, downH);

        // Ejecutar algoritmo de visión por computadora
        const result = detectDocumentQuad(imgData);

        let fullVideoQuad: QuadPoints | null = null;
        if (!result.isFallback && result.confidence >= 0.35) {
          // Escalar cuadrilátero de regreso a la resolución completa del video
          const scaleX = vw / downW;
          const scaleY = vh / downH;
          fullVideoQuad = scaleQuad(result.quad, scaleX, scaleY);
          lastFullVideoQuadRef.current = fullVideoQuad;
        } else {
          lastFullVideoQuadRef.current = null;
        }

        // Actualizar rastreador de estabilidad temporal
        const nextStability = stabilityTrackerRef.current.update(
          fullVideoQuad,
          result.isFallback,
          result.confidence,
          vw,
          vh,
          Date.now()
        );

        setStabilityState(nextStability);

        // Auto-capturar si se cumplen todas las condiciones de estabilidad
        if (autoCaptureEnabled && nextStability.isReadyForAutoCapture && !captureLockedRef.current) {
          executeCapture();
        }
      } catch (detectErr) {
        console.warn("Live detection cycle error:", detectErr);
      } finally {
        isAnalyzingRef.current = false;
      }
    }, 160);

    return () => {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
    };
  }, [isVideoReady, hasCamera, autoCaptureEnabled, executeCapture]);

  // -------------------------------------------------------------
  // 4. OVERLAY DINÁMICO DE BORDES EN VIVO (<canvas> sobre <video>)
  // -------------------------------------------------------------
  useEffect(() => {
    function drawOverlay() {
      const canvas = overlayCanvasRef.current;
      const container = containerRef.current;
      const video = videoRef.current;
      if (!canvas || !container || !video) return;

      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, cw, ch);

      // Si aún no hay frame de video real o no hay cámara, no dibujar nada
      if (!isVideoElementReady(video)) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const fit = calculateObjectCoverFit(vw, vh, cw, ch);

      const quadToDraw = stabilityState.smoothedQuad || stabilityState.lastQuad;

      if (quadToDraw && stabilityState.status !== "searching") {
        // Mapear de espacio de video a coordenadas de pantalla (object-cover)
        const vQuad = mapVideoQuadToViewport(quadToDraw, fit);
        const isStable = stabilityState.status === "stable";

        const strokeColor = isStable ? "rgb(16, 185, 129)" : "rgb(234, 179, 8)";
        const fillColor = isStable ? "rgba(16, 185, 129, 0.22)" : "rgba(234, 179, 8, 0.12)";
        const pointColor = isStable ? "#34d399" : "#facc15";

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(vQuad.topLeft.x, vQuad.topLeft.y);
        ctx.lineTo(vQuad.topRight.x, vQuad.topRight.y);
        ctx.lineTo(vQuad.bottomRight.x, vQuad.bottomRight.y);
        ctx.lineTo(vQuad.bottomLeft.x, vQuad.bottomLeft.y);
        ctx.closePath();

        // Relleno semi-transparente del documento detectado
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Líneas de contorno con resplandor
        ctx.lineWidth = isStable ? 3.5 : 2.5;
        ctx.strokeStyle = strokeColor;
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = isStable ? 12 : 6;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        // Vértices/Esquinas destacadas
        const corners = [vQuad.topLeft, vQuad.topRight, vQuad.bottomRight, vQuad.bottomLeft];
        for (const pt of corners) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, isStable ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = pointColor;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }

        ctx.restore();
      }

      animationFrameRef.current = requestAnimationFrame(drawOverlay);
    }

    animationFrameRef.current = requestAnimationFrame(drawOverlay);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [stabilityState]);

  // -------------------------------------------------------------
  // 5. SELECCIÓN DE FOTO ALTERNATIVA (Fallback Galería)
  // -------------------------------------------------------------
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
    // Resetear valor para permitir seleccionar la misma imagen repetidamente
    e.target.value = "";
  }

  // -------------------------------------------------------------
  // 6. RENDERIZADO VISUAL
  // -------------------------------------------------------------
  return (
    <div
      className="relative flex flex-col h-full w-full bg-black overflow-hidden select-none"
      style={{ height: "100dvh", minHeight: "100dvh" }}
    >
      {/* Flash overlay para feedback de captura */}
      {showFlash && (
        <div className="absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-75" />
      )}

      {/* Viewport de video y canvas de overlay interactivo */}
      <div
        ref={containerRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden"
      >
        {hasCamera && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              onLoadedMetadata={handleVideoPlaying}
              onLoadedData={handleVideoPlaying}
              onCanPlay={handleVideoPlaying}
              onPlaying={handleVideoPlaying}
              onTimeUpdate={handleVideoPlaying}
              onResize={handleVideoPlaying}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                isVideoReady ? "opacity-100" : "opacity-0"
              }`}
            />
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
            />
          </>
        )}

        {/* Indicador de carga inicial de cámara */}
        {hasCamera && !isVideoReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 bg-black/90 z-20">
            <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-sm font-medium text-slate-200">Iniciando cámara…</p>
          </div>
        )}

        {/* Guía visual sutil cuando el detector está buscando */}
        {hasCamera && isVideoReady && stabilityState.status === "searching" && (
          <div className="absolute inset-x-8 inset-y-16 pointer-events-none border border-dashed border-white/25 rounded-2xl flex items-center justify-center transition-opacity duration-300">
            <p className="text-center text-xs font-medium text-white/60 bg-black/40 py-1.5 px-3 rounded-full backdrop-blur-md">
              Apuntá al documento
            </p>
          </div>
        )}

        {/* Fallback ante cámara bloqueada o error */}
        {!hasCamera && (
          <div className="p-6 text-center max-w-sm space-y-4 z-20">
            <div className="w-16 h-16 rounded-full bg-slate-900 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 shadow-xl shadow-amber-500/10">
              <Camera className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-100">Acceso a Cámara</h3>
            <p className="text-xs text-slate-300 leading-relaxed">{cameraError}</p>

            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={startCamera}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs flex items-center justify-center gap-2 border border-slate-700 active:scale-95 transition"
              >
                <RefreshCw className="w-4 h-4 text-emerald-400" /> Reintentar cámara
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 active:scale-95 transition"
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
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {/* Barra superior de controles */}
      <div
        className="absolute top-0 inset-x-0 p-4 flex justify-between items-center bg-gradient-to-b from-black/85 via-black/40 to-transparent z-20"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md text-xs font-medium text-slate-300 hover:text-white border border-slate-700/50 flex items-center gap-1.5 active:scale-95 transition"
        >
          <X className="w-3.5 h-3.5" /> Cerrar
        </button>

        {/* Píldora central informativa de estado de detección */}
        {hasCamera && isVideoReady && (
          <div className="flex items-center">
            {stabilityState.status === "stable" ? (
              <div className="flex items-center gap-1.5 py-1 px-3 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 text-xs font-semibold backdrop-blur-md shadow-lg shadow-emerald-950/50 animate-pulse">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{autoCaptureEnabled ? "¡Listo! Capturando…" : "Listo para capturar"}</span>
              </div>
            ) : stabilityState.status === "detected" ? (
              <div className="flex items-center gap-1.5 py-1 px-3 rounded-full bg-amber-950/90 border border-amber-500/50 text-amber-300 text-xs font-medium backdrop-blur-md">
                <ScanLine className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span>Mantené quieto el teléfono…</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 py-1 px-3 rounded-full bg-slate-900/80 border border-slate-800 text-slate-400 text-xs font-medium backdrop-blur-md">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <span>Buscando documento…</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Toggle de Auto-Capture */}
          {hasCamera && isVideoReady && (
            <button
              type="button"
              onClick={() => setAutoCaptureEnabled((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-full backdrop-blur-md text-xs font-medium border transition flex items-center gap-1 ${
                autoCaptureEnabled
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-slate-900/80 text-slate-400 border-slate-700/50"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>{autoCaptureEnabled ? "Auto: ON" : "Auto: OFF"}</span>
            </button>
          )}

          {/* Botón Linterna */}
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-2 rounded-full backdrop-blur-md border transition ${
                torchOn
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/20"
                  : "bg-slate-900/80 text-slate-300 border-slate-700/50"
              }`}
            >
              {torchOn ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Barra inferior con Shutter y accesos rápidos */}
      <div
        className="p-6 bg-gradient-to-t from-black via-black/90 to-transparent flex items-center justify-around z-20 shrink-0"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Selector de galería / subida alternativa */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-3 rounded-full bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-white active:scale-95 transition"
          title="Subir desde galería"
        >
          <Upload className="w-5 h-5" />
        </button>

        {/* Botón principal de obturación con aro de progreso de estabilidad */}
        {hasCamera && (
          <div className="relative flex items-center justify-center">
            {/* Anillo de progreso de auto-captura */}
            {autoCaptureEnabled && stabilityState.status !== "searching" && (
              <svg className="absolute w-[88px] h-[88px] -rotate-90 pointer-events-none">
                <circle
                  cx="44"
                  cy="44"
                  r="38"
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="4"
                  fill="none"
                />
                <circle
                  cx="44"
                  cy="44"
                  r="38"
                  stroke={stabilityState.status === "stable" ? "#10b981" : "#eab308"}
                  strokeWidth="4"
                  strokeDasharray={238.76}
                  strokeDashoffset={238.76 * (1 - stabilityState.stabilityProgress)}
                  strokeLinecap="round"
                  fill="none"
                  className="transition-all duration-150"
                />
              </svg>
            )}

            <button
              type="button"
              onClick={executeCapture}
              disabled={!isVideoReady}
              aria-label="Capturar documento"
              className={`w-[72px] h-[72px] rounded-full border-4 p-1 flex items-center justify-center transition shadow-2xl ${
                isVideoReady
                  ? "border-white bg-transparent active:scale-90"
                  : "border-slate-700 opacity-50 cursor-not-allowed"
              }`}
            >
              <div
                className={`w-full h-full rounded-full transition ${
                  stabilityState.status === "stable"
                    ? "bg-emerald-400"
                    : isVideoReady
                    ? "bg-white hover:bg-slate-200"
                    : "bg-slate-700"
                }`}
              />
            </button>
          </div>
        )}

        {/* Indicador de páginas acumuladas */}
        <div className="text-center min-w-12">
          <div className="text-xs font-bold text-slate-200 bg-slate-900/90 border border-slate-700 py-1.5 px-3 rounded-full">
            {pageCount} {pageCount === 1 ? "pág" : "págs"}
          </div>
        </div>
      </div>
    </div>
  );
}
