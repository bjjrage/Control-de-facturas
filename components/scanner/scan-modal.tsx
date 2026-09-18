"use client";

import { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/browser";
import {
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { ScanSessionStatus } from "@/lib/scanner/types";

export interface ReceivedDocument {
  file: File;
  signedUrl: string;
  fileName: string;
  pageCount: number;
  fileSizeBytes: number;
}

interface ScanModalProps {
  contextType?: string;
  contextId?: string | null;
  targetField?: string | null;
  trigger?: React.ReactNode;
  onDocumentReceived?: (doc: ReceivedDocument) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ScanModal({
  contextType = "general",
  contextId = null,
  targetField = null,
  trigger,
  onDocumentReceived,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
}: ScanModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = externalOpen !== undefined;
  const isOpen = isControlled ? externalOpen : internalOpen;

  const setOpen = (val: boolean) => {
    if (!isControlled) setInternalOpen(val);
    externalOnOpenChange?.(val);
  };

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanSessionStatus>("waiting");
  const [receivedDoc, setReceivedDoc] = useState<ReceivedDocument | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  const supabaseRef = useRef(createClient());

  // Inicializar sesión cuando se abre el modal
  useEffect(() => {
    if (!isOpen) {
      // Reset al cerrar
      setStatus("waiting");
      setReceivedDoc(null);
      setErrorNotice(null);
      return;
    }

    let active = true;

    async function initSession() {
      setIsLoadingSession(true);
      setErrorNotice(null);

      try {
        const res = await fetch("/api/scanner/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contextType,
            contextId,
            targetField,
          }),
        });

        const data = await res.json();
        if (!active) return;

        if (!res.ok || data.error) {
          throw new Error(data.error || "No se pudo iniciar la sesión de escaneo");
        }

        setSessionId(data.sessionId);
        setToken(data.token);
        setPinCode(data.pinCode);
        setStatus("waiting");

        // Construir URL absoluta para el QR
        const origin = window.location.origin;
        const fullJoinUrl = `${origin}${data.joinUrl}`;

        // Generar QR
        const qrUrl = await QRCode.toDataURL(fullJoinUrl, {
          width: 240,
          margin: 1,
          color: {
            dark: "#0f172a",
            light: "#ffffff",
          },
        });

        if (active) {
          setQrDataUrl(qrUrl);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : "Error al iniciar sesión";
          setErrorNotice(msg);
        }
      } finally {
        if (active) setIsLoadingSession(false);
      }
    }

    initSession();

    return () => {
      active = false;
    };
  }, [isOpen, contextType, contextId, targetField]);

  // Manejar finalización y descarga del documento
  async function handleSessionCompleted(docData: {
    signed_url: string;
    file_name: string;
    page_count: number;
    file_size_bytes: number;
  }) {
    if (!docData.signed_url) return;

    try {
      // Descargar el archivo PDF para transformarlo en objeto File
      const fileRes = await fetch(docData.signed_url);
      const blob = await fileRes.blob();
      const fileObj = new File([blob], docData.file_name || "escaneo.pdf", {
        type: "application/pdf",
      });

      const received: ReceivedDocument = {
        file: fileObj,
        signedUrl: docData.signed_url,
        fileName: docData.file_name,
        pageCount: docData.page_count,
        fileSizeBytes: docData.file_size_bytes,
      };

      setReceivedDoc(received);
      setStatus("completed");
    } catch (err) {
      console.warn("Error al recuperar el archivo escaneado:", err);
    }
  }

  // Suscribirse a Realtime y polling de respaldo
  useEffect(() => {
    if (!isOpen || !sessionId || status === "completed") return;

    const supabase = supabaseRef.current;

    // 1. Canal Realtime
    const channel = supabase
      .channel(`scan_session_updates_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scan_sessions",
          filter: `id=eq.${sessionId}`,
        },
        async (payload) => {
          const nextRow = payload.new as {
            status: ScanSessionStatus;
            storage_path?: string;
            file_name?: string;
            page_count?: number;
            file_size_bytes?: number;
          };

          if (nextRow.status) {
            setStatus(nextRow.status);
          }

          if (nextRow.status === "completed") {
            // Consultar signedUrl
            const pollRes = await fetch(`/api/scanner/status/${sessionId}`);
            const statusData = await pollRes.json();
            if (statusData.signed_url) {
              handleSessionCompleted(statusData);
            }
          }
        }
      )
      .subscribe();

    // 2. Polling de respaldo cada 3 segundos
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/scanner/status/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status && data.status !== status) {
          setStatus(data.status);
        }

        if (data.status === "completed" && !receivedDoc && data.signed_url) {
          handleSessionCompleted(data);
        }
      } catch {
        // Silently ignore polling network jitter
      }
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [isOpen, sessionId, status, receivedDoc]);

  function handleUseDocument() {
    if (receivedDoc && onDocumentReceived) {
      onDocumentReceived(receivedDoc);
    }
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent title="Escanear desde celular" className="max-w-md">
        <div className="p-1 space-y-4">
          {errorNotice ? (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-xs text-red-300 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-200">Error al preparar escáner</p>
                <p>{errorNotice}</p>
              </div>
            </div>
          ) : isLoadingSession ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              <span className="text-xs font-medium">Generando sesión de escaneo…</span>
            </div>
          ) : status === "completed" && receivedDoc ? (
            /* Documento Recibido */
            <div className="py-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shadow-xl shadow-emerald-500/10">
                <FileCheck className="w-8 h-8" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/60 py-1 px-3 rounded-full border border-emerald-200 dark:border-emerald-800">
                  Documento recibido
                </span>
                <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">
                  {receivedDoc.fileName}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {receivedDoc.pageCount} {receivedDoc.pageCount === 1 ? "página" : "páginas"} ·{" "}
                  {Math.round(receivedDoc.fileSizeBytes / 1024)} KB
                </p>
              </div>

              <div className="pt-2 w-full flex items-center gap-2">
                <a
                  href={receivedDoc.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 font-medium flex items-center justify-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Ver PDF
                </a>
                <Button
                  type="button"
                  onClick={handleUseDocument}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-lg shadow-emerald-900/20"
                >
                  Usar documento
                </Button>
              </div>
            </div>
          ) : (
            /* Pantalla de Espera / Escaneo */
            <div className="space-y-4 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Escaneá este código QR con la cámara de tu celular para abrir <strong>Control Scanner</strong>.
              </p>

              {qrDataUrl && (
                <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl shadow-inner border border-slate-200 w-64 h-64 mx-auto">
                  <img
                    src={qrDataUrl}
                    alt="QR de escaneo"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {/* Código PIN alternativo */}
              {pinCode && (
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between px-4">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Código de 6 dígitos:</span>
                  <span className="font-mono text-base font-bold tracking-widest text-slate-900 dark:text-emerald-400">
                    {pinCode}
                  </span>
                </div>
              )}

              {/* Estado de sincronización en tiempo real */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 flex items-center justify-center gap-2.5 text-xs">
                {status === "waiting" && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      Esperando conexión del celular…
                    </span>
                  </>
                )}
                {status === "connected" && (
                  <>
                    <Smartphone className="w-4 h-4 text-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Celular conectado
                    </span>
                  </>
                )}
                {status === "scanning" && (
                  <>
                    <Smartphone className="w-4 h-4 text-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Escaneando documento…
                    </span>
                  </>
                )}
                {status === "processing" && (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Recibiendo y procesando PDF…
                    </span>
                  </>
                )}
                {status === "expired" && (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      Sesión expirada
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
