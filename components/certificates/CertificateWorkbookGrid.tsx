"use client";

import "@univerjs/preset-sheets-core/lib/index.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CommandType, LocaleType, createUniver, merge, type IWorkbookData } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEsES from "@univerjs/preset-sheets-core/locales/es-ES";
import { univerToWorkingSnapshot, workingSnapshotToUniver } from "@/lib/certificates/univer-adapter";
import type { WorkingSnapshot } from "@/lib/certificates/workbook-store";

const AUTOSAVE_DEBOUNCE_MS = 1500;

export type CertificateWorkbookGridProps = {
  workbookId: string;
  fileName: string;
  initialSnapshot: WorkingSnapshot;
  /** true desde ELABORADO en adelante (o sesión cerrada) — la base ya lo
   * congela igual; esto solo evita que el usuario edite algo que se rechaza. */
  readOnly: boolean;
  /** Dónde se guarda la copia de trabajo: el certificado o la sesión de
   * importación. La grilla no sabe a cuál pertenece. */
  onSave: (snapshot: WorkingSnapshot) => Promise<{ error: string | null }>;
  /** Acciones del ERP (Analizar, Aplicar, Descargar) a la izquierda del estado. */
  toolbar?: ReactNode;
  readOnlyLabel?: string;
  /** Alto de la grilla; por defecto ocupa el alto útil de la pantalla. */
  heightClassName?: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * La planilla embebida (Univer) sobre la copia de trabajo guardada en el ERP.
 * Fase 2 probó la fidelidad contra el Excel real de MAGY (2893/2893
 * fórmulas). Ver [[excel-first-certificados]].
 */
export function CertificateWorkbookGrid({
  workbookId,
  fileName,
  initialSnapshot,
  readOnly,
  onSave,
  toolbar,
  readOnlyLabel = "Planilla de solo lectura",
  heightClassName = "h-[calc(100vh-220px)] min-h-[480px]",
}: CertificateWorkbookGridProps) {
  const containerId = `univer-container-${workbookId}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Referencias estables: el montaje corre una sola vez por workbookId (un
  // libro nuevo es un componente nuevo, vía key).
  const initialSnapshotRef = useRef(initialSnapshot);
  const readOnlyRef = useRef(readOnly);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let ready = false;
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

    const univerSnapshot = workingSnapshotToUniver(initialSnapshotRef.current, workbookId) as IWorkbookData;
    const fWorkbook = univerAPI.createWorkbook(univerSnapshot);
    // Si la primera hoja del libro está oculta (frecuente: un Excel de obra
    // suele traer meses anteriores archivados como hojas ocultas antes de la
    // hoja "viva" — confirmado en vivo con MAGY, cuya primera hoja es
    // "Julio", oculta), Univer la deja como activa igual y la grilla se ve
    // en blanco. Se activa la primera hoja VISIBLE del propio libro en su
    // lugar — no una fija por nombre, porque no todo certificado tiene una
    // hoja "CERTIFICADO".
    const firstVisibleSheetId = univerSnapshot.sheetOrder.find((id) => !univerSnapshot.sheets[id]?.hidden);
    if (firstVisibleSheetId) fWorkbook.setActiveSheet(firstVisibleSheetId);
    // Las mutaciones que Univer hace al montar el libro no son ediciones del
    // usuario: no disparan un guardado.
    const readyTimer = setTimeout(() => {
      ready = true;
    }, 500);

    const scheduleSave = () => {
      if (readOnlyRef.current || !ready) return;
      setStatus("saving");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (disposed) return;
        try {
          const nextSnapshot = univerToWorkingSnapshot(fWorkbook.save() as IWorkbookData, fileName);
          const result = await onSaveRef.current(nextSnapshot);
          if (!disposed) setStatus(result.error ? "error" : "saved");
        } catch {
          if (!disposed) setStatus("error");
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    };

    // Solo MUTACIONES (cambios de datos): mover la selección, hacer scroll o
    // cambiar de hoja también son comandos, y no deben guardar nada.
    const disposable = readOnlyRef.current
      ? null
      : univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
          if (event.type === CommandType.MUTATION) scheduleSave();
        });

    return () => {
      disposed = true;
      clearTimeout(readyTimer);
      if (saveTimer) clearTimeout(saveTimer);
      disposable?.dispose();
      // univer.dispose() desmonta el árbol de React interno de Univer. Si se
      // llama de forma síncrona acá (dentro de la limpieza de ESTE efecto),
      // puede coincidir con un render del árbol EXTERNO ya en curso —
      // confirmado en vivo: "Attempted to synchronously unmount a root
      // while React was already rendering" (ocurre con el sondeo de la
      // sesión de importación, que re-renderiza el padre cada 3s). Diferir
      // la destrucción a un microtask saca esa llamada del paso de commit
      // de React, sin cambiar nada del comportamiento visible.
      queueMicrotask(() => univer.dispose());
    };
  }, [workbookId, containerId, fileName]);

  return (
    <div className={`flex flex-col ${heightClassName}`}>
      <div className="flex items-center justify-between gap-2 h-9 px-1 text-[11px] text-[var(--muted)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">{toolbar}</div>
        <span className="shrink-0">
          {readOnly
            ? readOnlyLabel
            : status === "saving"
              ? "Guardando…"
              : status === "saved"
                ? "Guardado"
                : status === "error"
                  ? "No se pudo guardar"
                  : "Sin cambios"}
        </span>
      </div>
      <div
        id={containerId}
        ref={containerRef}
        className="flex-1 min-h-0 border border-[var(--border)] rounded-md overflow-hidden"
        style={readOnly ? { pointerEvents: "none" } : undefined}
      />
    </div>
  );
}
