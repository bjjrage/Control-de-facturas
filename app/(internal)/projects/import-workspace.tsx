"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { UniverPlanillaGrid } from "@/components/planillas/UniverPlanillaGrid";
import { SourceApuView, MaterialsWorkspaceView, ScheduleWorkspaceView, displayWorkspaceNumber as num } from "@/components/planillas/LinkedWorkspaceViews";
import { importRows, importBlockingIssues, sourceMaterials, validateImportDraft, type ImportWorkspaceDraft } from "@/lib/workbook-interpretation/import-workspace";
import { DraftSaveQueue } from "@/lib/planillas/save-queue";
import { draftSignature } from "@/lib/planillas/draft-signature";
import type { PlanillaColumn, PlanillaRow } from "@/lib/planillas/types";
import { getImportWorkspace, getImportSourceSnapshot, getImportOriginalUrl, openImportedProjectWorkspace, type ImportWorkspaceView } from "./import-workspace-actions";
import { decodeBrowserSnapshot } from "@/lib/certificates/browser-snapshot";
import { createProjectFromWorkbook } from "./actions";
import type { WorkingSnapshot } from "@/lib/certificates/workbook-store";

const SourceGrid = dynamic(() => import("@/components/certificates/CertificateWorkbookGrid").then(m => m.CertificateWorkbookGrid), { ssr: false });
const columns: PlanillaColumn[] = [
  { key: "code", label: "Código", type: "text", width: 100, readOnly: true },
  { key: "description", label: "Descripción", type: "text", width: 380, readOnly: true },
  { key: "unit", label: "Unidad", type: "text", width: 80, readOnly: true },
  { key: "quantity", label: "Cantidad", type: "numeric", width: 120 },
  { key: "unit_price", label: "Precio adoptado", type: "numeric", width: 140 },
  { key: "subtotal", label: "Subtotal", type: "readonly-numeric", width: 140, readOnly: true, formulaTemplate: "=D{row}*E{row}" },
];
const tabs = ["Partidas", "APU", "Materiales", "Cronograma", "Original", "Revisión"] as const;
type Tab = typeof tabs[number];

const subscribeHydration = () => () => {};
export function ImportWorkspace({ initialSession }: { initialSession: ImportWorkspaceView }) {
  const mounted = useSyncExternalStore(subscribeHydration, () => true, () => false);
  return mounted ? createPortal(<ImportWorkspaceContent initialSession={initialSession} />, document.body) : null;
}

