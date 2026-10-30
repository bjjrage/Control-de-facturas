"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanillaGridRow } from "@/components/planillas/PlanillaGrid";
import { UniverPlanillaGrid as PlanillaGrid } from "@/components/planillas/UniverPlanillaGrid";
import type { PlanillaColumn } from "@/lib/planillas/types";
import { DraftSaveQueue } from "@/lib/planillas/save-queue";
import { WorkspaceApuPanel } from "@/components/planillas/WorkspaceApuPanel";
import { draftSignature } from "@/lib/planillas/draft-signature";
import { MaterialsWorkspaceView, ScheduleWorkspaceView } from "@/components/planillas/LinkedWorkspaceViews";
import type { WorkspaceMaterial } from "@/lib/workbook-interpretation/import-workspace";
import type { CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { getWorkspaceMaterials } from "../../projects/import-workspace-actions";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ConfirmStatus = "idle" | "confirming" | "conflict" | "error";

const AUTOSAVE_DEBOUNCE_MS = 900;
const subscribeHydration = () => () => {};

export function PlanillaSessionClient({
  planillaId,
  initialVersion,
  projectId,
  referenceQuantities = false,
  linkedCandidate,
  initialMaterials = [],
  estado,
  columns,
  initialRows,
  volverUrl,
}: {
  planillaId: string;
  initialVersion: string;
  projectId?: string;
  referenceQuantities?: boolean;
  linkedCandidate?: CanonicalImportCandidate;
  initialMaterials?: WorkspaceMaterial[];
  estado: "draft" | "confirmed" | "cancelled";
  columns: PlanillaColumn[];
  initialRows: PlanillaGridRow[];
  volverUrl: string;
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus>("idle");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridFlushRef = useRef<(() => Promise<void>) | null>(null);
  const [rows, setRows] = useState(initialRows);
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?._rowId ?? null);
  const [showApu, setShowApu] = useState(true);
  const [tab, setTab] = useState("Partidas");
  const [materials, setMaterials] = useState(initialMaterials);
  const signatureRef = useRef(draftSignature(initialRows, columns));
  const queueRef = useRef<DraftSaveQueue<PlanillaGridRow> | null>(null);
  if (queueRef.current === null) queueRef.current = new DraftSaveQueue(initialVersion, async (rows, expectedVersion) => {
    const res = await fetch(`/api/planillas/${planillaId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, expectedVersion }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "No se pudo guardar. Reintentá antes de confirmar.");
    return body.updated_at;
  });

  const isReadOnly = estado !== "draft";

  const flushSave = useCallback(async () => {
    await gridFlushRef.current?.();
    const queue = queueRef.current!;
    if (!queue.dirty) return;
    setSaveStatus("saving");
    try {
      await queue.flush();
      setConfirmError(null);
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("error");
      setConfirmError(error instanceof Error ? error.message : "Error al guardar.");
      throw error;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void flushSave().catch(() => {}); }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

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
      if (isReadOnly) return;
      const signature = draftSignature(rows, columns);
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      queueRef.current!.enqueue(rows);
      setRows(rows);
      setSaveStatus("idle");
      scheduleFlush();
    },
    [isReadOnly, scheduleFlush, columns]
  );

  // Autosave al cerrar/navegar fuera con cambios pendientes sin confirmar aún
  // (best-effort — sendBeacon no espera respuesta, pero evita perder el
  // último tramo de edición si el debounce todavía no disparó).
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (queueRef.current?.dirty) { event.preventDefault(); event.returnValue = ""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [planillaId]);

  async function handleConfirmar() {
    setConfirmStatus("confirming");
    setConfirmError(null);
    // Asegura que el último tramo editado ya esté guardado antes de confirmar.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    try {
      await flushSave();
      const res = await fetch(`/api/planillas/${planillaId}/confirmar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: queueRef.current!.version }) });
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

  return mounted ? createPortal(
    <div className="fixed inset-0 z-[35] flex flex-col bg-[var(--background)]">
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--panel)]">
          <Button variant="ghost" onClick={async () => { try { await flushSave(); router.push(volverUrl); } catch {} }} title="Guardar y volver">
          <ArrowLeft size={15} />
        </Button>
        <span className="text-[13px] font-semibold">Workspace de obra · Cómputo y presupuesto</span>
        <SaveIndicator status={saveStatus} readOnly={isReadOnly} />
        <div className="flex-1" />
        {saveStatus === "error" ? <Button onClick={() => { void flushSave().catch(() => {}); }}>Reintentar guardado</Button> : null}
        <Button variant="ghost" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({ planillaId, revision: queueRef.current!.version, rows }, null, 2)], { type: "application/json" }));
          const a = document.createElement("a"); a.href = url; a.download = `borrador-${planillaId}.json`; a.click(); URL.revokeObjectURL(url);
        }}>Descargar borrador</Button>
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
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border)] text-sm">
        {linkedCandidate ? <nav aria-label="Vistas del workspace" className="flex gap-2">{["Partidas", "APU", "Materiales", "Cronograma"].map(name => <button role="tab" aria-selected={tab === name} key={name} className={`rounded px-3 py-2 ${tab === name ? "bg-sky-500/20 text-sky-200" : ""}`} onClick={async () => { try { await flushSave(); setTab(name); if (name === "Materiales" && projectId) setMaterials(await getWorkspaceMaterials(projectId)); } catch (cause) { setConfirmError(cause instanceof Error ? cause.message : "No se pudo abrir la vista."); } }}>{name}</button>)}</nav> : <span>Cómputo · Presupuesto</span>}
        {projectId ? <Button variant="secondary" onClick={() => setShowApu(v => !v)} aria-expanded={showApu}>APU y materiales</Button> : null}
        <span>{rows.filter(r => !r._deleted && String(r.description ?? "").trim()).length} partidas · Borrador</span>
      </div>
      {referenceQuantities ? <p role="status" className="px-4 py-2 text-xs text-amber-300">Cantidades referenciales del archivo: los importes y necesidades son una simulación hasta validar el cómputo definitivo. Editar el borrador no certifica esas cantidades automáticamente.</p> : null}
      <div className={tab === "Partidas" ? "flex flex-1 min-h-0" : "hidden"}>
        <div className="flex-1 min-w-0 p-3"><PlanillaGrid columns={columns} initialRows={initialRows} onChange={handleGridChange} onSelectRow={setSelectedId} flushPendingRef={gridFlushRef} readOnly={isReadOnly || confirmStatus === "confirming"} /></div>
        {projectId && showApu && tab === "Partidas" ? <div className="w-[420px] max-w-[45vw] border-l border-[var(--border)] overflow-auto"><WorkspaceApuPanel key={selectedId} projectId={projectId} row={rows.find(r => r._rowId === selectedId && !r._deleted)} editable={!isReadOnly && confirmStatus !== "confirming"} /></div> : null}
      </div>
      {linkedCandidate && tab !== "Partidas" ? <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex gap-3 items-center border-b border-[var(--border)] p-3 text-xs"><label htmlFor="operational-partida">Partida activa</label><select id="operational-partida" aria-label="Partida activa" value={selectedId ?? ""} onChange={e => setSelectedId(e.target.value)} className="max-w-3xl flex-1 rounded border p-2">{rows.filter(row => !row._deleted && String(row.description ?? "").trim()).map(row => <option key={row._rowId} value={row._rowId}>{String(row.code)} · {String(row.description)}</option>)}</select></div>
        {tab === "APU" && projectId ? <WorkspaceApuPanel key={selectedId} projectId={projectId} row={rows.find(row => row._rowId === selectedId)} editable={!isReadOnly && confirmStatus !== "confirming"} /> : null}
        {tab === "Materiales" ? <MaterialsWorkspaceView materials={materials} rows={rows} onSelect={id => { setSelectedId(id); setTab("APU"); }} /> : null}
        {tab === "Cronograma" ? <ScheduleWorkspaceView candidate={linkedCandidate} rows={rows} onSelect={id => { setSelectedId(id); setTab("APU"); }} /> : null}
      </div> : null}
    </div>, document.body
  ) : null;
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
        <AlertTriangle size={12} /> Cambios pendientes · Revisá el error y reintentá
      </span>
    );
  }
  return (
    <span className="text-[11px] text-[var(--ok)] flex items-center gap-1">
      <Check size={12} /> Guardado
    </span>
  );
}
