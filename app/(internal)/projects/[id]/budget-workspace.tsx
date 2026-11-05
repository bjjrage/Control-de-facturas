"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataGrid, type Column, type DataGridHandle, type RenderEditCellContentProps } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { ArrowLeft, Calculator, Maximize2, Minimize2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { budgetWorkspaceValues, parseWorkspaceCell, pasteWorkspaceRange, rebaseWorkspaceValues, sameWorkspaceValues, workspaceValues, type BudgetWorkspaceRow, type BudgetWorkspaceValues, type WorkspaceEditableKey } from "@/lib/projects/budget-workspace";
import { ApuDialog } from "./apu-dialog";
import { getApuCostSummaryAction, type ApuCostSummary } from "./apu-actions";
import { saveBudgetWorkspace } from "./workspace-actions";
import styles from "./budget-workspace.module.css";

type Draft = { expected: BudgetWorkspaceValues; next: BudgetWorkspaceValues };
type Drafts = Record<string, Draft>;
const numberLabel = (value: number | null) => value === null ? "—" : value.toLocaleString("es-PY", { maximumFractionDigits: 4 });
const rowKeyGetter = (row: BudgetWorkspaceRow) => row.id;
const focusAndSelect = (input: HTMLInputElement | null) => { input?.focus(); input?.select(); };

function CellEditor({ row, column, rowIdx, onRowChange, onClose, onNavigate }: RenderEditCellContentProps<BudgetWorkspaceRow> & { onNavigate: (row: number, column: number) => void }) {
  const key = column.key as WorkspaceEditableKey;
  const initial = row[key];
  // Four decimal places disambiguate values such as 1.234 from grouped money.
  const [text, setText] = useState(typeof initial === "number" && String(initial).split(".")[1]?.length === 3 ? initial.toFixed(4) : String(initial ?? ""));
  const [error, setError] = useState("");
  const committed = useRef(false);
  function commit() {
    if (committed.current) return true;
    try {
      const next = { ...row, [key]: parseWorkspaceCell(key, text) };
      budgetWorkspaceValues.parse(workspaceValues(next));
      onRowChange(next, true);
      committed.current = true;
      return true;
    } catch (error) { setError((error as Error).message); return false; }
  }
  return <div className={styles.editor}>
    <input aria-label={`Editar ${column.name}`} ref={focusAndSelect} value={text} onChange={event => { setText(event.target.value); setError(""); }}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault(); event.stopPropagation();
          if (commit()) onNavigate(event.key === "Enter" ? rowIdx + (event.shiftKey ? -1 : 1) : rowIdx, event.key === "Tab" ? column.idx + (event.shiftKey ? -1 : 1) : column.idx);
        }
        if (event.key === "Escape") { event.stopPropagation(); onClose(false); }
      }} onBlur={commit} />
    {error ? <span role="alert" className={styles.editorError}>{error}</span> : null}
  </div>;
}