function ImportWorkspaceContent({ initialSession }: { initialSession: ImportWorkspaceView }) {
  const [session, setSession] = useState(initialSession);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const analyzing = session.status === "UPLOADED" || session.status === "ANALYZING";
  useEffect(() => {
    if (!analyzing) return;
    let active = true;
    const timer = setInterval(() => { void getImportWorkspace(session.id).then(next => { if (active && next) setSession(next); }).catch(() => { if (active) setError("No se pudo consultar el análisis. El archivo sigue guardado; podés volver a abrirlo."); }); }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [analyzing, session.id]);
  if (session.candidate && session.interpretation && !analyzing) return <ReadyImportWorkspace key={`${session.id}-${session.analyzedAt}`} session={session} />;
  return <main className="fixed inset-0 z-[35] flex flex-col bg-[var(--background)] p-6 space-y-6" aria-label="Workspace de importación">
    <header className="flex gap-4 items-center"><Button variant="secondary" onClick={() => router.push("/projects")}>Guardar y volver</Button><h1>Workspace de obra · {session.originalFileName}</h1></header>
    <nav className="flex gap-6">{tabs.map(tab => <span key={tab}>{tab}</span>)}</nav>
    <p role="status">{analyzing ? "Archivo guardado. Luna está vinculando partidas, APU, materiales y cronograma. Podés salir y retomar desde Obras." : session.analysisError ?? "El análisis necesita revisión."}</p>
    {error ? <p role="alert">{error}</p> : null}
    {!analyzing ? <Button onClick={async () => { const response = await fetch(`/api/import-sessions/${session.id}/analyze`, { method: "POST" }); if (response.ok) { setError(null); setSession({ ...session, status: "ANALYZING" }); } else setError("No se pudo iniciar el análisis."); }}>Reintentar análisis</Button> : null}
    <OriginalImportView id={session.id} fileName={session.originalFileName} />
  </main>;
}

function ReadyImportWorkspace({ session }: { session: ImportWorkspaceView }) {
  const candidate = session.candidate!;
  const interpretation = session.interpretation!;
  const [initial] = useState<ImportWorkspaceDraft>(() => session.workspaceDraft?.rows ? session.workspaceDraft : {
    rows: importRows(candidate) as ImportWorkspaceDraft["rows"], name: String(interpretation.project.name.value ?? ""), code: String(interpretation.project.code.value ?? ""),
    regime: session.suggestedRegime ?? "", referenceQuantities: true, applySchedule: true,
    applyCertificate: !candidate.linkedRecipes?.recipes.length && candidate.certificate.status === "SAFE_TO_APPLY",
    applyStaff: true, applyWeather: true, applyExecution: true,
  });
  const [draft, setDraft] = useState(initial);
  const latest = useRef(draft);
  const [tab, setTab] = useState<Tab>("Partidas");
  const [selectedId, setSelectedId] = useState(draft.rows[0]?._rowId ?? "");
  const [status, setStatus] = useState("Guardado");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ section: string; reason: string }[]>([]);
  const flushGrid = useRef<(() => Promise<void>) | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const queue = useRef<DraftSaveQueue<ImportWorkspaceDraft> | null>(null);
  if (queue.current === null) queue.current = new DraftSaveQueue(String(session.workingRevision), async ([value], revision) => {
    const response = await fetch(`/api/import-sessions/${session.id}/workspace`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: Number(revision), draft: value }) });
    const result = await response.json();
    if (result.error || result.revision === undefined) throw new Error(result.error ?? "No se pudo guardar.");
    return String(result.revision);
  });
  const save = useCallback(async () => {
    await flushGrid.current?.();
    if (!queue.current!.dirty) return;
    setStatus("Guardando…");
    try { await queue.current!.flush(); setStatus("Guardado"); setError(null); }
    catch (cause) { setStatus("Cambios pendientes"); setError(cause instanceof Error ? cause.message : "No se pudo guardar."); throw cause; }
  }, []);
  const update = useCallback((next: ImportWorkspaceDraft) => {
    latest.current = next; setDraft(next); queue.current!.enqueue([next]); setStatus("Cambios pendientes");
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void save().catch(() => {}); }, 900);
  }, [save]);
  const handleRows = useCallback((rows: PlanillaRow[]) => {
    if (draftSignature(rows, columns) === draftSignature(latest.current.rows, columns)) return;
    try { update(validateImportDraft({ ...latest.current, rows }, candidate)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar el cómputo."); }
  }, [candidate, update]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (queue.current!.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("beforeunload", unload); if (debounce.current) clearTimeout(debounce.current); };
  }, []);
  const row = draft.rows.find(row => row._rowId === selectedId);
  const total = draft.rows.reduce((sum, row) => sum + (row.quantity ?? 0) * (row.unit_price ?? 0), 0);
  const materials = sourceMaterials(candidate);
  const selectApu = (id: string) => { setSelectedId(id); setTab("APU"); };
  async function create() {
    setCreating(true); setError(null);
    try {
      await save();
      const current = latest.current;
      const form = new FormData();
      form.set("session_id", session.id); form.set("expected_revision", queue.current!.version);
      form.set("name_override", current.name); form.set("code_override", current.code); form.set("contract_regime", current.regime);
      form.set("quantity_status", current.referenceQuantities ? "REFERENCE" : "CONFIRMED");
      form.set("apply_recipes", candidate.linkedRecipes?.recipes.length ? "1" : "0");
      for (const [key, value] of Object.entries({ apply_schedule: current.applySchedule, apply_certificate: current.applyCertificate, apply_staff: current.applyStaff, apply_weather: current.applyWeather, apply_execution: current.applyExecution })) form.set(key, value ? "1" : "0");
      const result = await createProjectFromWorkbook(form);
      if (result.error || !result.projectId) throw new Error(result.error ?? "No se pudo crear la obra.");
      setCreatedId(result.projectId); setPending(result.pending ?? []);
      if (!result.pending?.length) router.replace(await openImportedProjectWorkspace(result.projectId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear la obra."); }
    finally { setCreating(false); }
  }
  const invalid = importBlockingIssues(candidate).length > 0 || Boolean(error) || session.analysisStale || !draft.name.trim() || !draft.code.trim() || !draft.regime || candidate.linkedRecipes?.issues.length || !draft.rows.length || draft.rows.some(item => !item.code || item.quantity === null || item.unit_price === null) || new Set(candidate.budgetItems.map(item => item.code)).size !== candidate.budgetItems.length;
  return <main className="fixed inset-0 z-[35] flex flex-col bg-[var(--background)]" aria-label="Workspace de importación">
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-3">
      <Button variant="secondary" disabled={creating} onClick={() => { void save().then(() => router.push("/projects")).catch(() => {}); }}>Guardar y volver</Button>
      <div className="min-w-0 flex-1"><h1 className="font-semibold">Workspace de obra · Importación</h1><p className="truncate text-xs text-[var(--muted)]">{session.originalFileName}</p></div>
      <span role="status" className="text-xs">{status}</span><Button variant="secondary" disabled={creating} onClick={() => { void save().catch(() => {}); }}>Guardar borrador</Button>
      <Button variant="ghost" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ sessionId: session.id, revision: queue.current!.version, draft: latest.current }, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `borrador-importacion-${session.id}.json`; link.click(); URL.revokeObjectURL(url);
      }}>Descargar borrador</Button>
      <Button disabled={creating || Boolean(createdId)} onClick={() => setTab("Revisión")}>Revisar y crear obra</Button>
    </header>
    <nav className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border)] p-2" aria-label="Vistas del workspace">{tabs.map(name => <button role="tab" aria-selected={tab === name} key={name} onClick={async () => { try { await flushGrid.current?.(); setTab(name); } catch (cause) { setError(String(cause)); } }} className={`rounded px-4 py-2 text-sm ${tab === name ? "bg-sky-500/20 text-sky-200" : "hover:bg-white/5"}`}>{name}</button>)}<span className="ml-auto p-2 text-sm">{draft.rows.length} partidas · {candidate.linkedRecipes?.recipes.length ?? 0} APU · Total de trabajo {num(total)}</span></nav>
    {draft.referenceQuantities ? <p className="px-4 py-2 text-xs text-amber-200">Cantidades referenciales: presupuesto y necesidades pendientes de validar el cómputo real.</p> : null}
    {error ? <div role="alert" className="flex gap-3 bg-[var(--error-bg)] px-4 py-2 text-sm text-[var(--error)]"><span>{error}</span><button className="underline" onClick={() => { void save().catch(() => {}); }}>Reintentar guardado</button></div> : null}
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-xs"><label htmlFor="import-partida">Partida activa</label><select id="import-partida" aria-label="Partida activa" value={selectedId} onChange={e => setSelectedId(e.target.value)} className="max-w-2xl flex-1 rounded border border-[var(--border)] p-1">{draft.rows.map(row => <option key={row._rowId} value={row._rowId}>{row.code} · {row.description}</option>)}</select><span>{row?.unit}</span></div>
    <div className="min-h-0 flex-1 overflow-auto">
      <div className={tab === "Partidas" ? "h-full min-h-[420px]" : "hidden"}><p className="px-4 pt-2 text-xs text-[var(--muted)]">Editá cantidades y precios adoptados, pegá rangos y usá fórmulas. Código, descripción y unidad conservan los vínculos del archivo; se editan después de crear la obra.</p><div className="h-[calc(100%_-_32px)]"><UniverPlanillaGrid fixedRows columns={columns} initialRows={initial.rows} onChange={handleRows} onSelectRow={id => id && setSelectedId(id)} flushPendingRef={flushGrid} readOnly={creating || Boolean(createdId)} /></div></div>
      {tab === "APU" ? <SourceApuView candidate={candidate} row={row} /> : null}
      {tab === "Materiales" ? <MaterialsWorkspaceView materials={materials} rows={draft.rows} onSelect={selectApu} /> : null}
      {tab === "Cronograma" ? <ScheduleWorkspaceView candidate={candidate} rows={draft.rows} onSelect={selectApu} /> : null}
      {tab === "Original" ? <OriginalImportView id={session.id} fileName={session.originalFileName} /> : null}
      {tab === "Revisión" ? <section className="mx-auto max-w-4xl space-y-5 p-6">
        <h2 className="text-lg font-semibold">Revisar y crear obra</h2><p className="text-sm">El borrador está guardado. Al confirmar se vinculan las partidas, recetas, materiales y cronograma al ERP. El archivo original conserva sus fórmulas.</p>
        <div className="grid gap-4 sm:grid-cols-2"><label>Nombre de obra<input aria-label="Nombre de obra" value={draft.name} onChange={e => update({ ...latest.current, name: e.target.value })} className="block w-full rounded border p-2" /></label><label>Código de obra<input aria-label="Código de obra" value={draft.code} onChange={e => update({ ...latest.current, code: e.target.value })} className="block w-full rounded border p-2" /></label><label>Régimen contractual<select aria-label="Régimen contractual" value={draft.regime} onChange={e => update({ ...latest.current, regime: e.target.value as ImportWorkspaceDraft["regime"] })} className="block w-full rounded border p-2"><option value="">Elegir régimen…</option><option value="PUBLIC_WORK">Obra pública</option><option value="PRIVATE_WORK">Obra privada</option><option value="OTHER">Otro</option></select></label></div>
        {([ ["referenceQuantities", "Las cantidades siguen siendo referenciales"], ["applySchedule", "Aplicar el cronograma verificado"] ] as const).map(([key, label]) => <label className="flex gap-2" key={key}><input type="checkbox" checked={draft[key]} onChange={e => update({ ...latest.current, [key]: e.target.checked })} />{label}</label>)}
        {!candidate.linkedRecipes?.recipes.length && ["SAFE_TO_APPLY", "APPLY_WITH_WARNINGS"].includes(candidate.certificate.status) ? <label className="flex gap-2"><input type="checkbox" checked={draft.applyCertificate} onChange={e => update({ ...latest.current, applyCertificate: e.target.checked })} />Importar certificado ({candidate.certificate.status === "SAFE_TO_APPLY" ? "verificado" : "con observaciones"})</label> : null}
        <ul className="space-y-2 text-sm">{candidate.checks.map(check => <li key={check.id}>{check.status === "OK" ? "✓" : "⚠"} {check.label}: {check.detail}</li>)}{candidate.linkedRecipes?.issues.map(issue => <li key={issue} className="text-amber-200">{issue}</li>)}</ul>
        {total !== candidate.budgetTotal ? <p className="text-amber-200">Total documental {num(candidate.budgetTotal)} · total de trabajo {num(total)}. Tus mediciones o precios modificaron el presupuesto; el original se conserva.</p> : null}
        {invalid ? <p className="text-amber-200">Completá nombre, código y régimen. Las partidas necesitan códigos únicos y las recetas deben estar verificadas antes de crear la obra.</p> : null}
        <details><summary className="cursor-pointer">Fuentes, observaciones y hojas de referencia</summary><p className="py-2 text-sm">{interpretation.workbookSummary.summary}</p><ul className="space-y-2 text-sm">{candidate.warnings.map(warning => <li key={warning}>{warning}</li>)}{candidate.foreignBlocks.map((block, i) => <li key={i}>{block.sheet}: {block.label}. Se conserva como referencia.</li>)}</ul></details>
        {createdId ? <><p role="status">Obra creada. Pendientes: {pending.map(item => `${item.section}: ${item.reason}`).join(" · ") || "ninguno"}</p><Button onClick={() => { void openImportedProjectWorkspace(createdId).then(url => router.replace(url)).catch(cause => setError(String(cause))); }}>Continuar en el workspace de la obra</Button></> : <Button disabled={creating || Boolean(invalid)} onClick={() => { void create(); }}>{creating ? "Creando y vinculando…" : "Confirmar y crear obra"}</Button>}
      </section> : null}
    </div>
  </main>;
}

