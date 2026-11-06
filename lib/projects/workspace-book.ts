import type { IWorkbookData, IWorksheetData, ICellData } from "@univerjs/presets";

export const WORKSPACE_SHEETS = ["computo", "presupuesto", "apu", "materiales", "cronograma"] as const;
export const WORKSPACE_PARTIDA_ROWS = 250;
export const WORKSPACE_RESOURCE_ROWS = 600;
const LAST = WORKSPACE_PARTIDA_ROWS + 3;
const RES = WORKSPACE_RESOURCE_ROWS + 3;

/** Native workbook: keep formulas, styles, sheets, rows and auxiliary edits
 * together. This is a preparation document, not an operational budget writer. */
export function createEmptyProjectWorkbook(id: string): IWorkbookData {
  const sheets: IWorkbookData["sheets"] = {};
  const styles = {
    title: { fs: 16, bl: 1, cl: { rgb: "#19375D" } },
    hint: { fs: 10, cl: { rgb: "#52677F" } },
    header: { bg: { rgb: "#19375D" }, cl: { rgb: "#FFFFFF" }, bl: 1, fs: 11 },
    formula: { bg: { rgb: "#EAF4FF" }, cl: { rgb: "#173F6D" }, n: { pattern: "#,##0.####" } },
    number: { n: { pattern: "#,##0.####" } },
    money: { bg: { rgb: "#EAF4FF" }, n: { pattern: "#,##0.00" } },
    price: { n: { pattern: "#,##0.00" } },
    date: { n: { pattern: "dd/mm/yyyy" } },
    dateFormula: { bg: { rgb: "#EAF4FF" }, n: { pattern: "dd/mm/yyyy" } },
  };
  const add = (key: string, name: string, hint: string, headers: string[], widths: number[]) => {
    const data: IWorksheetData = {
      id: key, name, tabColor: "", hidden: 0, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
      mergeData: [], rowHeader: { width: 44 }, columnHeader: { height: 24 }, showGridlines: 1, rightToLeft: 0,
      rowCount: 1000, columnCount: 26, defaultRowHeight: 24,
      defaultColumnWidth: 110, cellData: {
        0: { 0: { v: name, s: "title" } },
        1: { 0: { s: "hint", custom: { workspaceHelp: hint } } },
        2: Object.fromEntries(headers.map((v, i) => [i, { v, s: "header" }])),
      },
      columnData: Object.fromEntries(widths.map((w, i) => [i, { w }])),
      rowData: { 0: { h: 32 }, 1: { h: 26 }, 2: { h: 34 } },
      freeze: { xSplit: 0, ySplit: 3, startRow: 3, startColumn: 0 },
    };
    sheets[key] = data;
  };
  const put = (sheet: string, row: number, column: number, cell: ICellData) => {
    const data = sheets[sheet].cellData!;
    data[row - 1] ??= {};
    data[row - 1][column] = cell;
  };
  const formula = (sheet: string, row: number, column: number, f: string, style = "formula") => put(sheet, row, column, { f: `=${f}`, s: style });
  add("computo", "Cómputo", "Escribí desde la fila 4. Unidad: m2, m3, m, un o gl. Cantidad directa tiene prioridad sobre dimensiones.",
    ["Código", "Rubro", "Partida / trabajo", "Unidad", "Veces", "Largo · m", "Ancho · m", "Alto · m", "Cantidad directa", "Cantidad ↗"], [85,160,330,75,80,100,100,100,125,130]);
  add("presupuesto", "Presupuesto", "A: código de la partida del Cómputo. G: precio de venta. El vínculo por código conserva el precio al ordenar filas.",
    ["Código partida", "Rubro ↗", "Partida ↗", "Unidad ↗", "Cantidad ↗", "Costo APU/un. ↗", "Precio venta/un.", "Venta total ↗", "Costo total ↗"], [120,150,300,75,110,155,155,160,160]);
  add("apu", "APU", "Una fila por recurso. Tipo: MAT, MO o EQ. Código de partida = Cómputo. MO usa horas/persona por unidad.",
    ["Código partida", "Tipo", "Código recurso", "Recurso", "Unidad", "Consumo/un.", "Desperdicio %", "Costo recurso/un.", "Costo APU/un. ↗", "Cantidad obra ↗", "Necesidad ↗", "Horas MO ↗"], [120,80,140,300,80,120,120,160,160,130,140,140]);
  add("materiales", "Materiales", "Consolidado automático por código de recurso MAT. Necesidad teórica; revisar stock y presentaciones antes de comprar.",
    ["Código material ↗", "Material ↗", "Unidad ↗", "Necesidad teórica ↗"], [180,330,100,200]);
  add("cronograma", "Cronograma", "A: código de partida. Calendario: L-V, L-S o Todos. J permite un plazo manual; si está vacío se usa el APU, personas y jornada.",
    ["Código partida", "Partida ↗", "Unidad ↗", "Cantidad ↗", "Horas MO ↗", "Personas", "h/persona/día", "Inicio", "Calendario", "Días manuales", "Días APU ↗", "Días usados ↗", "Fin ↗"], [120,300,75,110,130,100,130,125,120,130,130,130,130]);
  for (let r = 4; r <= LAST; r++) {
    formula("computo", r, 9, `IF(A${r}="","",IF(I${r}<>"",I${r},IF(OR(D${r}="m2",D${r}="m²"),IF(COUNT(E${r},F${r},H${r})=3,E${r}*F${r}*H${r},""),IF(OR(D${r}="m3",D${r}="m³"),IF(COUNT(E${r}:H${r})=4,PRODUCT(E${r}:H${r}),""),IF(D${r}="m",IF(COUNT(E${r}:F${r})=2,E${r}*F${r},""),IF(OR(D${r}="un",D${r}="gl"),IF(E${r}<>"",E${r},""),""))))))`);
    for (let c = 1; c < 4; c++) {
      formula("presupuesto", r, c, `IF(A${r}="","",IFERROR(VLOOKUP(A${r},'Cómputo'!$A$4:$J$${LAST},${c + 1},FALSE),""))`);
    }
    formula("presupuesto", r, 4, `IF(OR(A${r}="",COUNTIF('Cómputo'!$A$4:$A$${LAST},A${r})=0),"",IF(COUNTIFS('Cómputo'!$A$4:$A$${LAST},A${r},'Cómputo'!$J$4:$J$${LAST},"")>0,"",SUMIF('Cómputo'!$A$4:$A$${LAST},A${r},'Cómputo'!$J$4:$J$${LAST})))`);
    formula("presupuesto", r, 5, `IF(A${r}="","",IF(COUNTIF(APU!$A$4:$A$${RES},A${r})=0,"",IF(COUNTIFS(APU!$A$4:$A$${RES},A${r},APU!$I$4:$I$${RES},"")>0,"",SUMIF(APU!$A$4:$A$${RES},A${r},APU!$I$4:$I$${RES}))))`, "money");
    put("presupuesto", r, 6, { s: "price" });
    formula("presupuesto", r, 7, `IF(OR(A${r}="",E${r}="",G${r}=""),"",ROUND(E${r}*G${r},2))`, "money");
    formula("presupuesto", r, 8, `IF(OR(A${r}="",E${r}="",F${r}=""),"",ROUND(E${r}*F${r},2))`, "money");
    for (let c = 1; c < 3; c++) {
      formula("cronograma", r, c, `IF(A${r}="","",IFERROR(VLOOKUP(A${r},'Cómputo'!$A$4:$J$${LAST},${c + 2},FALSE),""))`);
    }
    formula("cronograma", r, 3, `IF(OR(A${r}="",COUNTIF('Cómputo'!$A$4:$A$${LAST},A${r})=0),"",IF(COUNTIFS('Cómputo'!$A$4:$A$${LAST},A${r},'Cómputo'!$J$4:$J$${LAST},"")>0,"",SUMIF('Cómputo'!$A$4:$A$${LAST},A${r},'Cómputo'!$J$4:$J$${LAST})))`);
    formula("cronograma", r, 4, `IF(OR(A${r}="",COUNTIFS(APU!$A$4:$A$${RES},A${r},APU!$B$4:$B$${RES},"MO")=0),"",IF(COUNTIFS(APU!$A$4:$A$${RES},A${r},APU!$B$4:$B$${RES},"MO",APU!$L$4:$L$${RES},"")>0,"",SUMIF(APU!$A$4:$A$${RES},A${r},APU!$L$4:$L$${RES})))`);
    put("cronograma", r, 7, { s: "date" });
    formula("cronograma", r, 10, `IF(OR(A${r}="",E${r}="",F${r}<=0,G${r}<=0),"",MAX(1,ROUNDUP(E${r}/(F${r}*G${r}),0)))`);
    formula("cronograma", r, 11, `IF(A${r}="","",IF(J${r}<>"",J${r},IF(K${r}="","",K${r})))`);
    // Univer 1.0.2 WORKDAY.INTL does not unwrap a reference for its days
    // argument; +0 supplies the numeric value. Calendar regression tests run
    // against the actual engine, including weekends and inclusive starts.
    formula("cronograma", r, 12, `IF(AND(ISNUMBER(H${r}),ISNUMBER(L${r}),L${r}>0,OR(UPPER(I${r})="L-V",UPPER(I${r})="L-S",UPPER(I${r})="TODOS")),IFERROR(WORKDAY.INTL(H${r}-1,L${r}+0,IF(UPPER(I${r})="L-S","0000001",IF(UPPER(I${r})="TODOS","0000000","0000011"))),""),"")`, "dateFormula");
  }
  for (let r = 4; r <= RES; r++) {
    formula("apu", r, 8, `IF(OR(A${r}="",C${r}="",F${r}="",H${r}=""),"",F${r}*(1+IF(B${r}="MAT",IF(G${r}="",0,G${r})/100,0))*H${r})`, "money");
    formula("apu", r, 9, `IF(OR(A${r}="",COUNTIF('Cómputo'!$A$4:$A$${LAST},A${r})=0),"",IF(COUNTIFS('Cómputo'!$A$4:$A$${LAST},A${r},'Cómputo'!$J$4:$J$${LAST},"")>0,"",SUMIF('Cómputo'!$A$4:$A$${LAST},A${r},'Cómputo'!$J$4:$J$${LAST})))`);
    formula("apu", r, 10, `IF(OR(A${r}="",F${r}="",J${r}=""),"",F${r}*(1+IF(B${r}="MAT",IF(G${r}="",0,G${r})/100,0))*J${r})`);
    formula("apu", r, 11, `IF(AND(A${r}<>"",B${r}="MO",ISNUMBER(K${r})),K${r},"")`);
  }
  formula("materiales", 4, 0, `IFERROR(SORT(UNIQUE(FILTER(APU!$C$4:$C$${RES},(APU!$B$4:$B$${RES}="MAT")*(APU!$C$4:$C$${RES}<>"")))),"")`);
  for (let r = 4; r <= LAST; r++) {
    formula("materiales", r, 1, `IF(A${r}="","",IFERROR(VLOOKUP(A${r},APU!$C$4:$E$${RES},2,FALSE),""))`);
    formula("materiales", r, 2, `IF(A${r}="","",IFERROR(VLOOKUP(A${r},APU!$C$4:$E$${RES},3,FALSE),""))`);
    formula("materiales", r, 3, `IF(A${r}="","",IF(COUNTIFS(APU!$C$4:$C$${RES},A${r},APU!$B$4:$B$${RES},"MAT",APU!$K$4:$K$${RES},"")>0,"",SUMIFS(APU!$K$4:$K$${RES},APU!$C$4:$C$${RES},A${r},APU!$B$4:$B$${RES},"MAT")))`);
  }
  return { id, name: "Obra sin nombre", appVersion: "1.0.2", locale: "esES", sheetOrder: [...WORKSPACE_SHEETS], sheets, styles } as IWorkbookData;
}

