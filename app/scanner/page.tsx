"use client";

import { Suspense, useEffect, useRef, useState } from "react";
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
import { ScannerDebugOverlay } from "./components/scanner-debug-overlay";
import { debugStore, isScannerDebugActive } from "@/lib/scanner/debug-store";

type ScannerFlowState =
  | "booting"
  | "manual"
  | "ready"
  | "capturing"
  | "cropping"
  | "filtering"
  | "pages"
  | "success";

function cleanQrTokenFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("t") || url.searchParams.has("token")) {
      url.searchParams.delete("t");
      url.searchParams.delete("token");
      const cleanUrl = url.pathname + (url.search ? url.search : "") + (url.hash || "");
      window.history.replaceState(window.history.state, "", cleanUrl);
    }
  } catch (err) {
    console.warn("Error al limpiar token de URL:", err);
  }
}

function getValidStoredMobileToken(expectedSessionId?: string | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    const storedToken = sessionStorage.getItem("scanner_mobile_token");
    const storedSessionId = sessionStorage.getItem("scanner_session_id");
    if (!storedToken) return null;
    if (expectedSessionId && storedSessionId && storedSessionId !== expectedSessionId) {
      return null;
    }
    return storedToken;
  } catch {
    return null;
  }
}

function clearLocalMobileSession() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem("scanner_mobile_token");
    sessionStorage.removeItem("scanner_session_id");
  } catch {}
}

function saveLocalMobileSession(sessionId: string, mobileClaimToken: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem("scanner_mobile_token", mobileClaimToken);
    sessionStorage.setItem("scanner_session_id", sessionId);
  } catch {}
}