function OriginalImportView({ id, fileName }: { id: string; fileName: string }) {
  const [snapshot, setSnapshot] = useState<WorkingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void getImportSourceSnapshot(id).then(decodeBrowserSnapshot).then(snapshot => { if (active) setSnapshot(snapshot); }).catch(() => { if (active) setError("No se pudo abrir el original."); }); return () => { active = false; }; }, [id]);
  if (error) return <p role="alert" className="p-4">{error}</p>;
  if (!snapshot) return <p role="status" className="p-4">Abriendo la planilla conservada…</p>;
  return <section aria-label="Fuente Excel conservada"><div className="flex gap-3 items-center p-3"><p className="text-xs text-[var(--muted)]">Valores guardados en el documento, sin recalcular. Las fórmulas originales se conservan en el archivo descargable.</p><Button variant="secondary" onClick={() => { void getImportOriginalUrl(id).then(url => { window.location.href = url; }).catch(() => setError("No se pudo descargar el original.")); }}>Descargar Excel original</Button></div><SourceGrid workbookId={id} fileName={fileName} initialSnapshot={snapshot} readOnly cachedValuesOnly readOnlyLabel="Fuente conservada · valores del documento" onSave={async () => ({ error: "El original se conserva sin modificaciones." })} heightClassName="h-[65vh] min-h-[360px]" /></section>;
}



