"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Smartphone,
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
  storagePath?: string;
}

interface ScanModalProps {
  contextType?: string;
  contextId?: string | null;
  targetField?: string | null;
  metadata?: Record<string, unknown>;
  trigger?: React.ReactNode;
  onDocumentReceived?: (doc: ReceivedDocument) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ScanModal({
  contextType = "general",
  contextId = null,
  targetField = null,
  metadata,
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
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanSessionStatus>("waiting");
  const [receivedDoc, setReceivedDoc] = useState<ReceivedDocument | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  const statusRef = useRef(status);
  statusRef.current = status;

  const receivedDocRef = useRef(receivedDoc);
  receivedDocRef.current = receivedDoc;

  // Manejar finalización y recuperación del documento
  const handleSessionCompleted = useCallback(
    async (docData: {
      signed_url: string;
      file_name: string;
      page_count: number;
      file_size_bytes: number;
      storage_path?: string;
    }) => {
      if (!docData.signed_url) return;

      try {
        const fileRes = await fetch(docData.signed_url);
        const blob = await fileRes.blob();
        const fileObj = new File([blob], docData.file_name || "factura-escaneada.pdf", {
          type: "application/pdf",
        });

        const received: ReceivedDocument = {
          file: fileObj,
          signedUrl: docData.signed_url,
          fileName: docData.file_name || "factura-escaneada.pdf",
          pageCount: docData.page_count || 1,
          fileSizeBytes: docData.file_size_bytes || blob.size,
          storagePath: docData.storage_path,
        };

        setReceivedDoc(received);
        setStatus("completed");
        if (onDocumentReceived) {
          onDocumentReceived(received);
        }
      } catch (err) {
        console.warn("Error al recuperar el archivo escaneado:", err);
      }
    },
    [onDocumentReceived]
  );

  const handleSessionCompletedRef = useRef(handleSessionCompleted);
  handleSessionCompletedRef.current = handleSessionCompleted;

  // Inicializar o reiniciar sesión
  const initSession = useCallback(async () => {
    setIsLoadingSession(true);
    setErrorNotice(null);
    setStatus("waiting");
    setReceivedDoc(null);
    setSessionId(null);
    setPinCode(null);
    setQrDataUrl(null);

    try {
      const res = await fetch("/api/scanner/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextType,
          contextId,
          targetField,
          metadata: metadata || { source: "invoice-dialog" },
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "No se pudo iniciar la sesión de escaneo");
      }

      setSessionId(data.sessionId);
      setPinCode(data.pinCode);
      setStatus("waiting");

      // Construir URL absoluta para el QR
      const origin = typeof window !== "undefined" ? window.location.origin : "";
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

      setQrDataUrl(qrUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al iniciar sesión";
      setErrorNotice(msg);
    } finally {
      setIsLoadingSession(false);
    }
  }, [contextType, contextId, targetField, metadata]);

  // Disparar inicialización de sesión al abrir el modal
  useEffect(() => {
    if (!isOpen) {
      setStatus("waiting");
      setReceivedDoc(null);
      setErrorNotice(null);
      return;
    }

    initSession();
  }, [isOpen, initSession]);

  // Polling seguro cada 2000ms (1.5s - 2.5s) al endpoint tenant-safe /api/scanner/status/[id]
  useEffect(() => {
    if (!isOpen || !sessionId) return;
    if (statusRef.current === "completed" || statusRef.current === "expired") return;

    let isMounted = true;

    const pollInterval = setInterval(async () => {
      if (!isMounted || statusRef.current === "completed" || statusRef.current === "expired") {
        return;
      }

      try {
        const res = await fetch(`/api/scanner/status/${sessionId}`);
        if (!res.ok || !isMounted) return;
        const data = await res.json();

        if (data.status && data.status !== statusRef.current) {
          setStatus(data.status);
        }

        if (data.status === "completed" && !receivedDocRef.current && data.signed_url) {
          await handleSessionCompletedRef.current(data);
        }
      } catch {
        // Ignorar intermitencias temporales de red durante el polling
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [isOpen, sessionId]);

  function handleUseDocument() {
    if (receivedDoc && onDocumentReceived) {
      onDocumentReceived(receivedDoc);
    }
    setOpen(false);
  }

  const originUrl = typeof window !== "undefined" ? window.location.origin : "";
  const formattedPin = pinCode && pinCode.length === 6
    ? `${pinCode.slice(0, 3)} ${pinCode.slice(3)}`
    : pinCode;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent title="Control Scanner" className="max-w-md">
        <div className="p-1 space-y-4">
          {errorNotice ? (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-xs text-red-300 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-200">No se pudo iniciar Control Scanner</p>
                  <p>{errorNotice}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={initSession}
                  className="text-xs gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                </Button>
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
          ) : status === "expired" ? (
            /* Sesión Expirada */
            <div className="py-8 flex flex-col items-center text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  La sesión expiró
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                  Por seguridad, los códigos temporales de escaneo tienen un tiempo límite. Podés generar un código nuevo.
                </p>
              </div>
              <div className="pt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={initSession}
                  className="text-xs gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Generar nuevo código
                </Button>
              </div>
            </div>
          ) : (
            /* Pantalla de Espera / Escaneo */
            <div className="space-y-3.5 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Escaneá este código con tu celular
              </p>

              {qrDataUrl && (
                <div className="flex flex-col items-center justify-center p-2.5 bg-white rounded-2xl shadow-inner border border-slate-200 w-56 h-56 mx-auto">
                  <img
                    src={qrDataUrl}
                    alt="QR de escaneo"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {/* PIN de sesión */}
              {formattedPin && (
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">
                    PIN DE SESIÓN
                  </div>
                  <div className="font-mono text-xl font-bold tracking-widest text-slate-900 dark:text-emerald-400">
                    {formattedPin}
                  </div>
                </div>
              )}

              {/* Instrucción alternativa */}
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                También podés abrir{" "}
                <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-slate-700 dark:text-slate-300">
                  {originUrl}/scanner
                </code>{" "}
                e ingresar el PIN.
              </p>

              {/* Estado de sincronización en tiempo real */}
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/80 flex items-center justify-center gap-2 text-xs">
                {status === "waiting" && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      Esperando celular…
                    </span>
                  </>
                )}
                {status === "connected" && (
                  <>
                    <Smartphone className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Celular conectado
                    </span>
                  </>
                )}
                {status === "scanning" && (
                  <>
                    <Smartphone className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Escaneando documento…
                    </span>
                  </>
                )}
                {status === "processing" && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Preparando PDF…
                    </span>
                  </>
                )}
              </div>

              <div className="pt-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
