"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HotTable } from "@handsontable/react-wrapper";
import type { HotTableRef } from "@handsontable/react-wrapper";
import Handsontable from "handsontable";
import { registerAllModules } from "handsontable/registry";
import { HyperFormula } from "hyperformula";
import { Plus, Trash2, Undo2, Redo2, Bold, AlignLeft, AlignCenter, AlignRight, Ban, Paintbrush, Search, Filter, X } from "lucide-react";
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
  // Refs para alinear la barra de filtros con las columnas reales de
  // Handsontable — ver syncFilterBarWidths más abajo.
  const filterButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const filterSpacerRef = useRef<HTMLSpanElement>(null);
  // true recién después de que Handsontable termina su propia construcción
  // interna (afterInit) — ver el comentario grande en handleAfterCreateRow
  // sobre por qué hace falta esta bandera.
  const readyRef = useRef(false);
  const [formulaBarValue, setFormulaBarValue] = useState("");
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  // _rowId de la fila actualmente seleccionada — ver el comentario grande
  // sobre rowStylesRef más abajo sobre por qué el formato se indexa por acá
  // y no por selectedCell.row.
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  // Copiar formato: dos clics, como el "brush" de Excel. El primero (botón
  // Paintbrush) copia el estilo de la fila seleccionada acá; el siguiente
  // clic en OTRA fila lo aplica (reemplaza, no mezcla) y apaga el modo.
  const [isPainting, setIsPainting] = useState(false);
  const paintedStyleRef = useRef<PlanillaRowStyle | null>(null);

  // Filtro real: oculta filas que no coincidan con el texto (ver
  // applyStylesToDom). searchTermRef en vez de un dependency de applyStylesToDom a propósito:
  // ese callback se pasa como `afterRender`, y el wrapper de Handsontable
  // llama a updateSettings() cada vez que esa prop cambia de referencia
  // (ver el comentario grande sobre memo() más abajo) — si dependiera del
  // estado de búsqueda, tipear en el buscador dispararía ese mismo problema.
  const searchTermRef = useRef("");
  const [searchInputValue, setSearchInputValue] = useState("");

  // Filtro real por columna (checkboxes por valor, como el filtro de Excel) —
  // construido a propósito sobre el MISMO mecanismo que el buscador de arriba
  // (ocultar <tr> ya renderizado en afterRender) y no sobre el plugin nativo
  // de Handsontable (filters/dropdownMenu). Ese plugin nativo se probó en
  // vivo y crashea la página entera ("Cannot read properties of null
  // (reading 'getEntries')") — el motivo real, confirmado leyendo el código
  // fuente de Handsontable: ese error sale cuando el estado interno del
  // plugin de filtros ya fue destruido (`filteringStates = null`) pero algo
  // todavía intenta leerlo, y ESTE componente llama a hot.updateSettings() en
  // cada re-render propio (ver el comentario grande sobre memo() más arriba)
  // — la combinación es inherentemente fresco para ese crash, no es un bug
  // puntual reparable con un ajuste chico. Por eso el filtro por columna vive
  // enteramente afuera del motor de Handsontable: Map<colKey, Set<valor
  // excluido>> — un Set vacío/ausente significa "sin filtro en esa columna".
  const filterValuesRef = useRef<Map<string, Set<string>>>(new Map());
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState<Set<string> | null>(null);
  // Se recalcula solo al abrir un dropdown (no en cada render) — mismo
  // criterio que el resto de este componente respecto a no disparar trabajo
  // extra en cada tecla.
  const [filterOptions, setFilterOptions] = useState<string[]>([]);
  // Fuerza a applyStylesToDom a recalcularse tras cambiar un filtro sin
  // pasar por props/settings de Handsontable (por lo mismo que el comentario
  // de arriba: no queremos que esto dispare updateSettings()).
  const [filterVersion, setFilterVersion] = useState(0);

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

  // Fila vacía con identidad propia — usada para sembrar la fila vacía
  // final (ver seedInitialRows y ensureTrailingSpareRow más abajo) sin
  // depender de que Handsontable la cree sola.
  function makeSpareRow(rowIndex0: number): PlanillaGridRow {
    const row: PlanillaGridRow = { _rowId: newRowId(), _version: null };
    for (const col of columns) row[col.key] = null;
    return applyFormulaDefaults(row, rowIndex0);
  }

  // Estado con inicializador perezoso, NO un valor recalculado en cada
  // render: si `data` recibiera un array con una referencia nueva en cada
  // render, Handsontable lo trata como una carga de datos nueva, dispara
  // afterChange, que llama a onChange del padre, que re-renderiza este
  // componente — bucle infinito ("Maximum update depth exceeded"),
  // reproducido y confirmado en components/planillas antes de este fix.
  // `initialRows` es el snapshot con el que arranca la sesión y no cambia
  // en su vida útil, así que una sola computación al montar es correcta.
  // Piso de filas en blanco al montar — que la hoja recién generada se vea
  // y se sienta como una hoja de Excel real (varias filas vacías listas
  // para escribir), no como una lista de 1 renglón que crece de a uno por
  // cada click en "+ Fila". Sin esto, un proyecto sin ítems (0 filas del
  // adaptador) mostraba una sola fila vacía al abrir la planilla.
  const MIN_BLANK_ROWS = 20;

  const [seedInitialRows] = useState(() => {
    const rows = initialRows.map((r, i) => applyFormulaDefaults({ ...r }, i));
    // Siempre termina con al menos MIN_BLANK_ROWS filas vacías (ver
    // ensureTrailingSpareRow para el comportamiento en régimen, que sigue
    // agregando de a una) para que la grilla se sienta como Excel de
    // verdad. Se siembra ACÁ, antes de montar, en vez de dejar que
    // Handsontable las cree solas al iniciar: confirmado en vivo que crear
    // una fila durante la construcción interna de Handsontable (antes de
    // que el editor esté listo) revienta con "Cannot read properties of
    // undefined (reading 'getActiveEditor')" en cuanto handleAfterCreateRow
    // llama a hot.setDataAtRowProp() en ese momento (proyecto sin ítems, 0
    // filas iniciales, es el caso que más lo dispara).
    const blanksNeeded = Math.max(1, MIN_BLANK_ROWS - rows.length);
    for (let i = 0; i < blanksNeeded; i++) rows.push(makeSpareRow(rows.length));
    return rows;
  });

  // Espejo del formato por fila — indexado por _rowId (identidad estable de
  // la fila, REGLA #8 de este motor), NUNCA por posición. Confirmado leyendo
  // el código fuente de Handsontable: alter/setDataAtCell/getCell/
  // getDataAtCell usan índice VISUAL, pero getSourceDataAtRow usa índice
  // FÍSICO — con un filtro que oculte filas ninguno de los dos es estable
  // entre re-renders (una fila puede aparecer/desaparecer de la vista, y su
  // posición física puede no coincidir con la visual). Este diseño ya
  // resuelve ese problema; lo que se sacó fue el PLUGIN nativo de filtros de
  // Handsontable en sí (filters/dropdownMenu) — probado en vivo, tira
  // "Cannot read properties of null (reading 'getEntries')" y rompe toda la
  // página al aplicar un filtro. El buscador propio (texto libre,
  // searchTermRef más abajo) sigue andando y ya ejercita este mismo diseño
  // ocultando filas, sin ese crash.
  // Atar el formato a la IDENTIDAD de la fila en vez de a un índice numérico
  // hace que el problema desaparezca solo: no importa dónde esté la fila
  // ni si está oculta por el filtro, su formato la sigue. Como bonus, ya no
  // hace falta mantenerlo sincronizado a mano en alta/baja de fila (antes:
  // splice en handleAfterCreateRow/handleBeforeRemoveRow) — un Map no
  // necesita eso.
  //
  // No se lee llamando a hot.getSourceDataAtRow() desde DENTRO de cells():
  // eso reentra en la resolución de metadatos de Handsontable mientras
  // todavía está en curso y tira "Assertion failed: Expecting an unsigned
  // number" (confirmado en vivo) — por eso el formato se pinta en
  // afterRender (applyStylesToDom), no en cells().
  const rowStylesRef = useRef<Map<string, PlanillaRowStyle>>(
    new Map(seedInitialRows.filter((r) => r._style).map((r) => [r._rowId, r._style!]))
  );

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
    // getSourceData() devuelve en orden FÍSICO (mismo que getSourceDataAtRow),
    // pero getDataAtCell espera índice VISUAL — hace falta convertir antes de
    // usarlo, si no con un filtro activo se lee la celda equivocada.
    const sourceRows = hot.getSourceData() as PlanillaGridRow[];
    const current = sourceRows.map((row, physicalRowIndex) => {
      const resolved: PlanillaGridRow = { ...row };
      const visualRowIndex = hot.toVisualRow(physicalRowIndex);
      columns.forEach((col, colIndex) => {
        const raw = resolved[col.key];
        if (typeof raw === "string" && raw.trim().startsWith("=")) {
          // Fila oculta por el filtro: no tiene índice visual, y por lo
          // tanto no hay forma segura de pedirle a Handsontable el valor
          // calculado. No debería pasar en la práctica (no se puede editar
          // una celda que no está visible), pero mejor dejar el valor crudo
          // tal cual que mandar un número incorrecto al servidor.
          if (visualRowIndex !== null && visualRowIndex !== undefined) {
            resolved[col.key] = hot.getDataAtCell(visualRowIndex, colIndex);
          }
        }
      });
      // rowStylesRef es la fuente de verdad para el formato, indexado por
      // _rowId (identidad estable) — no por posición.
      const style = typeof row._rowId === "string" ? rowStylesRef.current.get(row._rowId) : undefined;
      if (style) resolved._style = style;
      else delete resolved._style;
      return resolved;
    });
    onChangeRef.current([...current, ...deletedRef.current]);
  }, [columns]);

  // Mantiene siempre UNA fila vacía al final, como una hoja de Excel real —
  // así el usuario nunca tiene que acordarse de clickear "Fila" para poder
  // seguir cargando renglones.
  //
  // Esto NO usa la opción nativa `minSpareRows` de Handsontable — se probó
  // en vivo y causó un loop de crecimiento sin control (pasó de 4 a más de
  // 280 filas y colgó la pestaña, confirmado por los warnings en consola
  // "Not possible to set cell data" de HyperFormula al superar el tamaño de
  // la hoja). La causa: toda fila, incluso una vacía, ya trae precargada la
  // fórmula del Subtotal (applyFormulaDefaults/resolveFormulaTemplate) — así
  // que para Handsontable esa fila NUNCA cuenta como "vacía"
  // (countEmptyRows), y como este componente llama a hot.updateSettings()
  // en cada re-render propio (ver el comentario grande sobre memo() más
  // arriba), cada render volvía a evaluar minSpareRows, veía "cero filas
  // vacías" y agregaba otra — para siempre. Acá el criterio de "vacía" lo
  // decidimos nosotros (ignora la columna con fórmula propia) y el disparo
  // es explícito, una sola vez por edición real — sin loop posible.
  const ensureTrailingSpareRow = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || readOnly || hot.countRows() >= MAX_ROWS) return;
    const lastRow = hot.countRows() - 1;
    // La grilla se quedó sin filas (se borraron todas) — hace falta una
    // fila vacía para poder seguir escribiendo, no solo cuando la ÚLTIMA
    // tiene datos.
    if (lastRow < 0) {
      hot.alter("insert_row_below", null as unknown as number, 1);
      return;
    }
    const rowData = hot.getSourceDataAtRow(lastRow) as PlanillaGridRow | undefined;
    if (!rowData) return;
    const isBlank = columns.every((col) => {
      if (col.formulaTemplate) return true;
      const v = rowData[col.key];
      return v === null || v === undefined || v === "";
    });
    if (!isBlank) hot.alter("insert_row_below", lastRow, 1);
  }, [columns, readOnly]);

  const handleAfterChange = useCallback(
    (_changes: unknown, source: string) => {
      if (source === "loadData") return;
      emitChange();
      ensureTrailingSpareRow();
    },
    [emitChange, ensureTrailingSpareRow]
  );

  const handleAfterCreateRow = useCallback(
    (index: number, amount: number) => {
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      // rowStylesRef ya no necesita sincronizarse a mano acá — es un Map por
      // _rowId, no un array por posición. Una fila nueva no tiene entrada
      // hasta que se le aplique formato explícitamente.
      //
      // readyRef (ver afterInit en <HotTable>): Handsontable puede disparar
      // afterCreateRow para filas propias DURANTE su propia construcción
      // interna, antes de que el editor esté listo — confirmado en vivo
      // contra una planilla recién generada sin ítems (crashea con "Cannot
      // read properties of undefined (reading 'getActiveEditor')" apenas
      // este handler llama a hot.setDataAtRowProp en ese momento, sin
      // importar startRows). En esa ventana puntual (antes de afterInit)
      // esta función NUNCA llama a una API de Handsontable: muta el objeto
      // de la fila directo, que es seguro porque el resto de los plugins
      // (fórmulas incluido) todavía no arrancaron su propio escaneo inicial
      // — van a leer estos valores como si vinieran de la carga inicial,
      // mismo mecanismo que seedInitialRows/makeSpareRow más arriba.
      // Después de afterInit (alta de fila real por el usuario, vía el
      // botón "Fila" o ensureTrailingSpareRow) sigue usando
      // setDataAtRowProp como siempre, que ya está probado en vivo.
      for (let i = 0; i < amount; i++) {
        const rowIndex = index + i;
        if (!readyRef.current) {
          const row = hot.getSourceDataAtRow(rowIndex) as PlanillaGridRow | undefined;
          if (row) {
            row._rowId = newRowId();
            row._version = null;
            for (const col of formulaColumns) {
              if (col.formulaTemplate) row[col.key] = resolveFormulaTemplate(col.formulaTemplate, rowIndex + 1);
            }
          }
          continue;
        }
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
      // emitChange también llama a APIs de Handsontable (getSourceData,
      // toVisualRow, getDataAtCell) — mismo motivo, no se llama todavía si
      // la construcción sigue en curso. El padre ya tiene el snapshot
      // inicial correcto (seedInitialRows), así que no hace falta notificar
      // nada antes de que la grilla esté lista para interactuar.
      if (readyRef.current) emitChange();
    },
    [emitChange, formulaColumns]
  );

  const handleBeforeRemoveRow = useCallback((_index: number, _amount: number, physicalRows: number[]) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    // physicalRows: Handsontable lo manda listo, son los índices FÍSICOS
    // reales que se van a borrar — no calcularlos a mano a partir de index
    // (VISUAL) + amount, que con un filtro activo no necesariamente son
    // consecutivos ni coinciden con la posición física.
    for (const physicalRow of physicalRows) {
      const row = hot.getSourceDataAtRow(physicalRow) as PlanillaGridRow;
      // Una fila nueva (nunca confirmada) que se borra antes de confirmar no
      // necesita tombstone — simplemente nunca existió del lado del dominio.
      if (row && typeof row._rowId === "string" && !isNewRowId(row._rowId)) {
        deletedRef.current.push({ _rowId: row._rowId, _version: row._version, _deleted: true });
      }
      if (row && typeof row._rowId === "string") rowStylesRef.current.delete(row._rowId);
    }
  }, []);

  const handleAfterRemoveRow = useCallback(() => {
    emitChange();
    ensureTrailingSpareRow();
  }, [emitChange, ensureTrailingSpareRow]);

  // La barra de filtros ("Filtrar por: Código Descripción...") es una fila
  // de botones propia, fuera de Handsontable — NO usa sus anchos de columna
  // reales (col.width es solo el ancho INICIAL que Handsontable recibe;
  // manualColumnResize puede cambiarlo después, y el ancho de la columna de
  // números de fila lo calcula Handsontable solo, sin API pública para
  // leerlo). Confirmado en vivo contra producción: los botones quedaban
  // angostos-según-su-texto y corridos respecto a las columnas de la grilla
  // de abajo. Se mide el <th> real ya renderizado y se copia su ancho en px
  // a cada botón — así quedan pixel-perfect sin importar resize manual.
  const syncFilterBarWidths = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const headerRow = hot.rootElement.querySelector<HTMLTableRowElement>(".ht_master table thead tr");
    const ths = headerRow ? Array.from(headerRow.querySelectorAll<HTMLElement>("th")) : [];
    if (!ths.length) return;
    if (filterSpacerRef.current) {
      filterSpacerRef.current.style.width = `${ths[0].getBoundingClientRect().width}px`;
    }
    columns.forEach((col, i) => {
      const th = ths[i + 1];
      const btn = filterButtonRefs.current.get(col.key);
      if (th && btn) btn.style.width = `${th.getBoundingClientRect().width}px`;
    });
  }, [columns]);

  const handleAfterInit = useCallback(() => {
    readyRef.current = true;
    syncFilterBarWidths();
  }, [syncFilterBarWidths]);

  const handleAfterColumnResize = useCallback(() => {
    syncFilterBarWidths();
  }, [syncFilterBarWidths]);

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

    // row/column acá son índices VISUALES (así los manda Handsontable en
    // este hook) — getSourceDataAtCell/getSourceDataAtRow esperan índice
    // FÍSICO. toPhysicalRow es la única conversión que hace falta en todo
    // este componente ahora: de acá sale tanto el valor mostrado en la fx
    // bar como el _rowId que identifica la fila para el formato (ver el
    // comentario grande sobre rowStylesRef).
    const physicalRow = hot.toPhysicalRow(row);
    const rowData = physicalRow !== null ? (hot.getSourceDataAtRow(physicalRow) as PlanillaGridRow | undefined) : undefined;
    const rowId = typeof rowData?._rowId === "string" ? rowData._rowId : null;
    setSelectedRowId((prev) => (prev === rowId ? prev : rowId));

    const raw = rowData ? rowData[columns[column]?.key ?? ""] : undefined;
    const next = raw === null || raw === undefined ? "" : String(raw);
    setFormulaBarValue((prev) => (prev === next ? prev : next));

    // Segundo clic del "copiar formato": aplica lo copiado a esta fila
    // (reemplaza entera, no mezcla con lo que ya tenía) y apaga el modo.
    // applyStylesToDom/emitChange no están en las deps a propósito (mismo
    // criterio que el resto de los handlers de este componente): ambos
    // memoizan a una referencia estable durante toda la vida del componente,
    // así que este closure siempre ve la versión correcta sin necesidad de
    // volver a registrar el hook — que es justamente lo que hay que evitar acá.
    if (paintedStyleRef.current && rowId) {
      rowStylesRef.current.set(rowId, { ...paintedStyleRef.current });
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
    if (!selectedRowId) return;
    paintedStyleRef.current = { ...(rowStylesRef.current.get(selectedRowId) ?? {}) };
    setIsPainting(true);
  }

  function handleSearchChange(value: string) {
    setSearchInputValue(value);
    searchTermRef.current = value;
    applyStylesToDom();
  }

  function formatFilterValue(v: unknown): string {
    if (v === null || v === undefined || v === "") return "(vacío)";
    return String(v);
  }

  function handleOpenFilter(colKey: string) {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const source = hot.getSourceData() as PlanillaGridRow[];
    const uniques = Array.from(new Set(source.map((r) => formatFilterValue(r[colKey])))).sort((a, b) =>
      a.localeCompare(b, "es")
    );
    setFilterOptions(uniques);
    const excluded = filterValuesRef.current.get(colKey) ?? new Set<string>();
    // Draft = lo que queda TILDADO (opuesto al Set de excluidos que se
    // persiste) — más natural para pintar checkboxes.
    setFilterDraft(new Set(uniques.filter((v) => !excluded.has(v))));
    setOpenFilterCol((prev) => (prev === colKey ? null : colKey));
  }

  function toggleFilterDraftValue(value: string) {
    setFilterDraft((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function handleApplyFilter() {
    if (!openFilterCol || !filterDraft) return;
    const excluded = new Set(filterOptions.filter((v) => !filterDraft.has(v)));
    if (excluded.size === 0) filterValuesRef.current.delete(openFilterCol);
    else filterValuesRef.current.set(openFilterCol, excluded);
    setOpenFilterCol(null);
    setFilterDraft(null);
    setFilterVersion((v) => v + 1);
    applyStylesToDom();
  }

  function handleClearOneFilter(colKey: string) {
    filterValuesRef.current.delete(colKey);
    setOpenFilterCol(null);
    setFilterDraft(null);
    setFilterVersion((v) => v + 1);
    applyStylesToDom();
  }

  function handleClearAllFilters() {
    filterValuesRef.current.clear();
    setOpenFilterCol(null);
    setFilterDraft(null);
    setFilterVersion((v) => v + 1);
    applyStylesToDom();
  }

  const activeFilterCount = filterValuesRef.current.size;

  // Formato por FILA (no por celda individual) — coincide con el caso de uso
  // real (marcar toda la fila de un título de sección en negrita) y evita un
  // modelo mucho más pesado. Se persiste en budget_items.style (ver
  // 0094_budget_items_row_style.sql) — puramente visual, nunca entra en
  // ningún cálculo ni lo toca el RPC de confirmación más que para guardarlo.
  function applyRowStyle(patch: Partial<PlanillaRowStyle>) {
    if (!selectedRowId) return;
    // rowStylesRef es la ÚNICA fuente de verdad para el formato — nunca pasa
    // por la data de Handsontable. hot.setDataAtRowProp con un valor OBJETO
    // en una prop no declarada como columna ("_style") rompe algo interno de
    // Handsontable ("Assertion failed: Expecting an unsigned number",
    // confirmado en vivo, tres implementaciones distintas fallaron igual). Y
    // mutar a mano el objeto que devuelve getSourceDataAtRow() tampoco sirve:
    // getSourceData() (que usa emitChange) no garantiza devolver esa misma
    // referencia. applyStylesToDom pinta desde acá, y emitChange también lee
    // de acá para lo que viaja a autosave/confirmar.
    const current: PlanillaRowStyle = rowStylesRef.current.get(selectedRowId) ?? {};
    rowStylesRef.current.set(selectedRowId, { ...current, ...patch });
    applyStylesToDom();
    emitChange();
  }

  const selectedRowStyle: PlanillaRowStyle = selectedRowId ? rowStylesRef.current.get(selectedRowId) ?? {} : {};

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
    // getCell()/getDataAtCell() esperan índice VISUAL — con el filtro nativo
    // de columna (dropdownMenu/filters) activo, una fila filtrada no tiene
    // índice visual (toVisualRow devuelve null), así que se salta acá abajo.
    // rowStylesRef en sí ya no depende de esto para nada — se indexa por
    // _rowId (identidad estable), no por posición física ni visual.
    const term = searchTermRef.current.trim().toLowerCase();
    const rowCount = hot.countRows();
    for (let physicalRow = 0; physicalRow < rowCount; physicalRow++) {
      const visualRow = hot.toVisualRow(physicalRow);
      if (visualRow === null || visualRow === undefined || visualRow < 0) continue; // fila oculta por el filtro nativo de columna
      const rowData = hot.getSourceDataAtRow(physicalRow) as PlanillaGridRow | undefined;
      const style = typeof rowData?._rowId === "string" ? rowStylesRef.current.get(rowData._rowId) : undefined;
      const isMatch =
        term.length > 0 &&
        rowData !== undefined &&
        Object.entries(rowData).some(
          ([key, v]) => !key.startsWith("_") && v !== null && v !== undefined && String(v).toLowerCase().includes(term)
        );
      // Filtro por columna (checkboxes, ver handleOpenFilter/handleApplyFilter):
      // una fila se oculta si CUALQUIER columna con filtro activo tiene un
      // valor que quedó destildado (excluido). rowData viene de
      // getSourceDataAtRow (índice FÍSICO), coherente con cómo se armó
      // filterValuesRef (a partir de getSourceData(), mismo orden físico).
      const failsColumnFilter =
        rowData !== undefined &&
        Array.from(filterValuesRef.current.entries()).some(([colKey, excluded]) =>
          excluded.has(formatFilterValue(rowData[colKey]))
        );
      const classes = [
        style?.bold ? "plr-bold" : "",
        style?.align ? `plr-align-${style.align}` : "",
        style?.color ? `plr-fg-${style.color}` : "",
        style?.bg ? `plr-bg-${style.bg}` : "",
        isMatch ? "plr-search-match" : "",
      ].filter(Boolean);
      // Buscador propio (texto libre en cualquier columna): oculta por CSS
      // sobre el <tr> ya renderizado, en paralelo al filtro nativo de
      // columna (dropdownMenu/filters, en el <HotTable> de abajo) — ese sí
      // usa el mecanismo real de Handsontable, con su propio dropdown por
      // columna con checkboxes de valores. Ahora que rowStylesRef se indexa
      // por _rowId y no por posición, ambos pueden convivir sin pisarse: da
      // igual qué fila oculte cada uno, el formato la sigue de todos modos.
      const firstTd = hot.getCell(visualRow, 0);
      const tr = firstTd?.parentElement as HTMLTableRowElement | null | undefined;
      const hiddenBySearch = term.length > 0 && !isMatch;
      if (tr) tr.style.display = hiddenBySearch || failsColumnFilter ? "none" : "";
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
      {!readOnly ? (
        <div
          className="flex items-center gap-1 h-8 px-2 border border-[var(--border)] border-b-0 bg-[var(--panel-2)] shrink-0 flex-wrap relative"
          // data-fv: sin uso real, solo referencia filterVersion para forzar
          // el re-render de este bloque (activeFilterCount/hasFilter leen
          // directo de filterValuesRef, un ref no reactivo por diseño).
          data-fv={filterVersion}
        >
          <span className="text-[10px] text-[var(--muted)] mr-1">Filtrar por:</span>
          {/* Espaciador — mismo ancho que la columna de números de fila de
              Handsontable (ver syncFilterBarWidths), para que el primer
              botón arranque alineado con la primera columna real. */}
          <span ref={filterSpacerRef} className="shrink-0" aria-hidden />
          {columns.map((col) => {
            const hasFilter = filterValuesRef.current.has(col.key);
            return (
              <div key={col.key} className="relative shrink-0">
                <button
                  ref={(el) => {
                    if (el) filterButtonRefs.current.set(col.key, el);
                    else filterButtonRefs.current.delete(col.key);
                  }}
                  type="button"
                  onClick={() => handleOpenFilter(col.key)}
                  title={`Filtrar ${col.label}`}
                  className={`flex items-center gap-1 px-2 h-6 rounded text-[11px] overflow-hidden whitespace-nowrap justify-center ${
                    hasFilter
                      ? "bg-[var(--primary)] text-[#1a0e00]"
                      : "text-[var(--foreground)] hover:bg-[var(--hover)]"
                  }`}
                >
                  <Filter size={11} className="shrink-0" /> <span className="truncate">{col.label}</span>
                </button>
                {openFilterCol === col.key && filterDraft ? (
                  <div className="absolute z-20 top-7 left-0 w-56 max-h-72 flex flex-col rounded-md border border-[var(--border)] bg-[var(--panel)] shadow-lg">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border)]">
                      <span className="text-[11px] font-medium">{col.label}</span>
                      <button type="button" onClick={() => setOpenFilterCol(null)} className="text-[var(--muted)] hover:text-[var(--foreground)]">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="px-2 py-1 border-b border-[var(--border)]">
                      <button
                        type="button"
                        className="text-[11px] text-[var(--primary)] hover:underline"
                        onClick={() =>
                          setFilterDraft((prev) =>
                            prev && prev.size === filterOptions.length ? new Set() : new Set(filterOptions)
                          )
                        }
                      >
                        {filterDraft.size === filterOptions.length ? "Deseleccionar todo" : "Seleccionar todo"}
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto py-1">
                      {filterOptions.map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-[var(--hover)] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={filterDraft.has(opt)}
                            onChange={() => toggleFilterDraftValue(opt)}
                          />
                          <span className="truncate">{opt}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-t border-[var(--border)]">
                      <button
                        type="button"
                        onClick={() => handleClearOneFilter(col.key)}
                        className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        Quitar filtro
                      </button>
                      <button
                        type="button"
                        onClick={handleApplyFilter}
                        className="px-2 h-6 rounded text-[11px] bg-[var(--primary)] text-[#1a0e00]"
                      >
                        Aceptar
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {activeFilterCount > 0 ? (
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="ml-1 flex items-center gap-1 px-2 h-6 rounded text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]"
            >
              <X size={11} /> Quitar filtros ({activeFilterCount})
            </button>
          ) : null}
        </div>
      ) : null}
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
          // Handsontable rellena hasta 5 filas vacías al montar por defecto
          // (startRows), sin relación con nuestra propia lógica de fila
          // vacía final (ensureTrailingSpareRow) — en 0 acá porque esa fila
          // ya viene sembrada en los datos iniciales (seedInitialRows) y no
          // hace falta que Handsontable cree ninguna por su cuenta al montar.
          startRows={0}
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
          afterInit={handleAfterInit}
          afterColumnResize={handleAfterColumnResize}
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