function ScannerContent() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("t") || searchParams.get("token");

  const [flowState, setFlowStateInternal] = useState<ScannerFlowState>("booting");
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

  // Modo debug y telemetría
  const [isDebug, setIsDebug] = useState(false);
  const readyButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setIsDebug(isScannerDebugActive());
  }, []);

  // Logger de transiciones de estado
  function setFlowState(next: ScannerFlowState) {
    setFlowStateInternal((prev) => {
      if (prev !== next) {
        debugStore.logTransition(`${prev} -> ${next}`);
      }
      return next;
    });
  }

  function handleRegularOpenCamera() {
    debugStore.logTransition("CLICK open-camera received");
    setFlowState("capturing");
  }

  function handleDebugOpenCamera() {
    debugStore.logTransition("CLICK debug-open-camera received");
    setFlowState("capturing");
  }

  // Guards contra carreras y stale responses
  const bootGenerationRef = useRef(0);
  const consumedTokensRef = useRef<Set<string>>(new Set());
  const isClaimingRef = useRef(false);

  // Páginas acumuladas
  const [pages, setPages] = useState<ScannedPage[]>([]);

  // Estado temporal de captura en progreso
  const [currentRawCapture, setCurrentRawCapture] = useState<{
    dataUrl: string;
    width: number;
    height: number;
    detectedQuad?: QuadPoints;
  } | null>(null);

  const [currentCroppedCapture, setCurrentCroppedCapture] = useState<{
    dataUrl: string;
    width: number;
    height: number;
    quad: QuadPoints;
  } | null>(null);

  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);

  // Helper para aplicar sesión activa
  async function applyActiveSession(
    activeSession: { id: string; context_type: string; status: string },
    activeMobileToken: string | null
  ) {
    setSessionInfo(activeSession);
    if (activeMobileToken) {
      setMobileClaimToken(activeMobileToken);
      saveLocalMobileSession(activeSession.id, activeMobileToken);
    }
    cleanQrTokenFromUrl();

    // Restaurar páginas offline si existían para esta sesión
    const offline = await getOfflinePages(activeSession.id);
    if (offline && offline.length > 0) {
      setPages(offline);
      setFlowState("pages");
    } else {
      setFlowState("ready");
    }
  }

  // BOOTSTRAP MÓVIL ÚNICO
  async function bootstrapScanner(source: "mount" | "pageshow" | "visibility" = "mount") {
    // Si ya hay un claim en proceso, no interrumpir
    const isResumeOnly = source === "pageshow" || source === "visibility";
    if (isClaimingRef.current && isResumeOnly) {
      return;
    }

    const currentGen = ++bootGenerationRef.current;

    // Si el usuario ya está en captura, recorte o filtro, no interrumpir la interacción
    if (flowState === "capturing" || flowState === "cropping" || flowState === "filtering") {
      return;
    }

    try {
      // 1. RESUME existing mobile session
      const storedMobileToken = getValidStoredMobileToken();
      const headers: Record<string, string> = {};
      if (storedMobileToken) {
        headers["x-mobile-claim-token"] = storedMobileToken;
      }

      const res = await fetch("/api/scanner/mobile-session", {
        method: "GET",
        headers,
        credentials: "same-origin",
      });

      if (currentGen !== bootGenerationRef.current) return;

      if (res.ok) {
        const data = await res.json();
        if (data.active && data.session) {
          await applyActiveSession(data.session, data.mobileClaimToken || storedMobileToken);
          return;
        }
      }

      // En eventos de reanudación (pageshow / visibility), NUNCA hacer claim del raw QR token
      if (isResumeOnly) {
        return;
      }

      // 3. Si no existe mobile session activa:
      // Obtener el token de la URL si no ha sido consumido previamente por este cliente
      const rawToken =
        tokenParam ||
        (typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("t") ||
            new URLSearchParams(window.location.search).get("token")
          : null);

      if (rawToken && !consumedTokensRef.current.has(rawToken)) {
        consumedTokensRef.current.add(rawToken);
        isClaimingRef.current = true;
        setFlowState("booting");

        // Limpiar credencial local stale antes de intentar vincular una sesión nueva
        clearLocalMobileSession();

        try {
          const claimRes = await fetch("/api/scanner/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              token: rawToken,
              deviceInfo: {
                userAgent: navigator.userAgent,
                claimedAt: new Date().toISOString(),
              },
            }),
          });

          if (currentGen !== bootGenerationRef.current) return;

          const claimData = await claimRes.json();

          // 4. Claim success: persist fallback, restore session, remove raw QR token from URL, READY
          if (claimRes.ok && claimData.session) {
            await applyActiveSession(claimData.session, claimData.mobileClaimToken);
            return;
          }

          // Manejo especial de 409 (Conflict):
          // En caso de carrera (ej. request A ganó y request B recibió 409), consultar resume una vez
          if (claimRes.status === 409) {
            const reconcileRes = await fetch("/api/scanner/mobile-session", {
              method: "GET",
              credentials: "same-origin",
            });

            if (currentGen !== bootGenerationRef.current) return;

            if (reconcileRes.ok) {
              const retryData = await reconcileRes.json();
              if (retryData.active && retryData.session) {
                await applyActiveSession(retryData.session, retryData.mobileClaimToken);
                return;
              }
            }
          }

          // Si el claim falló y no se pudo conciliar:
          setErrorNotice(claimData.error || "Sesión de escaneo no encontrada o ya reclamada");
          setFlowState("manual");
          return;
        } finally {
          isClaimingRef.current = false;
        }
      }

      // 5. Sin mobile session y sin token: mostrar formulario manual PIN
      setFlowState("manual");
    } catch (err) {
      if (currentGen !== bootGenerationRef.current) return;
      console.warn("Error en bootstrapScanner:", err);
      setFlowState("manual");
    }
  }

  // Lifecycle listeners: Mount, Safari bfcache (pageshow) y visibilitychange
  useEffect(() => {
    bootstrapScanner("mount");

    function handlePageShow(e: PageTransitionEvent) {
      // En Safari / WebKit, pageshow se dispara con persisted=false en carga inicial.
      // Solo debemos reanudar sesión si e.persisted es true (restaurado de bfcache).
      if (e.persisted) {
        bootstrapScanner("pageshow");
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        bootstrapScanner("visibility");
      }
    }

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Guardar copia de respaldo offline en IndexedDB cada vez que cambian las páginas
  useEffect(() => {
    if (sessionInfo?.id && pages.length > 0) {
      saveOfflinePages(sessionInfo.id, pages);
    }
  }, [sessionInfo?.id, pages]);

  async function handleClaimWithPin(e: React.FormEvent) {
    e.preventDefault();
    if (pinInput.trim().length !== 6) {
      setErrorNotice("El código PIN debe tener 6 dígitos");
      return;
    }

    setIsJoining(true);
    setErrorNotice(null);
    try {
      const storedMobileToken = getValidStoredMobileToken();

      const res = await fetch("/api/scanner/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          pin: pinInput.trim(),
          mobileClaimToken: storedMobileToken || undefined,
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

      await applyActiveSession(data.session, data.mobileClaimToken);
    } catch {
      setErrorNotice("Error de conexión al verificar código");
    } finally {
      setIsJoining(false);
    }
  }

  // 1. Captura realizada
  function handleCapture(
    dataUrl: string,
    width: number,
    height: number,
    detectedQuad?: QuadPoints
  ) {
    setCurrentRawCapture({ dataUrl, width, height, detectedQuad });
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
      detectedQuad: page.quad,
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
        credentials: "same-origin",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "No se pudo enviar el documento");
      }

      // Limpiar IndexedDB y credenciales locales
      await clearOfflinePages(sessionInfo.id);
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("scanner_mobile_token");
        sessionStorage.removeItem("scanner_session_id");
      }

      setFlowState("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al enviar documento";
      setErrorNotice(msg);
    } finally {
      setIsSending(false);
    }
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/scanner/mobile-session", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {}
    clearLocalMobileSession();
    cleanQrTokenFromUrl();
    setSessionInfo(null);
    setMobileClaimToken(null);
    setPages([]);
    setFlowState("manual");
  }

  // VISTAS SEGÚN EL ESTADO DEL FLUJO:
  function renderView() {
    // Vista 0: Conectando / Verificando sesión (Bootstrap inicial)
    if (flowState === "booting") {
      return (
        <div
          className="flex h-full min-h-0 flex-col items-center justify-center p-6 max-w-md mx-auto w-full text-center"
          style={{
            paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/10 animate-pulse mb-4">
            <Smartphone className="w-8 h-8" />
          </div>
          <h2 className="text-base font-semibold text-slate-100">Conectando con Control Scanner…</h2>
          <p className="mt-1.5 text-xs text-slate-400">Verificando sesión segura con el ERP</p>
        </div>
      );
    }

    // Vista 1: Entrada / Formulario PIN manual
    if (flowState === "manual" || (flowState as string) === "join") {
      return (
        <div className="flex h-full min-h-0 flex-col w-full max-w-md mx-auto">
          <main
            className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col justify-center"
            style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="space-y-3 text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/10">
                <Smartphone className="w-7 h-7" />
              </div>
              <h1 className="text-xl font-bold text-slate-100">Control Scanner</h1>
              <p className="text-xs text-slate-400">
                Companion móvil de escaneo documental vinculado al ERP Control de Facturas.
              </p>
            </div>

            {errorNotice && (
              <div className="mb-4 p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs flex items-start gap-2">
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
          </main>

          <footer
            className="shrink-0 p-4 text-center text-[11px] text-slate-500"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            O escaneá directamente el código QR mostrado en la pantalla de tu computadora.
          </footer>
        </div>
      );
    }

    // Vista 2: Conectado y listo para capturar
    if (flowState === "ready") {
      return (
        <div className="flex h-full min-h-0 flex-col w-full max-w-md mx-auto relative">
          <main
            className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col items-center justify-center text-center"
            style={{
              paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
              paddingBottom: isDebug
                ? 'calc(14rem + env(safe-area-inset-bottom, 0px))'
                : 'calc(10rem + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/20 mb-3">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-950/60 py-1 px-3 rounded-full border border-emerald-800/60">
                Conectado al ERP
              </span>
              <h2 className="mt-3 text-lg font-bold text-slate-100 capitalize">
                {sessionInfo?.context_type ? `Contexto: ${sessionInfo.context_type}` : "Sesión Activa"}
              </h2>
              <p className="mt-1 text-xs text-slate-400 max-w-xs mx-auto">
                Ubicá el documento físico en una superficie plana y con buena iluminación.
              </p>
            </div>
          </main>

          {/* CTA Principal de Cámara - Fixed/Sticky robusto */}
          <div
            className="fixed inset-x-0 bottom-0 p-6 pt-2 space-y-3 z-30 max-w-md mx-auto bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pointer-events-auto"
            style={{
              paddingBottom: isDebug
                ? 'calc(4.5rem + 16px + env(safe-area-inset-bottom, 0px))'
                : 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <button
              ref={readyButtonRef}
              id="btn-open-camera"
              type="button"
              onClick={handleRegularOpenCamera}
              className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-xl shadow-emerald-900/40 transition"
            >
              <CameraIcon className="w-5 h-5" /> Abrir Cámara
            </button>

            <button
              type="button"
              onClick={handleDisconnect}
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
          initialQuad={currentRawCapture.detectedQuad}
          onConfirmCrop={handleConfirmCrop}
          onCancel={() => {
            if (editingPageIndex !== null) {
              setEditingPageIndex(null);
              setFlowState("pages");
            } else {
              setFlowState("capturing");
            }
          }}
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
        <div className="flex h-full min-h-0 flex-col w-full max-w-md mx-auto">
          <main
            className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col items-center justify-center text-center"
            style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center mx-auto text-emerald-400 shadow-2xl shadow-emerald-500/20 mb-3">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">¡Documento Enviado!</h2>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed max-w-xs mx-auto">
                El PDF escaneado ya fue recibido en tu sesión de ERP Control de Facturas en la computadora.
              </p>
            </div>
          </main>

          <div
            className="shrink-0 p-6 pt-2 space-y-3"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
          >
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

  return (
    <>
      {isDebug && (
        <>
          <ScannerDebugOverlay
            flowState={flowState}
            sessionInfo={sessionInfo}
            readyButtonRef={readyButtonRef}
          />
          <button
            id="btn-debug-open-camera"
            type="button"
            onClick={handleDebugOpenCamera}
            style={{
              position: "fixed",
              left: "16px",
              right: "16px",
              bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
              zIndex: 99999,
            }}
            className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-bold text-xs uppercase tracking-wider shadow-2xl border-2 border-amber-300"
          >
            [ DEBUG: ABRIR CÁMARA ]
          </button>
        </>
      )}
      {renderView()}
    </>
  );
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
