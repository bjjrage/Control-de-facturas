"use client";
import "@univerjs/preset-sheets-core/lib/index.css";
import { memo, useEffect, useRef, useState } from "react";
import { createUniver, CommandType, LocaleType, merge } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import esES from "@univerjs/preset-sheets-core/locales/es-ES";
import type { PlanillaGridProps } from "./PlanillaGrid";
import { fromWorkspaceBook, toWorkspaceBook, WORKSPACE_SHEET } from "@/lib/planillas/univer-grid";
import { rawNumber } from "@/lib/workbook-interpretation/numbers";
import { resolveFormulaTemplate } from "@/lib/planillas/grid-utils";

export const UniverPlanillaGrid = memo(function UniverPlanillaGrid({ columns, initialRows, onChange, onSelectRow, readOnly = false, fixedRows = false, flushPendingRef }: PlanillaGridProps) {
  const host = useRef<HTMLDivElement>(null);
  const initial = useRef(initialRows);
  const callbacks = useRef({ onChange, onSelectRow });
  const editableRef = useRef(readOnly);
  const workbookRef = useRef<{ setEditable: (enabled: boolean) => unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("D1");
  const [value, setValue] = useState("");
  const toolsRef = useRef<{ apply: (address: string, value: string) => Promise<void>; paste: (address: string) => Promise<void>; undo: () => Promise<unknown>; redo: () => Promise<unknown> } | null>(null);
  useEffect(() => { callbacks.current = { onChange, onSelectRow }; }, [onChange, onSelectRow]);
  useEffect(() => { editableRef.current = readOnly; workbookRef.current?.setEditable(!readOnly); }, [readOnly]);
  useEffect(() => {
    if (!host.current) return;
    const container = document.createElement("div"); container.style.height = "100%"; host.current.appendChild(container);
    const { univer, univerAPI } = createUniver({ locale: LocaleType.ES_ES, locales: { [LocaleType.ES_ES]: merge({}, esES) },
      presets: [UniverSheetsCorePreset({ container, header: true, toolbar: true, formulaBar: true })] });
    const book = univerAPI.createWorkbook(toWorkspaceBook(initial.current, columns, crypto.randomUUID()));
    workbookRef.current = book; book.setEditable(!editableRef.current);
    const sheet = book.getActiveSheet();
    let disposed = false; let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    const emit = async (force = false) => {
      if (disposed || (editableRef.current && !force)) return;
      try {
        await univerAPI.getFormula().onCalculationResultApplied(15000);
        if (disposed) return;
        let snapshot = book.save();
        const repairs: Record<number, Record<number, { f: string }>> = {};
        const currentFormulas = sheet.getRange(0, 0, sheet.getSheet().getRowCount(), columns.length).getFormulas();
        for (let r = 0; r < currentFormulas.length; r++) columns.forEach((col, c) => {
          if (!col.formulaTemplate) return;
          const expected = resolveFormulaTemplate(col.formulaTemplate, r + 1);
          if (currentFormulas[r]?.[c] !== expected) { repairs[r] ??= {}; repairs[r][c] = { f: expected }; }
        });
        if (Object.keys(repairs).length) {
          // Derived formulas are application data, not a separate user undo.
          await univerAPI.executeCommand("sheet.mutation.set-range-values", { unitId: book.getId(), subUnitId: sheet.getSheetId(), cellValue: repairs });
          await univerAPI.getFormula().onCalculationResultApplied(15000);
          if (disposed) return;
          snapshot = book.save();
        }
        const source = snapshot.sheets[WORKSPACE_SHEET];
        source.cellData ??= {};
        const count = sheet.getSheet().getRowCount();
        const range = sheet.getRange(0, 0, count, columns.length);
        const values = range.getValues(); const formulas = range.getFormulas();
        // Resolve shared formulas and their current results through the facade.
        for (let r = 0; r < count; r++) for (let c = 0; c < columns.length; c++) {
          source.cellData[r] ??= {}; source.cellData[r][c] = { ...source.cellData[r][c], v: values[r]?.[c] ?? null, f: formulas[r]?.[c] || undefined };
        }
        const rows = fromWorkspaceBook(snapshot, columns, initial.current);
        for (const [r, cells] of Object.entries(source.cellData)) {
          if (cells[columns.length]?.v) sheet.getSheet().getCellMatrix().setValue(Number(r), columns.length, cells[columns.length]);
        }
        setError(null); callbacks.current.onChange(rows); dirty = false;
      } catch (e) { setError(e instanceof Error ? e.message : "No se pudo leer la hoja."); throw e; }
    };
    const schedule = () => { if (editableRef.current) return; dirty = true; if (timer) clearTimeout(timer); timer = setTimeout(() => { void emit().catch(() => {}); }, 100); };
    if (flushPendingRef) flushPendingRef.current = async () => { if (timer) clearTimeout(timer); if (dirty) await emit(true); };
    const parseAddress = (address: string) => {
      if (!/^[A-E][1-9]\d{0,3}$/i.test(address) || Number(address.slice(1)) > sheet.getSheet().getRowCount()) throw new Error("Indicá una celda editable entre A y E dentro de la hoja.");
      return sheet.getRange(address.toUpperCase());
    };
    const typedValue = (value: string, col: number) => {
      if (columns[col]?.readOnly || columns[col]?.type === "readonly-numeric") throw new Error("Esta columna conserva la identidad o el cálculo. Editá las columnas de trabajo habilitadas.");
      if (columns[col]?.type === "numeric") {
        if (value.startsWith("=")) return { f: value };
        if (value === "") return { v: null };
        const number = rawNumber(value); if (number === null) throw new Error("Número inválido o ambiguo. Usá un decimal inequívoco.");
        return { v: number, t: 2 as const };
      }
      return { v: value, t: 1 as const };
    };
    toolsRef.current = {
      apply: async (address, value) => { const range = parseAddress(address); range.setValue(typedValue(value, range.getColumn())); dirty = true; await emit(); },
      paste: async address => {
        const range = parseAddress(address); const matrix = (await navigator.clipboard.readText()).replace(/\r/g, "").replace(/\n$/, "").split("\n").map(line => line.split("\t"));
        const width = Math.max(...matrix.map(row => row.length));
        if (range.getColumn() + width > 5 || range.getRow() + matrix.length > sheet.getSheet().getRowCount()) throw new Error("El rango supera las columnas editables o las filas disponibles.");
        const cells = matrix.map(row => Array.from({ length: width }, (_, i) => typedValue(row[i] ?? "", range.getColumn() + i)));
        sheet.getRange(range.getRow(), range.getColumn(), cells.length, width).setValues(cells); dirty = true; await emit();
      },
      undo: async () => { await univerAPI.undo(); dirty = true; await emit(); },
      redo: async () => { await univerAPI.redo(); dirty = true; await emit(); },
    };
    const mutation = univerAPI.addEvent(univerAPI.Event.CommandExecuted, event => { if (event.type === CommandType.MUTATION) schedule(); });
    const selection = univerAPI.addEvent(univerAPI.Event.SelectionChanged, event => {
      const r = event.selections[0]?.startRow;
      const c = event.selections[0]?.startColumn;
      if (r != null && c != null && c < columns.length) {
        setAddress(`${String.fromCharCode(65 + c)}${r + 1}`);
        const range = sheet.getRange(r, c); setValue(range.getFormulas()[0]?.[0] || String(range.getValues()[0]?.[0] ?? ""));
      }
      const id = r == null ? null : sheet.getSheet().getCellMatrix().getValue(r, columns.length)?.v;
      callbacks.current.onSelectRow?.(typeof id === "string" ? id : null);
    });
    const guard = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, event => {
      if (event.type !== CommandType.COMMAND) return;
      if (fixedRows && /(insert|remove|move).*(row)|move-range|sort/.test(event.id)) {
        event.cancel = true; setError("Las partidas conservan sus vínculos durante la importación. Las altas y bajas se hacen en la obra creada."); return;
      }
      if (event.id === "sheet.command.set-range-values") {
        const params = event.params as { range?: { startColumn: number; endColumn: number } } | undefined;
        const range = params?.range ?? sheet.getActiveRange()?.getRange();
        if (range && columns.some((column, index) => index >= range.startColumn && index <= range.endColumn && (column.readOnly || column.type === "readonly-numeric"))) {
          event.cancel = true; setError("El subtotal se calcula automáticamente y la identidad de partida está protegida.");
        }
      }
      if (/(insert|remove|move|hide|show).*(col)|move-range|sort/.test(event.id)) {
        event.cancel = true; setError("Las columnas operativas mantienen su significado. Mové filas completas para conservar los vínculos.");
      }
    });
    const sheetGuard = univerAPI.addEvent(univerAPI.Event.BeforeSheetCreate, event => { event.cancel = true; });
    const onExit = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", onExit);
    return () => { disposed = true; if (timer) clearTimeout(timer); mutation.dispose(); selection.dispose(); guard.dispose(); sheetGuard.dispose(); window.removeEventListener("beforeunload", onExit); if (flushPendingRef) flushPendingRef.current = null; toolsRef.current = null; workbookRef.current = null; univer.dispose(); container.remove(); };
  }, [columns, flushPendingRef, fixedRows]);
  const run = (action: () => Promise<unknown> | undefined) => { void Promise.resolve().then(action).catch(e => setError(e instanceof Error ? e.message : "No se pudo aplicar el cambio.")); };
  return <div className="h-full flex flex-col"><div className="text-xs p-2 text-[var(--muted)]">{columns.map((c, i) => `${String.fromCharCode(65 + i)}: ${c.label}`).join(" · ")}</div>
    <div role="toolbar" aria-label="Herramientas de cómputo" className="flex gap-2 p-2 text-xs"><input aria-label="Celda" value={address} onChange={e => setAddress(e.target.value)} className="w-16 border rounded p-1" /><input aria-label="Valor o fórmula" value={value} onChange={e => setValue(e.target.value)} className="min-w-0 flex-1 border rounded p-1" disabled={readOnly} /><button disabled={readOnly} onClick={() => run(() => toolsRef.current?.apply(address, value))}>Aplicar celda</button><button disabled={readOnly} onClick={() => run(() => toolsRef.current?.paste(address))}>Pegar rango</button><button disabled={readOnly} onClick={() => run(() => toolsRef.current?.undo())}>Deshacer</button><button disabled={readOnly} onClick={() => run(() => toolsRef.current?.redo())}>Rehacer</button></div>
    {error ? <p role="alert" className="p-2 text-[var(--error)]">{error}</p> : null}<div ref={host} className="flex-1 min-h-0" aria-label="Hoja de cómputo y presupuesto" /></div>;
});
