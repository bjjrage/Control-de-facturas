"use client";

import "@univerjs/preset-sheets-core/lib/index.css";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
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
  /** true desde ELABORADO en adelante (o sesión cerrada): se puede recorrer
   * (scroll, hojas) pero no editar. La base ya lo congela igual. */
  readOnly: boolean;
  /** Dónde se guarda la copia de trabajo: el certificado o la sesión de
   * importación. La grilla no sabe a cuál pertenece. */
  onSave: (snapshot: WorkingSnapshot) => Promise<{ error: string | null }>;
  /** Acciones del ERP (Aplicar, Descargar) a la izquierda del estado. */
  toolbar?: ReactNode;
  readOnlyLabel?: string;
  /** Alto de la grilla; por defecto ocupa el alto útil de la pantalla. */
  heightClassName?: string;
  /** La grilla deja acá una función que guarda YA lo pendiente (sin esperar
   * el autoguardado) y devuelve si quedó guardado. "Aplicar" la llama antes
   * de procesar, para no aplicar una versión vieja de la planilla. */
  saveNowRef?: MutableRefObject<(() => Promise<boolean>) | null>;
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
  saveNowRef,
}: CertificateWorkbookGridProps) {
  const inlineHostRef = useRef<HTMLDivElement>(null);
  const fullHostRef = useRef<HTMLDivElement>(null);
  const mountElRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [maximized, setMaximized] = useState(false);
  const maximizedRef = useRef(maximized);
  // Referencias estables: el montaje corre una sola vez por workbookId (un
  // libro nuevo es un componente nuevo, vía key).
  const initialSnapshotRef = useRef(initialSnapshot);
  const readOnlyRef = useRef(readOnly);
  const onSaveRef = useRef(onSave);
  const saveNowRefRef = useRef(saveNowRef);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Pantalla completa: los paneles del ERP usan backdrop-filter, que atrapa
  // un position:fixed dentro del panel. En vez de eso, el nodo de Univer
  // (creado a mano, fuera del control de React) se MUEVE a una capa sobre
  // <body> y vuelve al salir — sin volver a montar la planilla.
  useLayoutEffect(() => {
    maximizedRef.current = maximized;
    const el = mountElRef.current;
    const host = maximized ? fullHostRef.current : inlineHostRef.current;
    if (el && host && el.parentElement !== host) host.appendChild(el);
    if (!maximized) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [maximized]);

  useEffect(() => {
    const host = maximizedRef.current ? fullHostRef.current : inlineHostRef.current;
    if (!host) return;
    let disposed = false;
    let ready = false;
    let dirty = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    // Univer monta su propio árbol de React DENTRO del elemento que se le
    // pasa. En desarrollo, React Strict Mode ejecuta este efecto dos veces
    // (monta, limpia, vuelve a montar); si las dos ejecuciones comparten un
    // id de contenedor, Univer lo busca con document.getElementById() y las
    // dos instancias escriben en el mismo nodo — al destruirse la primera se
    // lleva lo que dibujó la segunda y la grilla queda vacía sin ningún
    // error (confirmado en vivo: contenedor con tamaño pero 0 hijos). Cada
    // ejecución recibe su propio <div> real.
    const mountEl = document.createElement("div");
    mountEl.style.width = "100%";
    mountEl.style.height = "100%";
    host.appendChild(mountEl);
    mountElRef.current = mountEl;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ES_ES,
      locales: { [LocaleType.ES_ES]: merge({}, sheetsCoreEsES) },
      presets: [
        // Barra de formato, barra de fórmulas y pestañas de hojas siempre,
        // como en Excel. Congelada se ven igual (para leer fórmulas y
        // formatos) pero setEditable(false) rechaza cualquier cambio.
        UniverSheetsCorePreset({
          container: mountEl,
          header: true,
          toolbar: true,
          formulaBar: true,
        }),
      ],
    });

    const univerSnapshot = workingSnapshotToUniver(initialSnapshotRef.current, workbookId) as IWorkbookData;
    const fWorkbook = univerAPI.createWorkbook(univerSnapshot);
    // Si la primera hoja del libro está oculta (MAGY: "Julio", un mes
    // archivado), Univer la deja activa igual y la grilla se ve en blanco.
    // Se activa la primera hoja VISIBLE — no una fija por nombre, porque no
    // todo certificado tiene una hoja "CERTIFICADO".
    const firstVisibleSheetId = univerSnapshot.sheetOrder.find((id) => !univerSnapshot.sheets[id]?.hidden);
    if (firstVisibleSheetId) fWorkbook.setActiveSheet(firstVisibleSheetId);
    if (readOnlyRef.current) fWorkbook.setEditable(false);
    // Las mutaciones que Univer hace al montar el libro no son ediciones del
    // usuario: no disparan un guardado.
    const readyTimer = setTimeout(() => {
      ready = true;
    }, 500);

    const performSave = async (): Promise<boolean> => {
      if (disposed) return false;
      setStatus("saving");
      try {
        const nextSnapshot = {
          ...univerToWorkingSnapshot(fWorkbook.save() as IWorkbookData, fileName),
          // Univer no maneja los nombres definidos del Excel; se conservan.
          definedNames: initialSnapshotRef.current.definedNames,
        };
        const result = await onSaveRef.current(nextSnapshot);
        if (!result.error) dirty = false;
        if (!disposed) setStatus(result.error ? "error" : "saved");
        return !result.error;
      } catch {
        if (!disposed) setStatus("error");
        return false;
      }
    };

    const scheduleSave = () => {
      if (readOnlyRef.current || !ready) return;
      dirty = true;
      setStatus("saving");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void performSave(), AUTOSAVE_DEBOUNCE_MS);
    };

    const saveNowTarget = saveNowRefRef.current;
    if (saveNowTarget) {
      saveNowTarget.current = async () => {
        if (readOnlyRef.current) return true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        return dirty ? performSave() : true;
      };
    }

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
      if (saveNowTarget) saveNowTarget.current = null;
      disposable?.dispose();
      // Se saca el div propio del árbol YA, de forma síncrona: el dispose()
      // diferido de abajo nunca puede pisar un montaje más nuevo.
      mountEl.remove();
      if (mountElRef.current === mountEl) mountElRef.current = null;
      // univer.dispose() desmonta el React interno de Univer; llamado de
      // forma síncrona acá puede chocar con un render del árbol externo en
      // curso (confirmado en vivo: "Attempted to synchronously unmount a
      // root while React was already rendering", con el sondeo de la sesión
      // de importación). Diferido, solo libera memoria.
      queueMicrotask(() => univer.dispose());
    };
  }, [workbookId, fileName]);

  const bar = (
    <div className="flex items-center justify-between gap-2 min-h-9 px-1 text-[11px] text-[var(--muted)] shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">{toolbar}</div>
      <div className="flex items-center gap-3 shrink-0">
        <span>
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
        <button
          type="button"
          onClick={() => setMaximized((value) => !value)}
          title={maximized ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
          className="flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--border)] hover:bg-[var(--hover)]"
        >
          {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {maximized ? "Salir" : "Pantalla completa"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className={`flex flex-col ${heightClassName}`}>
        {maximized ? null : bar}
        <div
          ref={inlineHostRef}
          className={`flex-1 min-h-0 border border-[var(--border)] rounded-md overflow-hidden ${maximized ? "flex items-center justify-center text-[12px] text-[var(--muted)]" : ""}`}
        >
          {maximized ? "Planilla abierta en pantalla completa (Esc para volver)" : null}
        </div>
      </div>
      {maximized
        ? createPortal(
            <div className="fixed inset-0 z-[1000] flex flex-col bg-[var(--background)] p-3">
              {bar}
              <div ref={fullHostRef} className="flex-1 min-h-0 border border-[var(--border)] rounded-md overflow-hidden" />
            </div>,
            document.body
          )
        : null}
    </>
  );
}
