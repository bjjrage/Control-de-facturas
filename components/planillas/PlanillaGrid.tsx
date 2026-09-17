"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HotTable } from "@handsontable/react-wrapper";
import type { HotTableRef } from "@handsontable/react-wrapper";
import Handsontable from "handsontable";
import { registerAllModules } from "handsontable/registry";
import { HyperFormula } from "hyperformula";
import { Plus, Trash2, Undo2, Redo2 } from "lucide-react";
import type { PlanillaColumn, PlanillaRowMeta } from "@/lib/planillas/types";
import { colIndexToLetter, isNewRowId, newRowId, resolveFormulaTemplate } from "@/lib/planillas/grid-utils";

registerAllModules();

// Handsontable es de licencia dual (MIT hasta cierta versión legacy /
// comercial desde v8+). Para este prototipo se declara explícitamente
// "non-commercial-and-evaluation": funciona sin restricciones pero muestra
// un aviso en consola/UI. Antes de llevar esto a producción como parte de
// un ERP comercial hace falta una licencia comercial de Handsontable —
// documentado acá, no bloquea el prototipo (REGLA #4 del batch).
const HANDSONTABLE_LICENSE_KEY = "non-commercial-and-evaluation";

// Hoisteados a nivel de módulo a propósito: el wrapper de React de
// Handsontable llama a hotInstance.updateSettings() cada vez que UNA de
// estas props cambia de referencia, sin importar si el contenido es
// semánticamente igual. Un array/objeto literal escrito inline en el JSX
// (uno nuevo por render) dispara ese updateSettings en cada render, lo que
// en el caso de `formulas` reinicializa el motor HyperFormula y su
// recálculo dispara otro afterChange → onChange del padre → re-render →
// bucle infinito ("Maximum update depth exceeded"), reproducido y
// confirmado manualmente antes de este fix.
const CONTEXT_MENU_ITEMS = [
  "row_above",
  "row_below",
  "remove_row",
  "---------",
  "undo",
  "redo",
  "---------",
  "copy",
  "cut",
] as const;
const FILL_HANDLE_SETTINGS = { direction: "vertical", autoInsertRow: false } as const;

// Tope de filas de la grilla — no atado a cuántas partidas tenía el
// presupuesto de origen (el usuario tiene que poder agregar filas nuevas
// libremente, como en Excel), pero tampoco ilimitado: nadie llena 500 filas
// a mano, y sin tope una fila de fórmula en cascada o un paste accidental
// podría degradar HyperFormula en el cliente.
const MAX_ROWS = 500;

// El validador nativo de Handsontable para type:"numeric" (numericValidator)
// llama a isNumeric(value) y punto — "=120+80" no es numérico, así que
// rechaza CUALQUIER fórmula tipeada en una columna numérica y Handsontable
// revierte la celda a su valor anterior antes de que el plugin de fórmulas
// llegue a verla. Confirmado en vivo contra producción: escribir una fórmula
// en Cantidad no cambiaba nada, ni en pantalla ni en el autosave persistido.
// Este validador reemplaza al default: deja pasar cualquier valor que
// empiece con "=" (lo procesa HyperFormula) y valida como número el resto.
function isPlainNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^-?\d+([.,]\d+)?$/.test(value.trim());
}

function numericOrFormulaValidator(
  this: Handsontable.CellProperties,
  value: unknown,
  callback: (valid: boolean) => void
) {
  if (typeof value === "string" && value.trim().startsWith("=")) {
    callback(true);
    return;
  }
  if (value === null || value === undefined || value === "") {
    callback(this.allowEmpty !== false);
    return;
  }
  callback(isPlainNumeric(value));
}

function columnToHtConfig(col: PlanillaColumn): Handsontable.ColumnSettings {
  const isNumericColumn = col.type !== "text";
  return {
    data: col.key,
    title: col.label,
    type: isNumericColumn ? "numeric" : "text",
    // El validator explícito pisa al que trae "numeric" por default —
    // mantiene el formateo/alineación numérica pero acepta fórmulas.
    validator: isNumericColumn ? numericOrFormulaValidator : undefined,
    readOnly: col.readOnly ?? col.type === "readonly-numeric",
    width: col.width,
  };
}

export type PlanillaGridRow = PlanillaRowMeta & Record<string, unknown>;

