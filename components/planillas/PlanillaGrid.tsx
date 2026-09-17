"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HotTable } from "@handsontable/react-wrapper";
import type { HotTableRef } from "@handsontable/react-wrapper";
import Handsontable from "handsontable";
import { registerAllModules } from "handsontable/registry";
import { HyperFormula } from "hyperformula";
import { Plus, Trash2, Undo2, Redo2, Bold, AlignLeft, AlignCenter, AlignRight, Ban, Paintbrush, Search } from "lucide-react";
import type { PlanillaColumn, PlanillaRowMeta, PlanillaRowStyle } from "@/lib/planillas/types";
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

// Paleta chica y fija (no un color picker libre) — alcanza para lo que se
// pidió ("aunque sea las básicas") y evita el problema de generar clases CSS
// dinámicas para cualquier hex arbitrario. Los valores ya están pensados
// para verse bien tanto en modo claro como oscuro del tema del panel.
const FONT_COLORS = [
  { key: "red", hex: "#f2685c" },
  { key: "amber", hex: "#f5a524" },
  { key: "green", hex: "#2dd4bf" },
  { key: "blue", hex: "#60a5fa" },
] as const;
const BG_COLORS = [
  { key: "yellow", hex: "rgba(245,165,36,0.22)" },
  { key: "red", hex: "rgba(242,104,92,0.18)" },
  { key: "green", hex: "rgba(45,212,191,0.16)" },
  { key: "blue", hex: "rgba(96,165,250,0.16)" },
] as const;

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
  // Copiar formato: dos clics, como el "brush" de Excel. El primero (botón
  // Paintbrush) copia el estilo de la fila seleccionada acá; el siguiente
  // clic en OTRA fila lo aplica (reemplaza, no mezcla) y apaga el modo.
  const [isPainting, setIsPainting] = useState(false);
  const paintedStyleRef = useRef<PlanillaRowStyle | null>(null);

  // "Filtros": buscar y RESALTAR filas coincidentes, no ocultarlas. El
  // filtro nativo de Handsontable (filters/dropdownMenu) oculta filas
  // reordenando índice visual vs. físico — reconciliar eso con rowStylesRef
  // (indexado por fila física) en todos los puntos que ya lo usan
  // (applyRowStyle, autosuma, copiar formato, los botones de fila) es un
  // trabajo mucho más grande y arriesgado que lo que da a entender agregar
  // dos props. Resaltar sin ocultar evita ese problema por completo.
  // searchTermRef en vez de un dependency de applyStylesToDom a propósito:
  // ese callback se pasa como `afterRender`, y el wrapper de Handsontable
  // llama a updateSettings() cada vez que esa prop cambia de referencia
  // (ver el comentario grande sobre memo() más abajo) — si dependiera del
  // estado de búsqueda, tipear en el buscador dispararía ese mismo problema.
  const searchTermRef = useRef("");
  const [searchInputValue, setSearchInputValue] = useState("");

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

  // Espejo del formato por fila, indexado por posición física — NO se lee
  // llamando a hot.getSourceDataAtRow() desde dentro de cells() (ver abajo):
  // eso reentra en la resolución de metadatos de Handsontable mientras
  // todavía está en curso y tira "Assertion failed: Expecting an unsigned
  // number" (confirmado en vivo). cells() y el estado de los botones del
  // toolbar leen de acá; applyRowStyle() y los handlers de alta/baja de fila
  // son los únicos que lo escriben, en paralelo a la data real de Handsontable.
  const rowStylesRef = useRef<(PlanillaRowStyle | undefined)[]>(seedInitialRows.map((r) => r._style));

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
      // getSourceData() no devuelve de forma confiable el objeto _style que
      // se mutó a mano en applyRowStyle (Handsontable no garantiza misma
      // referencia) — rowStylesRef es la fuente de verdad para esto, no la
      // data de Handsontable.
      const style = rowStylesRef.current[rowIndex];
      if (style) resolved._style = style;
      else delete resolved._style;
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
      rowStylesRef.current.splice(index, 0, ...new Array(amount).fill(undefined));
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
    rowStylesRef.current.splice(index, amount);
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

    // Segundo clic del "copiar formato": aplica lo copiado a esta fila
    // (reemplaza entera, no mezcla con lo que ya tenía) y apaga el modo.
    // applyStylesToDom/emitChange no están en las deps a propósito (mismo
    // criterio que el resto de los handlers de este componente): ambos
    // memoizan a una referencia estable durante toda la vida del componente,
    // así que este closure siempre ve la versión correcta sin necesidad de
    // volver a registrar el hook — que es justamente lo que hay que evitar acá.
    if (paintedStyleRef.current) {
      rowStylesRef.current[row] = { ...paintedStyleRef.current };
      paintedStyleRef.current = null;
      setIsPainting(false);
      applyStylesToDom();
      emitChange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Copiar formato ("brush" de Excel): un botón, dos clics. Acá solo copia;
  // quien lo APLICA es handleAfterSelectionEnd (arriba), en el próximo clic.
  function handleStartPaintFormat() {
    if (!selectedCell) return;
    paintedStyleRef.current = { ...(rowStylesRef.current[selectedCell.row] ?? {}) };
    setIsPainting(true);
  }

  function handleSearchChange(value: string) {
    setSearchInputValue(value);
    searchTermRef.current = value;
    applyStylesToDom();
  }

  // Formato por FILA (no por celda individual) — coincide con el caso de uso
  // real (marcar toda la fila de un título de sección en negrita) y evita un
  // modelo mucho más pesado. Se persiste en budget_items.style (ver
  // 0094_budget_items_row_style.sql) — puramente visual, nunca entra en
  // ningún cálculo ni lo toca el RPC de confirmación más que para guardarlo.
  function applyRowStyle(patch: Partial<PlanillaRowStyle>) {
    const hot = hotRef.current?.hotInstance;
    if (!hot || !selectedCell) return;
    // rowStylesRef es la ÚNICA fuente de verdad para el formato — nunca pasa
    // por la data de Handsontable. hot.setDataAtRowProp con un valor OBJETO
    // en una prop no declarada como columna ("_style") rompe algo interno de
    // Handsontable ("Assertion failed: Expecting an unsigned number",
    // confirmado en vivo, tres implementaciones distintas fallaron igual). Y
    // mutar a mano el objeto que devuelve getSourceDataAtRow() tampoco sirve:
    // getSourceData() (que usa emitChange) no garantiza devolver esa misma
    // referencia. cellsSettings/applyStylesToDom pintan desde acá, y
    // emitChange también lee de acá para lo que viaja a autosave/confirmar.
    const current: PlanillaRowStyle = rowStylesRef.current[selectedCell.row] ?? {};
    rowStylesRef.current[selectedCell.row] = { ...current, ...patch };
    applyStylesToDom();
    emitChange();
  }

  const selectedRowStyle: PlanillaRowStyle = selectedCell
    ? rowStylesRef.current[selectedCell.row] ?? {}
    : {};

  // El setting `cells()` de Handsontable, combinado con el resto de plugins
  // activos acá (formulas + undoRedo + filas dinámicas), tira "Assertion
  // failed: Expecting an unsigned number" al primer setDataAtRowProp
  // (confirmado en vivo, dos intentos distintos de implementación de cells()
  // fallaron igual). En vez de pelear con esa combinación, el formato se
  // aplica directo sobre el DOM ya renderizado (afterRender) — Handsontable
  // vuelve a llamar afterRender después de cualquier cambio de datos, así
  // que alcanza para mantenerlo sincronizado sin tocar su resolución interna
  // de metadatos de celda para nada.
  // Índices de columnas numéricas (no de texto) — para el separador de
  // miles de abajo. Se recalcula solo si cambian las columnas (estable en
  // la vida de una sesión de planilla, mismo criterio que htColumns).
  const numericColIndexes = useMemo(
    () => columns.map((c, i) => (c.type !== "text" ? i : -1)).filter((i) => i >= 0),
    [columns]
  );

  const applyStylesToDom = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    // rowStylesRef está indexado por fila FÍSICA (así se mantiene en
    // afterCreateRow/beforeRemoveRow), pero hot.getCell()/getDataAtCell()
    // esperan fila VISUAL — con los filtros activos ambas dejan de coincidir
    // (una fila filtrada no tiene índice visual). Sin esta conversión, con
    // un filtro puesto el formato terminaría pintando la fila equivocada.
    const term = searchTermRef.current.trim().toLowerCase();
    const rowCount = hot.countRows();
    for (let physicalRow = 0; physicalRow < rowCount; physicalRow++) {
      const visualRow = hot.toVisualRow(physicalRow);
      if (visualRow === null || visualRow === undefined || visualRow < 0) continue; // fila oculta por un filtro
      const style = rowStylesRef.current[physicalRow];
      const rowData = hot.getSourceDataAtRow(physicalRow) as PlanillaGridRow | undefined;
      const isMatch =
        term.length > 0 &&
        rowData !== undefined &&
        Object.entries(rowData).some(
          ([key, v]) => !key.startsWith("_") && v !== null && v !== undefined && String(v).toLowerCase().includes(term)
        );
      const classes = [
        style?.bold ? "plr-bold" : "",
        style?.align ? `plr-align-${style.align}` : "",
        style?.color ? `plr-fg-${style.color}` : "",
        style?.bg ? `plr-bg-${style.bg}` : "",
        isMatch ? "plr-search-match" : "",
      ].filter(Boolean);
      // Filtro real (ocultar, no solo resaltar) — pero por CSS sobre el <tr>
      // ya renderizado, nunca vía el plugin de filtros de Handsontable. Ese
      // plugin oculta filas remapeando índice visual/físico, y reconciliar
      // eso con rowStylesRef (que asume visual === físico en todos lados:
      // applyRowStyle, copiar formato, alta/baja de fila) en cada punto que
      // ya lo usa es un trabajo mucho más grande y con más superficie para
      // otro bug como el de autosuma. Ocultando el <tr> por fuera,
      // Handsontable ni se entera — countRows()/getCell() siguen viendo
      // TODAS las filas, visual sigue siendo igual a físico siempre, y todo
      // lo demás sigue funcionando exactamente igual que sin filtro.
      const firstTd = hot.getCell(visualRow, 0);
      const tr = firstTd?.parentElement as HTMLTableRowElement | null | undefined;
      if (tr) tr.style.display = term.length > 0 && !isMatch ? "none" : "";
      const colCount = hot.countCols();
      for (let col = 0; col < colCount; col++) {
        const td = hot.getCell(visualRow, col);
        if (!td) continue; // fuera del viewport virtualizado
        td.className = td.className.replace(/\bplr-\S+/g, "").trim();
        if (classes.length) td.classList.add(...classes);
        // Separador de miles — post-proceso sobre lo que Handsontable ya
        // renderizó (mismo mecanismo que las clases de arriba), no toca la
        // data ni un renderer custom: Cantidad/Precio unitario/Subtotal se
        // ven con formato de miles en vez de un número corrido.
        if (numericColIndexes.includes(col)) {
          const value = hot.getDataAtCell(visualRow, col);
          if (typeof value === "number" && Number.isFinite(value)) {
            td.textContent = value.toLocaleString("es-PY", { maximumFractionDigits: 2 });
          }
        }
      }
    }
  }, [numericColIndexes]);

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
          <span className="w-px h-4 bg-[var(--border)] mx-1" />
          <button
            type="button"
            onClick={handleStartPaintFormat}
            disabled={!selectedCell}
            title="Copiar formato — elegí la fila origen, después clic en la fila destino"
            aria-pressed={isPainting}
            className={`flex items-center gap-1 px-2 h-6 rounded text-[11px] disabled:opacity-40 disabled:hover:bg-transparent ${
              isPainting ? "bg-[var(--primary)] text-[#1a0e00]" : "text-[var(--foreground)] hover:bg-[var(--hover)]"
            }`}
          >
            <Paintbrush size={13} /> Copiar formato
          </button>
          <span className="w-px h-4 bg-[var(--border)] mx-1" />
          <div className="flex items-center gap-1 h-6 px-2 rounded border border-[var(--border)] bg-[var(--panel)]">
            <Search size={12} className="text-[var(--muted)]" />
            <input
              value={searchInputValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Filtrar…"
              title="Oculta las filas que no coincidan con el texto"
              className="w-40 bg-transparent text-[11px] outline-none"
            />
          </div>
        </div>
      ) : null}
      {!readOnly ? (
        <div className="flex items-center gap-1 h-9 px-2 border border-[var(--border)] border-b-0 bg-[var(--panel-2)] shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => applyRowStyle({ bold: !selectedRowStyle.bold })}
            disabled={!selectedCell}
            title="Negrita (toda la fila)"
            aria-pressed={Boolean(selectedRowStyle.bold)}
            className={`flex items-center justify-center w-6 h-6 rounded disabled:opacity-40 ${
              selectedRowStyle.bold ? "bg-[var(--primary)] text-[#1a0e00]" : "text-[var(--foreground)] hover:bg-[var(--hover)]"
            }`}
          >
            <Bold size={13} />
          </button>
          <span className="w-px h-4 bg-[var(--border)] mx-1" />
          {(
            [
              ["left", AlignLeft, "Alinear izquierda"],
              ["center", AlignCenter, "Centrar"],
              ["right", AlignRight, "Alinear derecha"],
            ] as const
          ).map(([align, Icon, label]) => (
            <button
              key={align}
              type="button"
              onClick={() => applyRowStyle({ align })}
              disabled={!selectedCell}
              title={label}
              aria-pressed={selectedRowStyle.align === align}
              className={`flex items-center justify-center w-6 h-6 rounded disabled:opacity-40 ${
                selectedRowStyle.align === align
                  ? "bg-[var(--primary)] text-[#1a0e00]"
                  : "text-[var(--foreground)] hover:bg-[var(--hover)]"
              }`}
            >
              <Icon size={13} />
            </button>
          ))}
          <span className="w-px h-4 bg-[var(--border)] mx-1" />
          <span className="text-[10px] text-[var(--muted)] mr-0.5">Color</span>
          <button
            type="button"
            onClick={() => applyRowStyle({ color: undefined })}
            disabled={!selectedCell}
            title="Sin color de texto"
            className="flex items-center justify-center w-5 h-5 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--hover)]"
          >
            <Ban size={11} className="text-[var(--muted)]" />
          </button>
          {FONT_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => applyRowStyle({ color: c.key })}
              disabled={!selectedCell}
              title={`Texto ${c.key}`}
              aria-pressed={selectedRowStyle.color === c.key}
              className={`w-5 h-5 rounded-full disabled:opacity-40 ${
                selectedRowStyle.color === c.key ? "ring-2 ring-[var(--foreground)]" : ""
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
          <span className="w-px h-4 bg-[var(--border)] mx-1" />
          <span className="text-[10px] text-[var(--muted)] mr-0.5">Resaltar</span>
          <button
            type="button"
            onClick={() => applyRowStyle({ bg: undefined })}
            disabled={!selectedCell}
            title="Sin resaltado"
            className="flex items-center justify-center w-5 h-5 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--hover)]"
          >
            <Ban size={11} className="text-[var(--muted)]" />
          </button>
          {BG_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => applyRowStyle({ bg: c.key })}
              disabled={!selectedCell}
              title={`Resaltar ${c.key}`}
              aria-pressed={selectedRowStyle.bg === c.key}
              className={`w-5 h-5 rounded-full border border-[var(--border)] disabled:opacity-40 ${
                selectedRowStyle.bg === c.key ? "ring-2 ring-[var(--foreground)]" : ""
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
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
          afterRender={applyStylesToDom}
        />
      </div>
      {/* Clases fijas para la paleta de formato — no hay hex arbitrario, así
          que no hace falta generar CSS dinámico por fila. */}
      <style>{`
        .plr-bold { font-weight: 700 !important; }
        .plr-align-left { text-align: left !important; }
        .plr-align-center { text-align: center !important; }
        .plr-align-right { text-align: right !important; }
        .plr-fg-red { color: #f2685c !important; }
        .plr-fg-amber { color: #f5a524 !important; }
        .plr-fg-green { color: #2dd4bf !important; }
        .plr-fg-blue { color: #60a5fa !important; }
        .plr-bg-yellow { background-color: rgba(245,165,36,0.22) !important; }
        .plr-bg-red { background-color: rgba(242,104,92,0.18) !important; }
        .plr-bg-green { background-color: rgba(45,212,191,0.16) !important; }
        .plr-bg-blue { background-color: rgba(96,165,250,0.16) !important; }
        /* Va al final a propósito: gana por orden de declaración (misma
           especificidad + !important que las de fondo) cuando una fila con
           resaltado propio también matchea la búsqueda. */
        .plr-search-match { background-color: rgba(45,212,191,0.32) !important; }
      `}</style>
    </div>
  );
});

export { HANDSONTABLE_LICENSE_KEY };
