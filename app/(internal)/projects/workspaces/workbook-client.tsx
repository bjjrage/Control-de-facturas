"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IWorkbookData } from "@univerjs/presets";
import { Button } from "@/components/ui/button";
import { createProjectWorkspace, saveProjectWorkspace } from "./actions";

const WorkbookGrid = dynamic(() => import("@/components/projects/ProjectUniverWorkbookGrid").then(module => module.ProjectUniverWorkbookGrid), { ssr: false, loading: () => <p className="p-5 text-sm">Abriendo Univer con sus herramientas…</p> });

export function ProjectWorkbookClient({ id, name, revision, workbook, isNew = false, isQa }: {
  id: string; name: string; revision: number; workbook: IWorkbookData; isNew?: boolean; isQa: boolean;
}) {
  const router = useRouter();
  const [workspaceId] = useState(id);
  const [initialWorkbook] = useState(workbook);
  const [title, setTitle] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(title);
  const revisionRef = useRef(revision);
  const createPromise = useRef<Promise<boolean> | null>(null);
  const saveNow = useRef<((force?: boolean) => Promise<boolean>) | null>(null);

  async function ensureCreated(): Promise<boolean> {
    if (revisionRef.current > 0) return true;
    if (createPromise.current) return createPromise.current;
    createPromise.current = (async () => {
      try {
        const result = await createProjectWorkspace(workspaceId);
        if (result.error || !result.revision) { setError(result.error); return false; }
        revisionRef.current = result.revision;
        setReady(true); setError(null);
        window.history.replaceState(null, "", `/projects/workspaces/${workspaceId}`);
        return true;
      } catch { setError("No se pudo crear el workspace. Probá Guardar ahora."); return false; }
      finally { createPromise.current = null; }
    })();
    return createPromise.current;
  }

  useEffect(() => {
    if (isNew) void ensureCreated();
    // One document identity per mounted editor. The ensureCreated promise also
    // makes React Strict Mode's repeated effect idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function flush() {
    setBusy(true);
    try {
      if (!await ensureCreated()) return false;
      return await saveNow.current?.(true) ?? false;
    } finally { setBusy(false); }
  }

  const toolbar = <div className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-amber-500">{isQa ? "QA · " : ""}Obra en preparación</span>
    <input aria-label="Nombre de la obra" value={title} maxLength={200} className="w-56 rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--foreground)]"
      onChange={event => { setTitle(event.target.value); titleRef.current = event.target.value; }} onBlur={() => { if (titleRef.current.trim()) void flush(); }} />
    <Button type="button" size="sm" disabled={busy} onClick={() => void flush()}>{busy ? "Guardando…" : "Guardar ahora"}</Button>
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={async () => { if (await flush()) { router.push("/projects/workspaces"); router.refresh(); } }}>Mis trabajos</Button>
    <span className="text-xs text-[var(--muted)]">Cinco hojas vinculadas · Guardado automático{!ready ? " · Creando libro…" : ""}</span>
    {error ? <p role="alert" className="max-w-3xl text-xs text-red-400">{error}</p> : null}
  </div>;

  return <WorkbookGrid workbookId={workspaceId} fileName={name} initialWorkbook={initialWorkbook} readOnly={false} startMaximized saveNowRef={saveNow}
    toolbar={toolbar} heightClassName="h-[calc(100dvh-160px)] min-h-[600px]" onSave={async data => {
      if (!await ensureCreated()) return { error: "No se pudo crear el libro." };
      const next = { ...data, name: titleRef.current.trim() || "Obra sin nombre" };
      const result = await saveProjectWorkspace(workspaceId, revisionRef.current, next);
      if (result.error) setError(result.error);
      else { revisionRef.current = result.revision!; setError(null); }
      return { error: result.error };
    }} />;
}