export type PlanillaGridProps = {
  columns: PlanillaColumn[];
  initialRows: PlanillaGridRow[];
  /** Se dispara con el snapshot completo (filas visibles + tombstones de
   * borrado) en cada cambio real de datos — el caller (la página) decide
   * cuándo debounciar el autosave; este componente es agnóstico de eso. */
  onChange: (rows: PlanillaGridRow[]) => void;
  readOnly?: boolean;
};

/**
 * Grilla genérica tipo Excel — motor agnóstico de negocio (REGLA #5). No
 * conoce "cómputo" ni "presupuesto": solo columnas + filas + fórmulas. La
 * identidad de fila (_rowId/_version/_deleted) viaja oculta en cada objeto
 * de fila y nunca se deriva de la posición visual (REGLA #8).
 *
 * memo() a propósito: @handsontable/react-wrapper llama a
 * hotInstance.updateSettings() en cada re-render de este componente, sin
 * importar si las props cambiaron — y eso reinicializa/recalcula el motor
 * HyperFormula, lo que puede reescribir celdas de fórmula y disparar un
 * afterChange espurio → onChange del padre → autosave → el padre
 * re-renderiza (p. ej. al pasar saveStatus a "saved") → este componente se
 * re-renderiza → updateSettings otra vez — bucle perpetuo pausado solo por
 * el debounce de autosave ("Maximum update depth exceeded" es la variante
 * síncrona de este mismo problema; esta es la variante asíncrona, pausada
 * por el debounce). Reproducido y confirmado en vivo (autosave disparando
 * cada ~900ms indefinidamente sin tocar la grilla) antes de este fix.
 * Requiere que el padre pase `onChange` con referencia estable (useCallback)
 * — ver planilla-session-client.tsx — porque memo() compara props por
 * referencia.
 */
