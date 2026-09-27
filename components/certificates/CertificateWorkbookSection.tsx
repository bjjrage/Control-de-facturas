"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import {
  applyCertificateWorkbook,
  attachCertificateWorkbook,
  getCertificateWorkbook,
  getCertificateWorkbookDownloadUrl,
  saveCertificateWorkbookSnapshot,
  type CertificateWorkbookView,
} from "@/app/(internal)/projects/certificado-workbook-actions";
import type { ProjectCertificateStatus } from "@/lib/types";

// Univer solo se carga al abrir un certificado con planilla — evita pagar
// su costo en cada carga de /projects/[id].
const CertificateWorkbookGrid = dynamic(
  () => import("./CertificateWorkbookGrid").then((m) => m.CertificateWorkbookGrid),
  { ssr: false, loading: () => <div className="text-[12px] text-[var(--muted)] p-3">Abriendo planilla…</div> }
);

/**
 * Fase 3 de "Certificados Excel-first": la planilla del certificado, dentro
 * de su detalle. Si el certificado no tiene una adjunta, ofrece subirla
 * (solo en BORRADOR); si la tiene, la muestra embebida — editable en
 * BORRADOR, congelada desde ELABORADO (ver [[excel-first-certificados]]).
 */
export function CertificateWorkbookSection({
  certificateId,
  status,
  onAvailability,
  probeOnly = false,
}: {
  certificateId: string;
  status: ProjectCertificateStatus;
  /** Avisa si el certificado tiene planilla (para abrir esa pestaña por defecto). */
  onAvailability?: (hasWorkbook: boolean) => void;
  /** Solo consulta si hay planilla; no muestra nada ni carga Univer. */
  probeOnly?: boolean;
}) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; workbook: CertificateWorkbookView | null; version: number }>({
    loading: true,
    error: null,
    workbook: null,
    version: 0,
  });
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const saveNowRef = useRef<(() => Promise<boolean>) | null>(null);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onAvailabilityRef = useRef(onAvailability);
  useEffect(() => {
    onAvailabilityRef.current = onAvailability;
  }, [onAvailability]);

  // No pone loading:true de forma síncrona al llamarlo — evita el patrón que
  // React desaconseja (setState síncrono dentro del cuerpo de un efecto). El
  // estado inicial ya arranca en loading:true; una recarga manual (tras
  // subir el archivo) simplemente reemplaza el resultado cuando llega.
  const load = useCallback(() => {
    getCertificateWorkbook(certificateId)
      .then((result) => {
        setState((s) => ({ loading: false, error: result.error, workbook: result.workbook, version: s.version + 1 }));
        onAvailabilityRef.current?.(Boolean(result.workbook));
      })
      .catch(() => setState((s) => ({ loading: false, error: "No se pudo abrir la planilla.", workbook: null, version: s.version + 1 })));
  }, [certificateId]);

  // También al cambiar de estado (elaborar/retroceder): la grilla se vuelve
  // a montar y tiene que partir de lo último guardado, no de lo que había
  // al abrir el certificado.
  useEffect(() => {
    load();
  }, [load, status]);

  async function handleFileSelected(file: File) {
    setUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    const result = await attachCertificateWorkbook(certificateId, formData);
    setUploading(false);
    if (result.error) {
      setState((s) => ({ ...s, error: result.error }));
      return;
    }
    load();
  }

  async function handleApply() {
    setApplying(true);
    setApplyMessage(null);
    const saved = saveNowRef.current ? await saveNowRef.current() : true;
    if (!saved) {
      setApplying(false);
      setApplyMessage({ ok: false, text: "No se pudo guardar la planilla antes de aplicar; no se aplicó nada." });
      return;
    }
    const result = await applyCertificateWorkbook(certificateId);
    setApplying(false);
    if (result.error) {
      setApplyMessage({ ok: false, text: result.error });
      return;
    }
    const monto = result.montoPresente === null ? "" : ` · monto del período ${Math.round(result.montoPresente).toLocaleString("es-PY")} Gs`;
    setApplyMessage({
      ok: true,
      text: `Aplicado: ${result.lines} líneas${monto}.${result.warnings.length ? ` Observaciones: ${result.warnings.join(" ")}` : ""}`,
    });
    router.refresh();
  }

  async function handleDownloadOriginal() {
    const result = await getCertificateWorkbookDownloadUrl(certificateId);
    if (result.url) window.open(result.url, "_blank");
  }

  if (probeOnly) return null;
  if (state.loading) return <div className="text-[12px] text-[var(--muted)]">Cargando planilla…</div>;

  if (!state.workbook) {
    if (status !== "BORRADOR") return null; // sin planilla y ya cerrado: nada que ofrecer acá.
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
          <FileSpreadsheet size={16} />
          Este certificado no tiene una planilla Excel adjunta.
        </div>
        <div className="flex items-center gap-2">
          {state.error ? <span className="text-[12px] text-[var(--error)]">{state.error}</span> : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--border)] text-[12px] hover:bg-[var(--hover)] disabled:opacity-50"
          >
            <Upload size={13} /> {uploading ? "Subiendo…" : "Subir planilla"}
          </button>
        </div>
      </div>
    );
  }

  const workbookId = state.workbook.id;
  const readOnly = status !== "BORRADOR";
  return (
    <div>
      <CertificateWorkbookGrid
        // Al elaborar o retroceder cambia si se puede editar: se vuelve a
        // montar la grilla con el modo correcto.
        key={`${workbookId}-${readOnly ? "ro" : "rw"}-${state.version}`}
        workbookId={workbookId}
        fileName={state.workbook.originalFileName}
        initialSnapshot={state.workbook.workingSnapshot}
        readOnly={readOnly}
        readOnlyLabel="Certificado elaborado — planilla congelada"
        onSave={(snapshot) => saveCertificateWorkbookSnapshot(workbookId, snapshot)}
        saveNowRef={saveNowRef}
        toolbar={
          <>
            {readOnly ? null : (
              <button
                type="button"
                disabled={applying}
                onClick={handleApply}
                title="Pasa lo cargado en la planilla a las líneas y montos del certificado"
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-[var(--accent,#2f6fed)] text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
              >
                <CheckCircle2 size={13} /> {applying ? "Aplicando…" : "Aplicar planilla al certificado"}
              </button>
            )}
            <span className="flex items-center gap-1.5 truncate">
              <FileSpreadsheet size={13} /> {state.workbook.originalFileName}
            </span>
            <button type="button" onClick={handleDownloadOriginal} className="text-action shrink-0">
              Descargar original
            </button>
            {applyMessage ? (
              <span className={`text-[12px] ${applyMessage.ok ? "text-[var(--ok)]" : "text-[var(--error)]"}`}>{applyMessage.text}</span>
            ) : null}
          </>
        }
      />
    </div>
  );
}
