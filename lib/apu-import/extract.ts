import { parseParaguayanNumber } from "@/lib/workbook-interpretation/parser";
import type { WorkbookSheetRepresentation } from "@/lib/workbook-interpretation/types";
import type {
  ApuInputType,
  ApuPreviewLine,
  ApuPreviewRecipe,
  ApuRowLabel,
  ApuSheetLayout,
  ApuUnresolvedRow,
} from "./types";

// ---------------------------------------------------------------------------
// Extracción determinística: el modelo dijo qué es cada columna y cada fila;
// acá se leen los valores directo de las celdas. Toda fila con contenido que
// no quede como partida, insumo, sección o total termina en "sin resolver":
// nada se descarta en silencio.
// ---------------------------------------------------------------------------

export function columnIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

type RowCells = Map<number, { raw: string | number | boolean | null; formatted: string | null }>;

export function indexRows(sheet: WorkbookSheetRepresentation): Map<number, RowCells> {
  const rows = new Map<number, RowCells>();
  for (const cell of sheet.cells) {
    let row = rows.get(cell.row);
    if (!row) rows.set(cell.row, (row = new Map()));
    row.set(cell.column, { raw: cell.raw, formatted: cell.formatted });
  }
  return rows;
}

function text(row: RowCells | undefined, column: string | null): string | null {
  if (!row || !column) return null;
  const cell = row.get(columnIndex(column));
  if (!cell) return null;
  const value = cell.formatted ?? (cell.raw == null ? "" : String(cell.raw));
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Número estricto: un texto que no parece número devuelve null (nunca 0). */
function number(row: RowCells | undefined, column: string | null): number | null {
  if (!row || !column) return null;
  const cell = row.get(columnIndex(column));
  if (!cell) return null;
  if (typeof cell.raw === "number") return Number.isFinite(cell.raw) ? cell.raw : null;
  const value = (cell.formatted ?? (cell.raw == null ? "" : String(cell.raw))).trim();
  if (!/^-?[\d.,\s]+%?$/.test(value) || !/\d/.test(value)) return null;
  return parseParaguayanNumber(value.replace("%", ""));
}

function rowText(row: RowCells | undefined): string {
  if (!row) return "";
  return [...row.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cell]) => (cell.formatted ?? (cell.raw == null ? "" : String(cell.raw))).trim())
    .filter(Boolean)
    .join(" | ")
    .slice(0, 160);
}

export interface ExtractResult {
  recipes: ApuPreviewRecipe[];
  unresolved: ApuUnresolvedRow[];
  rowsRead: number;
}

export function extractApuRecipes(
  sheet: WorkbookSheetRepresentation,
  layout: ApuSheetLayout,
  labels: ApuRowLabel[]
): ExtractResult {
  const rows = indexRows(sheet);
  const labelByRow = new Map<number, ApuRowLabel>();
  for (const l of labels) labelByRow.set(l.row, l);
  const cols = layout.columns;
  const unresolved: ApuUnresolvedRow[] = [];
  const recipes: ApuPreviewRecipe[] = [];
  const fail = (row: number, reason: string) =>
    unresolved.push({ sheet: sheet.sheetName, row, reason, text: rowText(rows.get(row)) });

  let current: ApuPreviewRecipe | null = null;
  let currentType: ApuInputType | null = null;
  const byName = new Map<string, ApuPreviewRecipe>();

  const openRecipe = (name: string, headerRow: number | null, code: string | null, unit: string | null, total: number | null) => {
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      if (existing.declaredTotal == null && total != null) existing.declaredTotal = total;
      return existing;
    }
    const recipe: ApuPreviewRecipe = {
      sheet: sheet.sheetName,
      headerRow,
      code,
      name,
      unit,
      lines: [],
      declaredTotal: total,
      computedTotal: null,
      totalMismatch: false,
    };
    byName.set(key, recipe);
    recipes.push(recipe);
    return recipe;
  };

  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  for (const rowNo of sortedRows) {
    const row = rows.get(rowNo);
    const label = labelByRow.get(rowNo);
    if (!label) {
      fail(rowNo, "Luna no clasificó esta fila.");
      continue;
    }
    if (label.kind === "OTHER" || label.kind === "TOTAL") continue;

    if (label.kind === "SECTION") {
      if (label.inputType) currentType = label.inputType;
      continue;
    }

    if (label.kind === "RECIPE_HEADER") {
      const name = text(row, cols.recipeName) ?? text(row, cols.description);
      if (!name) {
        fail(rowNo, "Encabezado de partida sin nombre.");
        continue;
      }
      const total = number(row, cols.recipeTotal) ?? number(row, cols.lineTotal);
      current = openRecipe(name, rowNo, text(row, cols.recipeCode), text(row, cols.unit), total);
      currentType = null;
      continue;
    }

    // INPUT
    const explicitName = text(row, cols.recipeName);
    const recipe = explicitName ? openRecipe(explicitName, null, text(row, cols.recipeCode), null, null) : current;
    if (!recipe) {
      fail(rowNo, "Insumo sin partida a la que pertenezca.");
      continue;
    }
    const tipo = label.inputType ?? currentType;
    if (!tipo) {
      fail(rowNo, "No se pudo determinar si es material, mano de obra, equipo o subcontrato.");
      continue;
    }
    const descripcion = text(row, cols.description);
    if (!descripcion) {
      fail(rowNo, "Insumo sin descripción.");
      continue;
    }
    const cantidad = number(row, cols.quantity);
    if (cantidad == null || !(cantidad > 0)) {
      fail(rowNo, "Cantidad ausente, no numérica o no positiva.");
      continue;
    }
    const precio = number(row, cols.unitPrice);
    if (precio != null && precio < 0) {
      fail(rowNo, "Precio negativo.");
      continue;
    }
    const waste = number(row, cols.wastePct) ?? 0;
    if (waste < 0 || waste > 100) {
      fail(rowNo, "Desperdicio fuera de 0–100 %.");
      continue;
    }
    const line: ApuPreviewLine = {
      row: rowNo,
      tipo,
      descripcion,
      unidad: text(row, cols.unit),
      cantidad,
      precio,
      desperdicioPct: waste,
    };
    if (recipe.lines.some((l) => l.tipo === tipo && l.descripcion.toLowerCase() === descripcion.toLowerCase())) {
      fail(rowNo, `Insumo repetido dentro de la misma partida ("${descripcion}").`);
      continue;
    }
    recipe.lines.push(line);
  }

  for (const recipe of recipes) {
    const priced = recipe.lines.filter((l) => l.precio != null);
    if (priced.length === recipe.lines.length && recipe.lines.length > 0) {
      recipe.computedTotal = priced.reduce((s, l) => s + l.cantidad * (1 + l.desperdicioPct / 100) * (l.precio as number), 0);
      if (recipe.declaredTotal != null && recipe.declaredTotal > 0) {
        recipe.totalMismatch = Math.abs(recipe.computedTotal - recipe.declaredTotal) / recipe.declaredTotal > 0.02;
      }
    }
  }

  return { recipes: recipes.filter((r) => r.lines.length > 0), unresolved, rowsRead: sortedRows.length };
}
