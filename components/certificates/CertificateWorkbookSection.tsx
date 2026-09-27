"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileSpreadsheet, Upload } from "lucide-react";
import {
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
  const [state, setState] = useState<{ loading: boolean; error: string | null; workbook: CertificateWorkbookView | null }>({
    loading: true,
    error: null,
    workbook: null,
  });
  const [uploading, setUploading] = useState(false);
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
        setState({ loading: false, error: result.error, workbook: result.workbook });
        onAvailabilityRef.current?.(Boolean(result.workbook));
      })
      .catch(() => setState({ loading: false, error: "No se pudo abrir la planilla.", workbook: null }));
  }, [certificateId]);

  useEffect(() => {
    load();
  }, [load]);

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
  return (
    <div>
      <CertificateWorkbookGrid
        key={workbookId}
        workbookId={workbookId}
        fileName={state.workbook.originalFileName}
        initialSnapshot={state.workbook.workingSnapshot}
        readOnly={status !== "BORRADOR"}
        readOnlyLabel="Certificado elaborado — planilla congelada"
        onSave={(snapshot) => saveCertificateWorkbookSnapshot(workbookId, snapshot)}
        toolbar={
          <>
            <span className="flex items-center gap-1.5 truncate">
              <FileSpreadsheet size={13} /> {state.workbook.originalFileName}
            </span>
            <button type="button" onClick={handleDownloadOriginal} className="text-action shrink-0">
              Descargar original
            </button>
          </>
        }
      />
    </div>
  );
}