/** Validate document shape/size before persisting. Native extra sheets,
 * formats and formulas stay intact; required sheet IDs survive renaming. */
export function validateProjectWorkbook(value: unknown, id: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "El libro no es válido.";
  const book = value as IWorkbookData;
  if (book.id !== id || !Array.isArray(book.sheetOrder) || book.sheetOrder.length < 5 || book.sheetOrder.length > 30 || new Set(book.sheetOrder).size !== book.sheetOrder.length || !book.sheets || typeof book.sheets !== "object") return "La estructura del libro no es válida.";
  if (WORKSPACE_SHEETS.some(key => !book.sheetOrder.includes(key) || !book.sheets[key])) return "Falta una hoja vinculada. Usá Deshacer para recuperarla antes de guardar.";
  for (const key of book.sheetOrder) {
    const sheet = book.sheets[key];
    if (!sheet || sheet.id !== key || typeof sheet.name !== "string" || !sheet.name.trim() || sheet.name.length > 100) return "Una hoja del libro no es válida.";
    if (typeof sheet.rowCount !== "number" || !Number.isInteger(sheet.rowCount) || sheet.rowCount <= 0 || sheet.rowCount > 100000 || typeof sheet.columnCount !== "number" || !Number.isInteger(sheet.columnCount) || sheet.columnCount <= 0 || sheet.columnCount > 16384) return "El tamaño de una hoja no es válido.";
  }
  const bytes = new TextEncoder().encode(JSON.stringify(book)).length;
  if (bytes > 4_500_000) return "El libro supera el tamaño de guardado de este workspace (4,5 MB).";
  return null;
}
