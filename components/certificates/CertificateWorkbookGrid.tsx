"use client";

import "@univerjs/preset-sheets-core/lib/index.css";
import { useEffect, useRef, useState } from "react";
import { LocaleType, createUniver, merge, type IWorkbookData } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEsES from "@univerjs/preset-sheets-core/locales/es-ES";
import { saveCertificateWorkbookSnapshot } from "@/app/(internal)/projects/certificado-workbook-actions";
import { univerToWorkingSnapshot, workingSnapshotToUniver } from "@/lib/certificates/univer-adapter";
import type { WorkingSnapshot } from "@/lib/certificates/workbook-store";

const AUTOSAVE_DEBOUNCE_MS = 1500;

export type CertificateWorkbookGridProps = {
  workbookId: string;
  fileName: string;
  initialSnapshot: WorkingSnapshot;
  /** true desde ELABORADO en adelante — la base ya lo congela igual; esto
   * solo evita que el usuario intente editar algo que va a rechazar. */
  readOnly: boolean;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Fase 3 de "Certificados Excel-first" — la planilla embebida de un
 * certificado, montada con Univer sobre la copia de trabajo guardada en el
 * ERP (certificate_workbooks.working_snapshot). Ver memoria de proyecto
 * excel-first-certificados y la Fase 2 (POC de fidelidad de fórmulas contra
 * el Excel real de MAGY: 2893/2893 fórmulas, 100%).
 */
export function CertificateWorkbookGrid({ workbookId, fileName, initialSnapshot, readOnly }: CertificateWorkbookGridProps) {
  const containerId = `univer-container-${workbookId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Referencias estables — el efecto de montaje corre una sola vez (no
  // depende de initialSnapshot/readOnly, que no cambian en la vida del
  // componente: un workbookId nuevo es un componente nuevo, vía key).
  const initialSnapshotRef = useRef(initialSnapshot);
  const readOnlyRef = useRef(readOnly);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ES_ES,
      locales: { [LocaleType.ES_ES]: merge({}, sheetsCoreEsES) },
      presets: [
        UniverSheetsCorePreset({
          container: containerId,
          header: !readOnlyRef.current,
          toolbar: !readOnlyRef.current,
          footer: readOnlyRef.current ? false : undefined,
          formulaBar: !readOnlyRef.current,
        }),
      ],
    });

    const snapshot = workingSnapshotToUniver(initialSnapshotRef.current, workbookId);
    const fWorkbook = univerAPI.createWorkbook(snapshot as IWorkbookData);

    const scheduleSave = () => {
      if (readOnlyRef.current) return;
      setStatus("saving");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (disposed) return;
        try {
          const current = fWorkbook.save() as IWorkbookData;
          const nextSnapshot = univerToWorkingSnapshot(current, fileName);
          const result = await saveCertificateWorkbookSnapshot(workbookId, nextSnapshot);
          if (disposed) return;
          setStatus(result.error ? "error" : "saved");
        } catch {
          if (!disposed) setStatus("error");
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    };

    const disposable = readOnlyRef.current ? null : univerAPI.addEvent(univerAPI.Event.CommandExecuted, scheduleSave);

    return () => {
      disposed = true;
      if (saveTimer) clearTimeout(saveTimer);
      disposable?.dispose();
      univer.dispose();
    };
  }, [workbookId, containerId, fileName]);

  return (
    <div className="flex flex-col h-[70vh] min-h-[420px]">
      <div className="flex items-center justify-between h-7 px-1 text-[11px] text-[var(--muted)] shrink-0">
        <span>{fileName}</span>
        {readOnly ? (
          <span>Certificado elaborado — planilla de solo lectura</span>
        ) : (
          <span>
            {status === "saving" ? "Guardando…" : status === "saved" ? "Guardado" : status === "error" ? "No se pudo guardar" : ""}
          </span>
        )}
      </div>
      <div
        id={containerId}
        ref={containerRef}
        className="flex-1 min-h-0 border border-[var(--border)] rounded-lg overflow-hidden"
        style={readOnly ? { pointerEvents: "none" } : undefined}
      />
    </div>
  );
}