export function BudgetWorkspace({ projectId, projectName, rows, userId, isQa }: { projectId: string; projectName: string; rows: BudgetWorkspaceRow[]; userId: string; isQa: boolean }) {
  const router = useRouter();
  const gridRef = useRef<DataGridHandle>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<Drafts[]>([]);
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState<{ id: string; error: string }[]>([]);
  const [saving, startSave] = useTransition();
  const [costs, setCosts] = useState<Record<string, ApuCostSummary>>({});
  const [referenceQuantities, setReferenceQuantities] = useState(false);
  const [costError, setCostError] = useState("");
  const [costLoading, setCostLoading] = useState(true);
  const [apuRevision, setApuRevision] = useState(0);
  const key = `budget-workspace:v1:${userId}:${projectId}`;
  const latestDrafts = useRef(drafts);
  useEffect(() => { latestDrafts.current = drafts; }, [drafts]);

  /* Browser storage is external state: restore only after hydration and report
   * storage failures without losing the editable in-memory draft. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const restored: Drafts = {};
        for (const [id, value] of Object.entries(stored)) {
          if (!value || typeof value !== "object") continue;
          const draft = value as Draft;
          if (budgetWorkspaceValues.safeParse(draft.expected).success && budgetWorkspaceValues.safeParse(draft.next).success) restored[id] = draft;
        }
        setDrafts(restored);
        if (Object.keys(restored).length) setMessage("Recuperamos tus cambios pendientes de esta pestaña. Revisalos antes de guardar.");
      }
    } catch { setMessage("No se pudo recuperar el borrador de esta pestaña."); }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (Object.keys(drafts).length) sessionStorage.setItem(key, JSON.stringify(drafts));
      else sessionStorage.removeItem(key);
    } catch { setMessage("El navegador no pudo conservar el borrador. Guardá antes de salir."); }
  }, [drafts, key, ready]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(latestDrafts.current).length) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getApuCostSummaryAction(projectId).then(result => {
      if (cancelled) return;
      setCosts(result.data ?? {}); setReferenceQuantities(Boolean(result.referenceQuantities)); setCostError(result.error ?? ""); setCostLoading(false);
    }).catch(() => { if (!cancelled) { setCostError("No se pudieron leer los costos APU. Actualizá los datos."); setCostLoading(false); } });
    return () => { cancelled = true; };
  }, [projectId, apuRevision]);

  const currentRows = useMemo(() => rows.map(row => drafts[row.id] ? { ...row, ...drafts[row.id].next } : row), [rows, drafts]);
  const visibleRows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return currentRows.filter(row => (!onlyPending || drafts[row.id]) && (!term || `${row.code} ${row.description} ${row.unit ?? ""}`.toLocaleLowerCase().includes(term)));
  }, [currentRows, query, onlyPending, drafts]);
  const pendingCount = Object.keys(drafts).length;
  const selected = currentRows.find(row => row.id === selectedId);
  const selectedCost = selected ? costs[selected.id] : null;
  const total = rows.reduce((sum, row) => sum + row.subtotal, 0);

  function stage(changedRows: BudgetWorkspaceRow[]) {
    const next = { ...drafts };
    for (const row of changedRows) {
      const base = rows.find(item => item.id === row.id);
      if (!base) continue;
      const expected = drafts[row.id]?.expected ?? workspaceValues(base);
      const values = workspaceValues(row);
      if (sameWorkspaceValues(expected, values)) delete next[row.id];
      else next[row.id] = { expected, next: values };
    }
    setHistory(previous => [...previous.slice(-29), drafts]);
    setDrafts(next); setFailures([]); setMessage("");
  }

  function save() {
    startSave(async () => {
      const remaining = { ...latestDrafts.current };
      let savedCount = 0;
      let batchError = "";
      const failed: { id: string; error: string }[] = [];
      setHistory([]); setFailures([]); setMessage(`Guardando ${Object.keys(remaining).length} partida(s)…`);
      try {
        const changes = Object.entries(remaining).map(([id, draft]) => ({ id, ...draft }));
        for (let offset = 0; offset < changes.length; offset += 50) {
          const result = await saveBudgetWorkspace(projectId, changes.slice(offset, offset + 50));
          if (result.error) { batchError = result.error; break; }
          for (const row of result.saved) { delete remaining[row.id]; savedCount++; }
          failed.push(...result.failed);
          setDrafts({ ...remaining });
        }
        setFailures(failed);
        if (failed.length) router.refresh();
        setMessage(`${savedCount} partida(s) guardada(s). ${batchError || (Object.keys(remaining).length ? `${Object.keys(remaining).length} siguen pendientes; revisá los avisos.` : "Todo guardado en el ERP.")}`);
      } catch {
        setMessage("Se interrumpió la respuesta. Conservamos los pendientes; recargá los datos para comprobar qué llegó a guardarse.");
      }
    });
  }

  const columns: Column<BudgetWorkspaceRow>[] = [
    { key: "code", name: "Código", width: 95, frozen: true },
    ...([ ["description", "Descripción", 380], ["unit", "Unidad", 85], ["quantity", "Cantidad", 130], ["unitPrice", "P. unitario · Gs.", 155] ] as const).map(([key, name, width]) => ({
      key, name, width, resizable: true, frozen: key === "description", editable: !saving && ready,
      renderEditCell: (props: RenderEditCellContentProps<BudgetWorkspaceRow>) => <CellEditor {...props} onNavigate={(row, column) => {
        requestAnimationFrame(() => gridRef.current?.setActivePosition({ rowIdx: Math.max(0, Math.min(visibleRows.length - 1, row)), idx: Math.max(1, Math.min(4, column)) }));
      }} />, editorOptions: { commitOnOutsideClick: false },
      cellClass: (row: BudgetWorkspaceRow) => drafts[row.id] && row[key] !== drafts[row.id].expected[key] ? styles.changed : undefined,
      renderCell: ({ row }: { row: BudgetWorkspaceRow }) => typeof row[key] === "number" ? numberLabel(row[key] as number) : row[key] ?? "—",
    })),
    { key: "subtotal", name: "Subtotal guardado · Gs.", width: 185, renderCell: ({ row }) => <span title={drafts[row.id] ? "Se recalcula al guardar con el cálculo del ERP." : undefined}>{numberLabel(row.subtotal)}{drafts[row.id] ? " *" : ""}</span> },
    { key: "apu", name: "Costo unitario APU · Gs.", width: 190, renderCell: ({ row }) => costLoading ? "Cargando APU…" : costError ? "No disponible" : costs[row.id]?.tieneApu ? costs[row.id].costoTotal === null ? "Costo incompleto" : `${numberLabel(costs[row.id].costoTotal)}${costs[row.id].precioReferencia ? " · ref." : ""}` : "Sin receta" },
  ];

  const workspace = <section className={`${styles.workspace} ${expanded && ready ? styles.expanded : ""}`} aria-label="Workspace de presupuesto">
    <header className={styles.header}>
      <Link href={`/projects/${projectId}?tab=presupuesto`} className={styles.back} aria-label="Volver al presupuesto"><ArrowLeft size={18} /></Link>
      <div className={styles.title}><h1>{isQa ? "QA · " : ""}Workspace · Presupuesto y APU</h1><p title={projectName}>{projectName}</p></div>
      <span className={styles.saved}>{pendingCount ? `${pendingCount} pendiente(s)` : "Sin cambios pendientes"}</span>
      <Button variant="secondary" disabled={!history.length || saving} onClick={() => { setDrafts(history[history.length - 1]); setHistory(history.slice(0, -1)); }}><Undo2 size={14} /> Deshacer</Button>
      <Button disabled={!pendingCount || saving || !ready} onClick={save}><Save size={14} /> {saving ? "Guardando…" : "Guardar cambios"}</Button>
      <Button variant="ghost" aria-label={expanded ? "Reducir workspace" : "Ampliar workspace"} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</Button>
    </header>
    <div className={styles.toolbar}>
      <Input aria-label="Buscar partidas" placeholder="Buscar código, descripción o unidad…" value={query} onChange={event => setQuery(event.target.value)} className="max-w-sm" />
      <label><input type="checkbox" checked={onlyPending} onChange={event => setOnlyPending(event.target.checked)} /> Solo pendientes</label>
      <span>{visibleRows.length} de {rows.length} partidas</span>
      <strong className="ml-auto">Guardado: {formatMoney(total, "PYG")}</strong>
    </div>
    <p className={styles.hint}>Doble clic o Enter para editar · Pegá rangos desde una columna editable · Números sin miles, decimal con coma o punto · Los subtotales se actualizan al guardar.</p>
    {referenceQuantities ? <p className={styles.warning}>Cantidades de referencia del archivo: validá el cómputo real antes de comprar o planificar.</p> : null}
    {costError ? <p role="alert" className={styles.warning}>{costError}</p> : null}
    <div className={styles.gridContainer} onPasteCapture={event => {
      // Text editors retain native single-cell paste. Grid selection accepts TSV.
      if (event.target instanceof HTMLInputElement) return;
      event.preventDefault(); event.stopPropagation();
      if (saving || !ready) return;
      const cell = (event.target as HTMLElement).closest('[role="gridcell"]');
      const columnIndex = Number(cell?.getAttribute("aria-colindex")) - 1;
      const rowIndex = visibleRows.findIndex(row => row.id === selectedId);
      try { stage(pasteWorkspaceRange(visibleRows, rowIndex, columns[columnIndex]?.key ?? "", event.clipboardData.getData("text/plain"))); }
      catch (error) { setMessage((error as Error).message); }
    }}>
      <DataGrid ref={gridRef} aria-label="Partidas del presupuesto" className={styles.grid} columns={columns} rows={visibleRows} rowKeyGetter={rowKeyGetter}
        rowHeight={24} headerRowHeight={32} defaultColumnOptions={{ resizable: true }}
        // Signal clipboard ownership so Ctrl+V keeps the active cell rather
        // than opening a text editor. The capture handler stages the rectangle.
        onCellPaste={({ row }) => row}
        onCellCopy={({ row, column }, event) => {
          const value = column.key === "apu" ? costs[row.id]?.costoTotal : row[column.key as keyof BudgetWorkspaceRow];
          const text = typeof value === "number" && String(value).split(".")[1]?.length === 3 ? value.toFixed(4) : String(value ?? "");
          event.preventDefault(); event.clipboardData.setData("text/plain", text);
        }}
        onRowsChange={(next, data) => { try { stage(data.indexes.map(index => next[index])); } catch (error) { setMessage((error as Error).message); } }}
        onActivePositionChange={({ row }) => { if (row) setSelectedId(row.id); }}
        rowClass={row => row.id === selectedId ? styles.selected : undefined} />
    </div>
    <footer className={styles.footer}>
      <div className={styles.detail}>
        <span title={selected?.description}>{selected ? `${selected.code} · ${selected.description}` : "Seleccioná una partida para trabajar con su APU."}</span>
        {selected ? <ApuDialog key={selected.id} projectId={projectId} budgetItemId={selected.id} budgetItemLabel={`${selected.code} · ${selected.description}`} workspaceEditing disabled={saving || Boolean(drafts[selected.id])}
          trigger={<><Calculator size={15} /> Abrir APU y materiales</>} onSaved={() => { setCostLoading(true); setApuRevision(value => value + 1); }} /> : null}
      </div>
      {selected ? <p className={styles.hint}>{drafts[selected.id] ? "Guardá la partida antes de modificar su receta. " : ""}{selectedCost?.tieneApu ? "El APU alimenta costos y necesidades de materiales; no cambia el precio contractual. " : ""}El cronograma se gestiona desde sus fechas y recursos.</p> : null}
      <div className={styles.links}>
        <Link href={`/projects/${projectId}?tab=costeo`}>Costeo y materiales</Link>
        <Link href={`/projects/${projectId}?tab=cronograma`}>Cronograma / Gantt</Link>
        <Link href={`/projects/${projectId}?tab=presupuesto`}>Vista anterior y agregar partidas</Link>
        <Button variant="ghost" disabled={saving} onClick={() => { router.refresh(); setCostLoading(true); setApuRevision(value => value + 1); setMessage("Datos solicitados nuevamente. Se conservan los cambios pendientes."); }}>Recargar datos</Button>
        <Button variant="ghost" disabled={!pendingCount || saving} onClick={() => { if (window.confirm("¿Descartar todos los cambios pendientes?")) { setDrafts({}); setHistory([]); setFailures([]); setMessage(""); } }}>Descartar pendientes</Button>
      </div>
      {message ? <p role="status" className={styles.message}>{message}</p> : null}
      {failures.length ? <ul role="alert" className={styles.failures}>{failures.map(failure => {
        const current = rows.find(row => row.id === failure.id);
        const draft = drafts[failure.id];
        const proposed = current && draft ? rebaseWorkspaceValues(draft.expected, draft.next, current) : null;
        return <li key={failure.id}>{current?.code ?? failure.id}: {failure.error} {current && draft && !sameWorkspaceValues(current, draft.expected) ? <Button variant="secondary" onClick={() => {
          if (proposed && window.confirm(`Datos actuales: ${current.description}, ${current.unit ?? "sin unidad"}, cantidad ${current.quantity ?? "vacía"}, precio ${current.unitPrice ?? "vacío"}.\nPropuesta: ${proposed.description}, ${proposed.unit ?? "sin unidad"}, cantidad ${proposed.quantity ?? "vacía"}, precio ${proposed.unitPrice ?? "vacío"}.\n¿Preparar tus cambios sobre estos datos actuales? Todavía deberás guardar.`)) {
            setDrafts(previous => ({ ...previous, [failure.id]: { expected: workspaceValues(current), next: proposed } }));
            setFailures(previous => previous.filter(item => item.id !== failure.id));
          }
        }}>Revisar y reaplicar</Button> : null}</li>;
      })}</ul> : null}
    </footer>
  </section>;
  return expanded && ready ? createPortal(workspace, document.body) : workspace;
}
