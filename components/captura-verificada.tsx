"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkCameraEnvironment, parseCameraError } from "@/lib/scanner/camera-helpers";

/**
 * Foto tomada con verificación. `blob` es el JPEG comprimido listo para subir;
 * el resto es la metadata que va a `execution_entry_photos`.
 */
export type VerifiedPhoto = {
  blob: Blob;
  previewUrl: string;
  capturedAt: string;              // ISO — reloj del dispositivo al disparar
  lat: number | null;
  lng: number | null;
  accuracy: number | null;         // metros
  source: "camara" | "archivo";
};

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;
const CAM_TIMEOUT_MS = 10000;

export type CamError = "denied" | "no-camara" | "sin-respuesta" | "captura";

export type CamOutcome =
  | { kind: "stream"; stream: MediaStream }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

export function raceCameraRequest(request: Promise<MediaStream>): Promise<CamOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: CamOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), CAM_TIMEOUT_MS);
    request.then(
      (stream) => { clearTimeout(timer); finish({ kind: "stream", stream }); },
      (error) => { clearTimeout(timer); finish({ kind: "error", error }); },
    );
  });
}

async function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("no se pudo generar la imagen"))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

function drawScaled(source: HTMLVideoElement | HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  let tw = w;
  let th = h;
  if (w > MAX_EDGE || h > MAX_EDGE) {
    if (w > h) { th = Math.round((h * MAX_EDGE) / w); tw = MAX_EDGE; }
    else { tw = Math.round((w * MAX_EDGE) / h); th = MAX_EDGE; }
  }
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas no soportado");
  ctx.drawImage(source, 0, 0, tw, th);
  return canvas;
}

async function compressFile(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        resolve(await blobFromCanvas(drawScaled(img, img.width, img.height)));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("no se pudo leer la imagen")); };
    img.src = url;
  });
}

function getPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

