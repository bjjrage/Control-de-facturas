import type { ImportPlan, WorkbookBudgetItem, WorkbookCell, WorkbookRepresentation } from "./types";
import { selectBudgetBlocks } from "./import-plan";

export type RecipeSource = { sheet: string; row: number; cell: string; formula: string | null };
export type LinkedRecipeLine = {
  kind: "MATERIAL" | "LABOR" | "EQUIPMENT" | "TRANSPORT";
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  price: number;
  source: RecipeSource;
};
export type LinkedRecipe = {
  budgetCode: string; description: string; unit: string; sheet: string;
  startRow: number; endRow: number; production: number;
  adoptedPrice: number; directCost: number | null;
  adjustments: { label: string; amount: number; cell: string }[];
  lines: LinkedRecipeLine[];
  excluded: { row: number; reason: string }[];
};
export type LinkedRecipes = { recipes: LinkedRecipe[]; issues: string[]; formulaCount: number; relativeSchedule: { budgetCode: string; startDay: number; endDay: number; source: { sheet: string; row: number }; monthlyValues: { month: number; value: number; cell: string }[] }[] };

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const number = (c?: WorkbookCell): number | null => typeof c?.raw === "number" && Number.isFinite(c.raw) ? c.raw : null;
const text = (c?: WorkbookCell) => String(c?.raw ?? "").trim();
function reference(formula: string | null | undefined) {
  const m = /^=?\s*(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?(\d+)\s*$/.exec(formula ?? "");
  return m ? { sheet: (m[1] ?? m[2]).replaceAll("''", "'"), cell: `${m[3]}${m[4]}`, row: Number(m[4]) } : null;
}

/** A verified adapter for repeated composition forms linked by budget price
 * formulas. Never changes formulas or evaluates them with a different engine.
 * Unrecognized layouts remain explicit issues instead of guessed recipes. */
export function extractLinkedRecipes(workbook: WorkbookRepresentation, plan: ImportPlan, items: WorkbookBudgetItem[]): LinkedRecipes {
  const result: LinkedRecipes = { recipes: [], issues: [], relativeSchedule: [], formulaCount: workbook.sheets.reduce((n,s) => n + s.cells.filter(c => c.formula).length, 0) };
  const sheets = new Map(workbook.sheets.map(sheet => [sheet.sheetName, { sheet, cells: new Map(sheet.cells.map(c => [c.address, c])) }]));
  const blocks = selectBudgetBlocks(plan);
  const anchors: { item: WorkbookBudgetItem; sheet: string; row: number; cell: string }[] = [];
  for (const item of items) {
    const block = blocks.find(b => b.sheet === item.source.sheet && (item.source.row ?? 0) >= b.dataRowStart && (item.source.row ?? 0) <= b.dataRowEnd);
    const priceColumn = block?.columnMappings.find(m => m.role === "unitPrice")?.column;
    const price = sheets.get(item.source.sheet)?.cells.get(`${priceColumn}${item.source.row}`);
    const ref = reference(price?.formula);
    if (!ref) continue;
    const source = sheets.get(ref.sheet);
    const label = source?.cells.get(`A${ref.row}`);
    if (!source || !/costo unitario adoptado/.test(norm(label?.raw))) continue;
    if (number(source.cells.get(ref.cell)) !== item.unitPrice) {
      result.issues.push(`Partida ${item.code}: el precio no coincide con ${ref.sheet}!${ref.cell}.`);
      continue;
    }
    anchors.push({ item, ...ref });
  }
  // Resource codes are read from auxiliary tables only when their quantity
  // formula points back to the very same recipe row (no name-based guesses).
  const resourceCodes = new Map<string, string>();
  for (const { sheet, cells } of sheets.values()) {
    const header = sheet.cells.find(c => norm(c.raw) === "tipo");
    if (!header) continue;
    const heads = sheet.cells.filter(c => c.row === header.row);
    const codeCol = heads.find(c => norm(c.raw) === "codigo")?.column;
    const quantityCol = heads.find(c => /consumo.*por unidad/.test(norm(c.raw)))?.column;
    if (!codeCol || !quantityCol) continue;
    const byRow = new Map<number, WorkbookCell[]>();
    for (const c of sheet.cells) { const row = byRow.get(c.row) ?? []; row.push(c); byRow.set(c.row, row); }
    for (const [row, rowCells] of byRow) {
      if (row <= header.row) continue;
      const quantity = rowCells.find(c => c.column === quantityCol);
      const code = text(rowCells.find(c => c.column === codeCol));
      if (!quantity?.formula || !code) continue;
      for (const match of [...quantity.formula.matchAll(/(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_ ]*))!\$?[A-Z]+\$?(\d+)/gu)].slice(0, 1)) {
        const key = `${(match[1] ?? match[2]).replaceAll("''", "'").trim()}!${match[3]}`;
        const old = resourceCodes.get(key);
        if (!old || old === code) resourceCodes.set(key, code);
        else result.issues.push(`Códigos de recurso ambiguos en ${key}.`);
      }
    }
    void cells;
  }
  const endBySheet = new Map<string, number>();
  for (const anchor of anchors.sort((a,b) => a.sheet.localeCompare(b.sheet) || a.row - b.row)) {
    const source = sheets.get(anchor.sheet)!;
    const cell = (column: string, row: number) => source.cells.get(`${column}${row}`);
    const previous = endBySheet.get(anchor.sheet) ?? 0;
    endBySheet.set(anchor.sheet, anchor.row);
    const titles = source.sheet.cells.filter(c => c.column === 1 && c.row > previous && c.row < anchor.row && /formulario.*composicion.*precios unitarios/.test(norm(c.raw)));
    const start = titles.at(-1)?.row;
    if (!start) { result.issues.push(`Partida ${anchor.item.code}: falta el inicio del formulario APU.`); continue; }
    const productionCell = source.sheet.cells.find(c => c.column === 1 && c.row >= start && c.row < anchor.row && /produccion.*equipo/.test(norm(c.raw)));
    const production = productionCell ? number(cell("B", productionCell.row)) : null;
    const rubro = source.sheet.cells.find(c => c.column === 1 && c.row >= start && c.row < anchor.row && /^rubro\s*:/.test(norm(c.raw)));
    const identity = source.sheet.cells.find(c => c.row >= start && c.row < anchor.row && /item\s*n[°ºo.:\s]*\d+/i.test(norm(c.raw)));
    const code = /item\s*n[°ºo.:\s]*(\d+)/i.exec(norm(identity?.raw))?.[1];
    const unitCell = source.sheet.cells.find(c => c.row >= start && c.row < anchor.row && /^unidad\s*:/.test(norm(c.raw)));
    const unit = text(unitCell).replace(/^unidad\s*:\s*/i, "").trim();
    if (!production || production <= 0 || code !== anchor.item.code || !rubro || !unit || norm(text(rubro).replace(/^rubro\s*:\s*/i,"")) !== norm(anchor.item.description)) {
      result.issues.push(`Partida ${anchor.item.code}: identidad, unidad o rendimiento del APU sin verificar.`); continue;
    }
    const recipe: LinkedRecipe = { budgetCode: anchor.item.code!, description: anchor.item.description, unit, sheet: anchor.sheet, startRow: start, endRow: anchor.row, production, adoptedPrice: anchor.item.unitPrice!, directCost: null, adjustments: [], lines: [], excluded: [] };
    let kind: LinkedRecipeLine["kind"] | null = null;
    for (let row = start; row < anchor.row; row++) {
      const label = text(cell("A", row));
      const normalized = norm(label);
      if (/^a[.\s].*equipo/.test(normalized)) { kind = "EQUIPMENT"; continue; }
      if (/^b[.\s].*mano.*obra/.test(normalized)) { kind = "LABOR"; continue; }
      if (/^e[.\s].*material/.test(normalized)) { kind = "MATERIAL"; continue; }
      if (/^f[.\s].*transporte/.test(normalized)) { kind = "TRANSPORT"; continue; }
      if (/^(?:[a-f][.)]\s*total|[cd][.\s].*(?:produccion|costo))/.test(normalized)) { kind = null; continue; }
      if (/^costo directo total/.test(normalized)) { recipe.directCost = number(cell("E",row)); kind = null; continue; }
      if (/^(?:gastos generales|beneficio|impuesto|costo unitario)/.test(normalized)) {
        const amount = number(cell("E",row)); if (amount !== null) recipe.adjustments.push({ label, amount, cell: `E${row}` }); kind = null; continue;
      }
      if (!kind || !label) continue;
      const rawQuantity = number(cell("C",row));
      const price = number(cell("D",row));
      const amount = number(cell("E",row));
      if (amount === 0 && (rawQuantity === null || rawQuantity === 0 || kind === "TRANSPORT" || (kind === "LABOR" && number(cell("B",row)) === 0))) { recipe.excluded.push({ row, reason: "La fórmula del archivo produce consumo o importe cero." }); continue; }
      if (kind === "TRANSPORT") {
        if (amount !== null && amount > 0) recipe.lines.push({ kind, code: null, description: label, unit: "servicio por unidad", quantity: 1, price: amount, source: { sheet: anchor.sheet, row, cell: `E${row}`, formula: cell("E",row)?.formula ?? null } });
        else if (rawQuantity !== null && rawQuantity > 0) result.issues.push(`${anchor.sheet}!E${row}: importe de transporte sin verificar.`);
        continue;
      }
      if (rawQuantity === null || price === null || rawQuantity <= 0 || price < 0) { result.issues.push(`${anchor.sheet}!C${row}: consumo o precio sin verificar.`); continue; }
      const workers = kind === "LABOR" ? number(cell("B",row)) : 1;
      if (workers === null || workers <= 0) { result.issues.push(`${anchor.sheet}!B${row}: cuadrilla sin verificar.`); continue; }
      const quantity = kind === "MATERIAL" ? rawQuantity : workers * rawQuantity / production;
      const resourceUnit = kind === "MATERIAL" ? text(cell("B",row)) : "h";
      if (!resourceUnit) { result.issues.push(`${anchor.sheet}!B${row}: unidad del material sin verificar.`); continue; }
      recipe.lines.push({ kind, code: resourceCodes.get(`${anchor.sheet}!${row}`) ?? null, description: label, unit: resourceUnit, quantity, price, source: { sheet: anchor.sheet, row, cell: `C${row}`, formula: cell("C",row)?.formula ?? null } });
    }
    const direct = recipe.lines.reduce((n,line) => n + line.quantity * line.price, 0);
    if (recipe.directCost === null || Math.abs(direct - recipe.directCost) > Math.max(1, recipe.lines.length)) result.issues.push(`Partida ${recipe.budgetCode}: consumos calculados ${direct} no reproducen el costo directo ${recipe.directCost}.`);
    result.recipes.push(recipe);
  }
  if (anchors.length && result.recipes.length !== items.length) result.issues.push(`Se verificaron ${result.recipes.length} recetas para ${items.length} partidas. Las faltantes requieren revisión.`);
  const budgetCodes = new Set(items.map(item => item.code));
  for (const block of plan.blocks.filter(b => b.target === "SCHEDULE" && b.mainProject !== false)) {
    const sheet = sheets.get(block.sheet)?.sheet;
    if (!sheet) continue;
    const headers = sheet.cells.filter(c => c.row >= block.headerRowStart && c.row <= block.headerRowEnd);
    const start = headers.find(c => /^dia inicio$/.test(norm(c.raw)));
    const end = headers.find(c => /^dia fin$/.test(norm(c.raw)));
    const codeColumn = block.columnMappings.find(m => m.role === "code")?.column;
    if (!start || !end || !codeColumn) continue;
    const rows = new Map<number, WorkbookCell[]>();
    for (const c of sheet.cells) { const row = rows.get(c.row) ?? []; row.push(c); rows.set(c.row, row); }
    const months = headers.filter(c => /^mes\s*\d+$/.test(norm(c.raw)));
    for (const [rowNo, cells] of rows) {
      if (rowNo < block.dataRowStart || rowNo > block.dataRowEnd) continue;
      const budgetCode = text(cells.find(c => c.address === `${codeColumn}${rowNo}`));
      if (!budgetCodes.has(budgetCode)) continue;
      const startDay = number(cells.find(c => c.column === start.column));
      const endDay = number(cells.find(c => c.column === end.column));
      if (startDay === null || endDay === null || startDay < 1 || endDay < startDay) { result.issues.push(`${sheet.sheetName}!${rowNo}: plazo relativo sin verificar.`); continue; }
      if (result.relativeSchedule.some(s => s.budgetCode === budgetCode)) { result.issues.push(`Cronograma ambiguo para partida ${budgetCode}.`); continue; }
      result.relativeSchedule.push({ budgetCode, startDay, endDay, source: { sheet: sheet.sheetName, row: rowNo }, monthlyValues: months.flatMap(m => { const c=cells.find(c => c.column === m.column); const value=number(c); return value === null ? [] : [{month:Number(norm(m.raw).replace(/\D/g,"")),value,cell:c!.address}]; }) });
    }
  }
  result.issues = [...new Set(result.issues)];
  return result;
}
