"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanillaGrid, type PlanillaGridRow } from "@/components/planillas/PlanillaGrid";
import { PlanillaSaveQueue } from "@/lib/planillas/save-queue";
import type { PlanillaColumn } from "@/lib/planillas/types";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ConfirmStatus = "idle" | "confirming" | "conflict" | "error";

const AUTOSAVE_DEBOUNCE_MS = 900;
const PLANILLA_SAVE_CONFLICT_MESSAGE =
  "La planilla cambió en otra sesión. Tus cambios siguen pendientes; reabre la planilla para comparar antes de confirmar.";

export function PlanillaSessionClient({
  planillaId,
  estado,
  updatedAt,
  columns,
  initialRows,
  volverUrl,
}: {
  planillaId: string;
  estado: "draft" | "confirmed" | "cancelled";
  updatedAt: string;
  columns: PlanillaColumn[];
  initialRows: PlanillaGridRow[];
  volverUrl: string;
}) {
  const router = useRouter();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>("idle");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef(new PlanillaSaveQueue<PlanillaGridRow[]>());
  const updatedAtRef = useRef(updatedAt);
  const saveConflictRef = useRef(false);
  const confirmingRef = useRef(false);

  const isReadOnly = estado !== "draft";

  // Ref indirecta para romper la dependencia circular flushSave↔scheduleFlush
  // sin sacrificar la estabilidad de referencia de ninguna de las dos (ver
  // comentario en handleGridChange más abajo sobre por qué esa estabilidad
  // importa).
  const scheduleFlushRef = useRef<() => void>(() => {});

  const saveRows = useCallback(async (rows: PlanillaGridRow[]) => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, expectedUpdatedAt: updatedAtRef.current }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        saveConflictRef.current = true;
        setConfirmError(PLANILLA_SAVE_CONFLICT_MESSAGE);
        throw new Error("planilla snapshot conflict");
      }
      if (!res.ok) throw new Error("save failed");
      if (typeof body.updated_at !== "string") throw new Error("save response is missing updated_at");
      updatedAtRef.current = body.updated_at;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      throw new Error("planilla snapshot save failed");
    }
  }, [planillaId]);

  const flushSave = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (saveConflictRef.current) return false;

    const saved = await saveQueueRef.current.flush(saveRows);
    if (!saved && saveQueueRef.current.hasPending && !saveConflictRef.current) {
      // Los errores transitorios conservan el último snapshot y reintentan;
      // un conflicto de versión requiere reabrir la sesión y nunca se pisa.
      scheduleFlushRef.current();
    }
    return saved && saveQueueRef.current.isIdle;
  }, [saveRows]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => {
    scheduleFlushRef.current = scheduleFlush;
  }, [scheduleFlush]);

  // useCallback con referencia estable a propósito: PlanillaGrid está
  // memoizado (React.memo) precisamente para NO re-renderizar — y por lo
  // tanto no volver a llamar hotInstance.updateSettings(), que dispara un
  // recálculo de HyperFormula y por ende un afterChange espurio — cada vez
  // que este componente se re-renderiza (p. ej. el indicador de saveStatus
  // pasando a "saved"). Si `onChange` tuviera una referencia nueva en cada
  // render, el memo de PlanillaGrid no serviría de nada: guardar → re-render
  // → updateSettings → recálculo → afterChange → onChange → guardar de
  // nuevo — bucle perpetuo pausado solo por el debounce de autosave,
  // reproducido y confirmado en vivo (~2-3 PATCH/seg indefinidamente) antes
  // de este fix.
  const handleGridChange = useCallback(
    (rows: PlanillaGridRow[]) => {
      if (isReadOnly || confirmingRef.current) return;
      saveQueueRef.current.enqueue(rows);
      scheduleFlush();
    },
    [isReadOnly, scheduleFlush]
  );

  // Autosave al cerrar/navegar fuera con cambios pendientes sin confirmar aún
  // (best-effort — sendBeacon no espera respuesta, pero evita perder el
  // último tramo de edición si el debounce todavía no disparó).
  useEffect(() => {
    function onBeforeUnload() {
      const rows = saveQueueRef.current.latestUnsentSnapshot;
      if (rows !== null && navigator.sendBeacon) {
        const blob = new Blob(
          [JSON.stringify({ rows, expectedUpdatedAt: updatedAtRef.current })],
          { type: "application/json" }
        );
        navigator.sendBeacon(`/api/planillas/${planillaId}`, blob);
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [planillaId]);

  async function handleConfirmar() {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirmStatus("confirming");
    setConfirmError(null);
    // Espera el PATCH que ya estuviera en vuelo y drena cualquier edición más
    // reciente. Si falla o hay conflicto de versión, nunca confirma el snapshot viejo.
    const saved = await flushSave();
    if (!saved) {
      confirmingRef.current = false;
      setConfirmStatus("error");
      setConfirmError(
        saveConflictRef.current
          ? PLANILLA_SAVE_CONFLICT_MESSAGE
          : "No se pudieron guardar los cambios pendientes; no se confirmó la planilla."
      );
      return;
    }

    try {
      const res = await fetch(`/api/planillas/${planillaId}/confirmar`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        confirmingRef.current = false;
        setConfirmStatus("conflict");
        setConfirmError(body.error ?? "Los datos de origen cambiaron desde que se abrió la planilla.");
        return;
      }
      if (!res.ok) {
        confirmingRef.current = false;
        setConfirmStatus("error");
        setConfirmError(body.error ?? "No se pudo confirmar la planilla.");
        return;
      }
      router.push(volverUrl);
      router.refresh();
    } catch {
      confirmingRef.current = false;
      setConfirmStatus("error");
      setConfirmError("Se cortó la conexión al confirmar.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]">
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--panel)]">
        <Button variant="ghost" onClick={() => router.push(volverUrl)} title="Volver sin confirmar">
          <ArrowLeft size={15} />
        </Button>
        <span className="text-[13px] font-semibold">Planilla de trabajo</span>
        <SaveIndicator status={saveStatus} readOnly={isReadOnly} />
        <div className="flex-1" />
        {confirmError ? (
          <span className="text-[12px] text-[var(--error)] flex items-center gap-1 max-w-md truncate">
            <AlertTriangle size={13} className="shrink-0" /> {confirmError}
          </span>
        ) : null}
        {!isReadOnly ? (
          <Button onClick={handleConfirmar} disabled={confirmStatus === "confirming"}>
            {confirmStatus === "confirming" ? "Confirmando…" : "Confirmar"}
          </Button>
        ) : (
          <span className="text-[12px] text-[var(--muted)]">
            Planilla {estado === "confirmed" ? "confirmada" : "cancelada"} — solo lectura
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 p-3">
        <PlanillaGrid
          columns={columns}
          initialRows={initialRows}
          onChange={handleGridChange}
          readOnly={isReadOnly || confirmStatus === "confirming"}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ status, readOnly }: { status: SaveStatus; readOnly: boolean }) {
  if (readOnly) return null;
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="text-[11px] text-[var(--muted)] flex items-center gap-1">
        <Loader2 size={12} className="animate-spin" /> Guardando…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-[11px] text-[var(--error)] flex items-center gap-1">
        <AlertTriangle size={12} /> Error al guardar — reintentando
      </span>
    );
  }
  return (
    <span className="text-[11px] text-[var(--ok)] flex items-center gap-1">
      <Check size={12} /> Guardado
    </span>
  );
}