export const PlanillaGrid = memo(function PlanillaGrid({
  columns,
  initialRows,
  onChange,
  readOnly = false,
}: PlanillaGridProps) {
  const hotRef = useRef<HotTableRef>(null);
  const deletedRef = useRef<PlanillaGridRow[]>([]);
  const [formulaBarValue, setFormulaBarValue] = useState("");
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  const htColumns = useMemo(() => columns.map(columnToHtConfig), [columns]);
  const colHeaders = useMemo(() => columns.map((c) => c.label), [columns]);
  // useId() en vez de Math.random(): estable entre renders y puro (requisito
  // del React Compiler), y alcanza para distinguir la hoja de HyperFormula
  // de esta instancia de grilla del resto.
  const sheetName = `planilla-${useId()}`;
  const formulasSettings = useMemo(() => ({ engine: HyperFormula, sheetName }), [sheetName]);
  const formulaColumns = useMemo(() => columns.filter((c) => c.formulaTemplate), [columns]);

  function applyFormulaDefaults(row: PlanillaGridRow, rowIndex0: number) {
    for (const col of formulaColumns) {
      if (col.formulaTemplate) row[col.key] = resolveFormulaTemplate(col.formulaTemplate, rowIndex0 + 1);
    }
    return row;
  }

  // Estado con inicializador perezoso, NO un valor recalculado en cada
  // render: si `data` recibiera un array con una referencia nueva en cada
  // render, Handsontable lo trata como una carga de datos nueva, dispara
  // afterChange, que llama a onChange del padre, que re-renderiza este
  // componente — bucle infinito ("Maximum update depth exceeded"),
  // reproducido y confirmado en components/planillas antes de este fix.
  // `initialRows` es el snapshot con el que arranca la sesión y no cambia
  // en su vida útil, así que una sola computación al montar es correcta.
  const [seedInitialRows] = useState(() => initialRows.map((r, i) => applyFormulaDefaults({ ...r }, i)));

  // El wrapper de React de Handsontable vuelve a registrar cada hook
  // (afterChange, afterSelectionEnd, etc.) cada vez que la función pasada
  // como prop cambia de referencia — y re-registrar afterSelectionEnd, por
  // ejemplo, puede disparar una nueva selección, que cambia estado, que
  // re-renderiza este componente, que crea una función nueva... bucle
  // infinito ("Maximum update depth exceeded"), reproducido y confirmado
  // manualmente antes de este fix. Por eso todos los handlers van en
  // useCallback con dependencias realmente estables — `onChange` (la única
  // prop que un padre puede recrear en cada render, ej. un arrow function
  // inline) se lee de un ref en vez de cerrar sobre la prop directamente.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // hot.getSourceData() devuelve el dato CRUDO por celda — para una celda con
  // fórmula, el texto "=D4*E4" o "=120+80", nunca el resultado calculado (ver
  // el propio comentario del plugin de fórmulas de Handsontable: "sync HOT's
  // source data with HF's state so that getDataAtCell returns [el
  // calculado]" — getSourceData explícitamente NO participa de esa sync).
  // Enviar eso tal cual al servidor rompería confirmar: budget_items.quantity
  // es una columna numeric de Postgres, castear el texto "=120+80" revienta
  // el RPC. Por eso acá se resuelve cada celda que empiece con "=" a su valor
  // ya calculado (getDataAtCell) antes de emitir — lo que viaja a autosave y
  // a confirmar es siempre el número final, la fórmula en sí vive y se
  // recalcula solo del lado de HyperFormula mientras se edita.
  const emitChange = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const sourceRows = hot.getSourceData() as PlanillaGridRow[];
    const current = sourceRows.map((row, rowIndex) => {
      const resolved: PlanillaGridRow = { ...row };
      columns.forEach((col, colIndex) => {
        const raw = resolved[col.key];
        if (typeof raw === "string" && raw.trim().startsWith("=")) {
          resolved[col.key] = hot.getDataAtCell(rowIndex, colIndex);
        }
      });
      return resolved;
    });
    onChangeRef.current([...current, ...deletedRef.current]);
  }, [columns]);

  const handleAfterChange = useCallback(
    (_changes: unknown, source: string) => {
      if (source === "loadData") return;
      emitChange();
    },
    [emitChange]
  );

  const handleAfterCreateRow = useCallback(
    (index: number, amount: number) => {
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      for (let i = 0; i < amount; i++) {
        const rowIndex = index + i;
        hot.setDataAtRowProp(rowIndex, "_rowId", newRowId(), "PlanillaGrid.afterCreateRow");
        hot.setDataAtRowProp(rowIndex, "_version", null, "PlanillaGrid.afterCreateRow");
        for (const col of formulaColumns) {
          if (col.formulaTemplate) {
            hot.setDataAtRowProp(
              rowIndex,
              col.key,
              resolveFormulaTemplate(col.formulaTemplate, rowIndex + 1),
              "PlanillaGrid.afterCreateRow"
            );
          }
        }
      }
      emitChange();
    },
    [emitChange, formulaColumns]
  );

  const handleBeforeRemoveRow = useCallback((index: number, amount: number) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    for (let i = 0; i < amount; i++) {
      const row = hot.getSourceDataAtRow(index + i) as PlanillaGridRow;
      // Una fila nueva (nunca confirmada) que se borra antes de confirmar no
      // necesita tombstone — simplemente nunca existió del lado del dominio.
      if (row && typeof row._rowId === "string" && !isNewRowId(row._rowId)) {
        deletedRef.current.push({ _rowId: row._rowId, _version: row._version, _deleted: true });
      }
    }
  }, []);

  const handleAfterRemoveRow = useCallback(() => {
    emitChange();
  }, [emitChange]);

  const handleAfterSelectionEnd = useCallback((row: number, column: number) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    // setState con updater funcional que devuelve la MISMA referencia cuando
    // la celda no cambió: Handsontable puede volver a disparar
    // afterSelectionEnd para la celda ya seleccionada como efecto colateral
    // de un updateSettings() (p. ej. al re-renderizar este componente por
    // otro motivo). Si acá siempre creáramos un objeto/string nuevo, React
    // nunca podría bailar del re-render aunque el valor sea idéntico, y ese
    // re-render dispara el próximo updateSettings → afterSelectionEnd →
    // setState — bucle infinito ("Maximum update depth exceeded"),
    // reproducido y confirmado en vivo antes de este fix.
    setSelectedCell((prev) => (prev && prev.row === row && prev.col === column ? prev : { row, col: column }));
    const raw = hot.getSourceDataAtCell(row, column);
    const next = raw === null || raw === undefined ? "" : String(raw);
    setFormulaBarValue((prev) => (prev === next ? prev : next));
  }, []);

  function commitFormulaBar() {
    if (!selectedCell) return;
    const hot = hotRef.current?.hotInstance;
    hot?.setDataAtCell(selectedCell.row, selectedCell.col, formulaBarValue, "PlanillaGrid.formulaBar");
  }

  // Botones visibles para lo que antes solo vivía en el menú contextual
  // (clic derecho) — insertar/eliminar fila, deshacer/rehacer. El menú
  // contextual sigue existiendo, esto es un atajo explícito para quien no
  // sabe que existe el clic derecho.
  function handleAddRow() {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const targetRow = selectedCell ? selectedCell.row : hot.countRows() - 1;
    hot.alter("insert_row_below", targetRow, 1);
  }

  function handleRemoveRow() {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !selectedCell) return;
    hot.alter("remove_row", selectedCell.row, 1);
  }

  function handleUndo() {
    hotRef.current?.hotInstance?.getPlugin("undoRedo").undo();
  }

  function handleRedo() {
    hotRef.current?.hotInstance?.getPlugin("undoRedo").redo();
  }

  const cellRef = selectedCell
    ? `${colIndexToLetter(selectedCell.col)}${selectedCell.row + 1}`
    : "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {!readOnly ? (
        <div className="flex items-center gap-1 h-9 px-2 border border-[var(--border)] border-b-0 rounded-t-lg bg-[var(--panel-2)] shrink-0">
          <button
            type="button"
            onClick={handleAddRow}
            title="Agregar fila"
            className="flex items-center gap-1 px-2 h-6 rounded text-[11px] text-[var(--foreground)] hover:bg-[var(--hover)]"
          >
            <Plus size={13} /> Fila
          </button>
          <button
            type="button"
            onClick={handleRemoveRow}
            disabled={!selectedCell}
            title="Eliminar fila seleccionada"
            className="flex items-center gap-1 px-2 h-6 rounded text-[11px] text-[var(--foreground)] hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Trash2 size={13} /> Eliminar
          </button>
          <span className="w-px h-4 bg-[var(--border)] mx-1" />
          <button
            type="button"
            onClick={handleUndo}
            title="Deshacer"
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--foreground)] hover:bg-[var(--hover)]"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            title="Rehacer"
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--foreground)] hover:bg-[var(--hover)]"
          >
            <Redo2 size={13} />
          </button>
        </div>
      ) : null}
      <div
        className={`flex items-center gap-2 h-9 px-2 border border-[var(--border)] border-b-0 bg-[var(--panel-2)] shrink-0 ${readOnly ? "rounded-t-lg" : ""}`}
      >
        <span className="text-[11px] font-mono text-[var(--muted)] w-12 text-center shrink-0">{cellRef || "—"}</span>
        <span className="text-[var(--border)]">|</span>
        <input
          value={formulaBarValue}
          onChange={(e) => setFormulaBarValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitFormulaBar();
          }}
          onBlur={commitFormulaBar}
          placeholder="fx"
          disabled={readOnly}
          className="flex-1 bg-transparent text-[12px] outline-none font-mono disabled:opacity-60"
        />
      </div>
      <div className="flex-1 min-h-0 border border-[var(--border)] rounded-b-lg overflow-hidden">
        <HotTable
          ref={hotRef}
          data={seedInitialRows}
          columns={htColumns}
          colHeaders={colHeaders}
          rowHeaders
          height="100%"
          width="100%"
          licenseKey={HANDSONTABLE_LICENSE_KEY}
          themeName="ht-theme-main-dark"
          formulas={formulasSettings}
          contextMenu={CONTEXT_MENU_ITEMS as unknown as string[]}
          fillHandle={FILL_HANDLE_SETTINGS}
          maxRows={MAX_ROWS}
          manualColumnResize
          manualRowResize
          readOnly={readOnly}
          undoRedoSnapshotLimit={200}
          afterChange={handleAfterChange}
          afterCreateRow={handleAfterCreateRow}
          beforeRemoveRow={handleBeforeRemoveRow}
          afterRemoveRow={handleAfterRemoveRow}
          afterSelectionEnd={handleAfterSelectionEnd}
        />
      </div>
    </div>
  );
});

export { HANDSONTABLE_LICENSE_KEY };
