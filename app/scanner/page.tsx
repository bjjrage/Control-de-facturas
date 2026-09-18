"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  QrCode,
  Smartphone,
  Sparkles,
  Camera as CameraIcon,
  AlertCircle,
  FileText,
} from "lucide-react";
import { CameraCapture } from "./components/camera-capture";
import { QuadEditor } from "./components/quad-editor";
import { FilterSelector } from "./components/filter-selector";
import { PageList } from "./components/page-list";
import { Point2D, QuadPoints, ScanFilter, ScannedPage } from "@/lib/scanner/types";
import { buildPdfFromJpegPages, dataUrlToUint8Array } from "@/lib/scanner/pdf-builder";
import { clearOfflinePages, getOfflinePages, saveOfflinePages } from "@/lib/scanner/offline-store";

type ScannerFlowState =
  | "join"
  | "ready"
  | "capturing"
  | "cropping"
  | "filtering"
  | "pages"
  | "success";

function ScannerContent() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("t");

  const [flowState, setFlowState] = useState<ScannerFlowState>("join");
  const [token, setToken] = useState<string | null>(tokenParam);
  const [mobileClaimToken, setMobileClaimToken] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [sessionInfo, setSessionInfo] = useState<{
    id: string;
    context_type: string;
    status: string;
  } | null>(null);

  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Páginas acumuladas
  const [pages, setPages] = useState<ScannedPage[]>([]);

  // Estado temporal de captura en progreso
  const [currentRawCapture, setCurrentRawCapture] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);

  const [currentCroppedCapture, setCurrentCroppedCapture] = useState<{
    dataUrl: string;
    width: number;
    height: number;
    quad: QuadPoints;
  } | null>(null);

  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);

  // Reclamar sesión automáticamente si vino token en URL
  useEffect(() => {
    if (tokenParam && !sessionInfo) {
      handleClaimWithToken(tokenParam);
    }
  }, [tokenParam]);

  // Guardar copia de respaldo offline en IndexedDB cada vez que cambian las páginas
  useEffect(() => {
    if (sessionInfo?.id && pages.length > 0) {
      saveOfflinePages(sessionInfo.id, pages);
    }
  }, [sessionInfo?.id, pages]);

  async function handleClaimWithToken(activeToken: string) {
    setIsJoining(true);
    setErrorNotice(null);
    try {
      const res = await fetch("/api/scanner/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: activeToken,
          deviceInfo: {
            userAgent: navigator.userAgent,
            claimedAt: new Date().toISOString(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorNotice(data.error || "No se pudo conectar a la sesión");
        return;
      }

      setToken(data.token || activeToken);
      if (data.mobileClaimToken) {
        setMobileClaimToken(data.mobileClaimToken);
      }
      setSessionInfo(data.session);

      // Revisar si había páginas guardadas offline
      const offline = await getOfflinePages(data.session.id);
      if (offline && offline.length > 0) {
        setPages(offline);
        setFlowState("pages");
      } else {
        setFlowState("ready");
      }
    } catch {
      setErrorNotice("Error de conexión al intentar conectar con el ERP");
    } finally {
      setIsJoining(false);
    }
  }

  async function handleClaimWithPin(e: React.FormEvent) {
    e.preventDefault();
    if (pinInput.trim().length !== 6) {
      setErrorNotice("El código PIN debe tener 6 dígitos");
      return;
    }

    setIsJoining(true);
    setErrorNotice(null);
    try {
      const res = await fetch("/api/scanner/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: pinInput.trim(),
          deviceInfo: {
            userAgent: navigator.userAgent,
            claimedAt: new Date().toISOString(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrorNotice(data.error || "Código inválido o sesión expirada");
        return;
      }

      // Conexión por PIN exitosa: guardar mobileClaimToken emitido por el servidor
      if (data.mobileClaimToken) {
        setMobileClaimToken(data.mobileClaimToken);
      }
      if (data.token) {
        setToken(data.token);
      }
      setSessionInfo(data.session);
      setFlowState("ready");
    } catch {
      setErrorNotice("Error de conexión al verificar código");
    } finally {
      setIsJoining(false);
    }
  }

  // 1. Captura realizada
  function handleCapture(dataUrl: string, width: number, height: number) {
    setCurrentRawCapture({ dataUrl, width, height });
    setFlowState("cropping");
  }

  // 2. Recorte de 4 esquinas confirmado
  function handleConfirmCrop(
    croppedUrl: string,
    width: number,
    height: number,
    quad: QuadPoints
  ) {
    setCurrentCroppedCapture({ dataUrl: croppedUrl, width, height, quad });
    setFlowState("filtering");
  }

  // 3. Filtro confirmado y página agregada a la lista
  function handleConfirmFilter(processedUrl: string, filter: ScanFilter) {
    if (!currentRawCapture || !currentCroppedCapture) return;

    const pageItem: ScannedPage = {
      id: editingPageIndex !== null ? pages[editingPageIndex].id : crypto.randomUUID(),
      originalDataUrl: currentRawCapture.dataUrl,
      quad: currentCroppedCapture.quad,
      processedDataUrl: processedUrl,
      filter,
      width: currentCroppedCapture.width,
      height: currentCroppedCapture.height,
    };

    if (editingPageIndex !== null) {
      setPages((prev) => {
        const copy = [...prev];
        copy[editingPageIndex] = pageItem;
        return copy;
      });
      setEditingPageIndex(null);
    } else {
      setPages((prev) => [...prev, pageItem]);
    }

    setCurrentRawCapture(null);
    setCurrentCroppedCapture(null);
    setFlowState("pages");
  }

  // Mover / eliminar / editar páginas
  function handleDeletePage(id: string) {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }

  function handleMovePage(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      const item = copy.splice(fromIndex, 1)[0];
      copy.splice(toIndex, 0, item);
      return copy;
    });
  }

  function handleEditPage(page: ScannedPage) {
    const idx = pages.findIndex((p) => p.id === page.id);
    setEditingPageIndex(idx);
    setCurrentRawCapture({
      dataUrl: page.originalDataUrl,
      width: page.width,
      height: page.height,
    });
    setFlowState("cropping");
  }

  // Generar PDF y Enviar al ERP
  async function handleFinalizeAndSend() {
    if (pages.length === 0 || !sessionInfo) return;
    setIsSending(true);
    setErrorNotice(null);

    try {
      // 1. Preparar páginas en formato JPEG bytes
      const pdfPages = pages.map((p) => {
        const bytes = dataUrlToUint8Array(p.processedDataUrl);
        return {
          jpegBytes: bytes,
          width: p.width,
          height: p.height,
        };
      });

      // 2. Ensamblar PDF
      const pdfBytes = buildPdfFromJpegPages(pdfPages);
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });

      // 3. Crear FormData
      const formData = new FormData();
      if (mobileClaimToken) {
        formData.set("mobileClaimToken", mobileClaimToken);
      }
      formData.set("pageCount", String(pages.length));
      formData.set(
        "file",
        new File([pdfBlob], `escaneo-${sessionInfo.context_type}-${Date.now()}.pdf`, {
          type: "application/pdf",
        })
      );

      // 4. Subir al endpoint protegido
      const res = await fetch("/api/scanner/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "No se pudo enviar el documento");
      }

      // Limpiar IndexedDB
      await clearOfflinePages(sessionInfo.id);

      setFlowState("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al enviar documento";
      setErrorNotice(msg);
    } finally {
      setIsSending(false);
    }
  }

  // VISTAS SEGÚN EL ESTADO DEL FLUJO:

  // Vista 1: Entrada / Unirse a la sesión
  if (flowState === "join") {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 max-w-md mx-auto w-full">
        <div className="pt-8 space-y-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/10">
            <Smartphone className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-slate-100">Control Scanner</h1>
          <p className="text-xs text-slate-400">
            Companion móvil de escaneo documental vinculado al ERP Control de Facturas.
          </p>
        </div>

        {errorNotice && (
          <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorNotice}</span>
          </div>
        )}

        <form onSubmit={handleClaimWithPin} className="space-y-4 bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Código de sesión (6 dígitos)
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
              placeholder="Ej: 482910"
              className="w-full py-3 px-4 text-center tracking-widest text-lg font-mono rounded-xl bg-slate-950 border border-slate-700 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={isJoining || pinInput.length !== 6}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs shadow-lg shadow-emerald-900/30 transition active:scale-98"
          >
            {isJoining ? "Conectando…" : "Vincular con ERP"}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-500 pb-4">
          O escaneá directamente el código QR mostrado en la pantalla de tu computadora.
        </p>
      </div>
    );
  }

  // Vista 2: Conectado y listo para capturar
  if (flowState === "ready") {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 max-w-md mx-auto w-full text-center">
        <div className="pt-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/20">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-950/60 py-1 px-3 rounded-full border border-emerald-800/60">
              Conectado al ERP
            </span>
            <h2 className="mt-3 text-lg font-bold text-slate-100 capitalize">
              {sessionInfo?.context_type ? `Contexto: ${sessionInfo.context_type}` : "Sesión Activa"}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Ubicá el documento físico en una superficie plana y con buena iluminación.
            </p>
          </div>
        </div>

        <div className="pb-8 space-y-3">
          <button
            type="button"
            onClick={() => setFlowState("capturing")}
            className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-xl shadow-emerald-900/40 transition"
          >
            <CameraIcon className="w-5 h-5" /> Abrir Cámara
          </button>

          <button
            type="button"
            onClick={() => setFlowState("join")}
            className="w-full py-2.5 text-xs text-slate-400 hover:text-white"
          >
            Desconectar
          </button>
        </div>
      </div>
    );
  }

  // Vista 3: Cámara en vivo
  if (flowState === "capturing") {
    return (
      <CameraCapture
        onCapture={handleCapture}
        pageCount={pages.length}
        onCancel={() => {
          if (pages.length > 0) {
            setFlowState("pages");
          } else {
            setFlowState("ready");
          }
        }}
      />
    );
  }

  // Vista 4: Editor de esquinas y corrección de perspectiva
  if (flowState === "cropping" && currentRawCapture) {
    return (
      <QuadEditor
        imageDataUrl={currentRawCapture.dataUrl}
        onConfirmCrop={handleConfirmCrop}
        onCancel={() => setFlowState("capturing")}
      />
    );
  }

  // Vista 5: Selector de filtros (Original / Documento / B&N)
  if (flowState === "filtering" && currentCroppedCapture) {
    return (
      <FilterSelector
        croppedDataUrl={currentCroppedCapture.dataUrl}
        onConfirmFilter={handleConfirmFilter}
        onBack={() => setFlowState("cropping")}
      />
    );
  }

  // Vista 6: Gestión multipágina
  if (flowState === "pages") {
    return (
      <div className="flex flex-col h-full w-full">
        {errorNotice && (
          <div className="p-3 bg-red-950/80 border-b border-red-500/40 text-red-200 text-xs flex items-center justify-between">
            <span>{errorNotice}</span>
            <button
              type="button"
              onClick={() => setErrorNotice(null)}
              className="text-red-400 font-bold ml-2"
            >
              ✕
            </button>
          </div>
        )}
        <PageList
          pages={pages}
          onAddPage={() => setFlowState("capturing")}
          onDeletePage={handleDeletePage}
          onMovePage={handleMovePage}
          onEditPage={handleEditPage}
          onFinalize={handleFinalizeAndSend}
          isSending={isSending}
        />
      </div>
    );
  }

  // Vista 7: Éxito
  if (flowState === "success") {
    return (
      <div className="flex-1 flex flex-col justify-between p-6 max-w-md mx-auto w-full text-center">
        <div className="pt-16 space-y-4">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center mx-auto text-emerald-400 shadow-2xl shadow-emerald-500/20">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">¡Documento Enviado!</h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              El PDF escaneado ya fue recibido en tu sesión de ERP Control de Facturas en la computadora.
            </p>
          </div>
        </div>

        <div className="pb-8 space-y-3">
          <button
            type="button"
            onClick={() => {
              setPages([]);
              setFlowState("ready");
            }}
            className="w-full py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
          >
            Escanear otro documento
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default function ScannerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center p-6 text-slate-400 text-xs">
          Cargando Control Scanner…
        </div>
      }
    >
      <ScannerContent />
    </Suspense>
  );
}