export function CapturaVerificada({
  maxPhotos = 5,
  onChange,
}: {
  maxPhotos?: number;
  onChange: (photos: VerifiedPhoto[]) => void;
}) {
  const [photos, setPhotos] = useState<VerifiedPhoto[]>([]);
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState<CamError | null>(null);
  const [camMessage, setCamMessage] = useState<string | null>(null);
  const [camPending, setCamPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gpsState, setGpsState] = useState<"idle" | "ok" | "denied">("idle");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const full = photos.length >= maxPhotos;

  const emit = useCallback(
    (next: VerifiedPhoto[]) => {
      setPhotos(next);
      onChange(next);
    },
    [onChange]
  );

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => {
    stopStream();
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCamera() {
    setCamError(null);
    setCamMessage(null);
    const env = checkCameraEnvironment();
    if (!env.isSupported) {
      setCamError("no-camara");
      setCamMessage(env.reason ?? "Tu navegador no soporta acceso directo a cámara. Podés subir una foto.");
      return;
    }
    setCamPending(true);
    const request = navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    const outcome = await raceCameraRequest(request);
    setCamPending(false);
    if (outcome.kind === "stream") {
      streamRef.current = outcome.stream;
      setCamOpen(true);
      // el <video> monta en el siguiente render
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = outcome.stream;
          videoRef.current.play().catch(() => {});
        }
      });
      return;
    }
    if (outcome.kind === "timeout") {
      // La solicitud quedó esperando sin resolver: liberar la cámara cuando
      // finalmente responda para no dejarla ocupada.
      request.then(
        (late) => { if (streamRef.current !== late) late.getTracks().forEach((t) => t.stop()); },
        () => {},
      );
      setCamError("sin-respuesta");
      setCamMessage("La cámara no respondió. Podés reintentar o subir una foto del archivo.");
      return;
    }
    const info = parseCameraError(outcome.error);
    setCamError(info.isPermissionDenied ? "denied" : "no-camara");
    setCamMessage(info.message);
  }

  function closeCamera() {
    stopStream();
    setCamOpen(false);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    try {
      const canvas = drawScaled(video, video.videoWidth, video.videoHeight);
      const [blob, pos] = await Promise.all([blobFromCanvas(canvas), getPosition()]);
      setGpsState(pos ? "ok" : "denied");
      const photo: VerifiedPhoto = {
        blob,
        previewUrl: URL.createObjectURL(blob),
        capturedAt: new Date().toISOString(),
        lat: pos?.coords.latitude ?? null,
        lng: pos?.coords.longitude ?? null,
        accuracy: pos?.coords.accuracy ?? null,
        source: "camara",
      };
      const next = [...photos, photo];
      emit(next);
      if (next.length >= maxPhotos) closeCamera();
    } catch {
      setCamError("captura");
    } finally {
      setBusy(false);
    }
  }

  async function handleFallbackFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    try {
      const remaining = maxPhotos - photos.length;
      const files = Array.from(fileList).slice(0, remaining);
      const pos = await getPosition();
      setGpsState(pos ? "ok" : "denied");
      const added: VerifiedPhoto[] = [];
      for (const f of files) {
        const blob = await compressFile(f);
        added.push({
          blob,
          previewUrl: URL.createObjectURL(blob),
          capturedAt: new Date().toISOString(),
          lat: pos?.coords.latitude ?? null,
          lng: pos?.coords.longitude ?? null,
          accuracy: pos?.coords.accuracy ?? null,
          source: "archivo",
        });
      }
      emit([...photos, ...added]);
    } catch {
      setCamError("captura");
    } finally {
      setBusy(false);
    }
  }

  function removePhoto(idx: number) {
    URL.revokeObjectURL(photos[idx].previewUrl);
    emit(photos.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {!camOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCamera}
            disabled={full || busy || camPending}
            className="h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--panel)] text-[13px] font-medium disabled:opacity-50"
          >
            {camPending ? "Esperando cámara…" : photos.length > 0 ? "Tomar otra foto" : "Abrir cámara"}
          </button>
          {camError ? (
            <label className="h-9 px-3 rounded-md border border-dashed border-[var(--border)] text-[12px] flex items-center cursor-pointer">
              Subir foto
              {/* Sin capture="environment": en navegadores móviles obligaría a abrir
                  la cámara de nuevo justo cuando la cámara ya está fallando. */}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={full || busy}
                onChange={(e) => { handleFallbackFiles(e.target.files); e.target.value = ""; }}
              />
            </label>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full max-h-72 object-contain bg-black"
          />
          <div className="flex items-center justify-between gap-2 p-2 bg-[var(--panel)]">
            <button
              type="button"
              onClick={closeCamera}
              className="h-9 px-3 rounded-md border border-[var(--border)] text-[13px]"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={capture}
              disabled={busy}
              className="h-9 px-4 rounded-md bg-[var(--primary)] text-white text-[13px] font-medium disabled:opacity-50"
            >
              {busy ? "Capturando…" : "Capturar"}
            </button>
          </div>
        </div>
      )}

      {camError === "captura" ? (
        <p className="text-[11px] text-[var(--error)]">No se pudo procesar la foto. Probá de nuevo.</p>
      ) : camError && camMessage ? (
        <p className="text-[11px] text-[var(--error)]">{camMessage}</p>
      ) : null}

      <p className="text-[11px] text-[var(--muted)]">
        {gpsState === "ok"
          ? "Ubicación registrada con la foto."
          : gpsState === "denied"
            ? "Sin permiso de ubicación — la foto se guarda igual, con fecha y hora."
            : "La foto se toma con la cámara y queda sellada con fecha, hora y ubicación."}
      </p>

      {photos.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          {photos.map((p, idx) => (
            <div key={idx} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                className="h-16 w-16 object-cover rounded border border-[var(--border)]"
              />
              {p.source === "archivo" ? (
                <span className="absolute bottom-0 left-0 right-0 bg-[var(--warn)] text-white text-[8px] text-center leading-tight">
                  archivo
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => removePhoto(idx)}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-[var(--error)] text-white text-[10px] flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
