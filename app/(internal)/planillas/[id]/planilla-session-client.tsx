"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanillaGrid, type PlanillaGridRow } from "@/components/planillas/PlanillaGrid";
import type { PlanillaColumn } from "@/lib/planillas/types";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ConfirmStatus = "idle" | "confirming" | "conflict" | "error";

const AUTOSAVE_DEBOUNCE_MS = 900;

export function PlanillaSessionClient({
  planillaId,
  estado,
  columns,
  initialRows,
  volverUrl,
}: {
  planillaId: string;
  estado: "draft" | "confirmed" | "cancelled";
  columns: PlanillaColumn[];
  initialRows: PlanillaGridRow[];
  volverUrl: string;
}) {
  const router = useRouter();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>("idle");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowsRef = useRef<PlanillaGridRow[] | null>(null);
  const inFlightRef = useRef(false);

  const isReadOnly = estado !== "draft";

  async function flushSave() {
    if (inFlightRef.current) return; // el próximo debounce reintentará con el snapshot más nuevo
    const rows = pendingRowsRef.current;
    if (rows === null) return;
    pendingRowsRef.current = null;
    inFlightRef.current = true;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/planillas/${planillaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      // No se pierde el cambio: vuelve a la cola para el próximo intento.
      pendingRowsRef.current = rows;
    } finally {
      inFlightRef.current = false;
      if (pendingRowsRef.current !== null) {
        // Llegaron cambios (o falló) mientras guardábamos — programar otro flush.
        scheduleFlush();
      }
    }
  }

  function scheduleFlush() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
  }

  function handleGridChange(rows: PlanillaGridRow[]) {
    if (isReadOnly) return;
    pendingRowsRef.current = rows;
    scheduleFlush();
  }

  // Autosave al cerrar/navegar fuera con cambios pendientes sin confirmar aún
  // (best-effort — sendBeacon no espera respuesta, pero evita perder el
  // último tramo de edición si el debounce todavía no disparó).
  useEffect(() => {
    function onBeforeUnload() {
      if (pendingRowsRef.current !== null && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ rows: pendingRowsRef.current })], { type: "application/json" });
        navigator.sendBeacon(`/api/planillas/${planillaId}`, blob);
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [planillaId]);

  async function handleConfirmar() {
    setConfirmStatus("confirming");
    setConfirmError(null);
    // Asegura que el último tramo editado ya esté guardado antes de confirmar.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (pendingRowsRef.current !== null) await flushSave();

    try {
      const res = await fetch(`/api/planillas/${planillaId}/confirmar`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConfirmStatus("conflict");
        setConfirmError(body.error ?? "Los datos de origen cambiaron desde que se abrió la planilla.");
        return;
      }
      if (!res.ok) {
        setConfirmStatus("error");
        setConfirmError(body.error ?? "No se pudo confirmar la planilla.");
        return;
      }
      router.push(volverUrl);
      router.refresh();
    } catch {
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
        <PlanillaGrid columns={columns} initialRows={initialRows} onChange={handleGridChange} readOnly={isReadOnly} />
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
