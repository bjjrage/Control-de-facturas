import ExcelJS from "exceljs";
import type { StoredStyle, WorkingSnapshot } from "./workbook-store";

/**
 * El FORMATO del Excel (formato de número/%, miles, fuentes, rellenos,
 * bordes, alineación, alto de filas, filas ocultas, paneles inmovilizados).
 * SheetJS —el lector de valores— no lo trae en su versión libre; ExcelJS
 * (MIT) sí. Va aparte de las celdas de valor a propósito: el extractor y la
 * huella de estructura no lo miran, así que agregar formato nunca cambia qué
 * se lee ni invalida un mapeo de Luna.
 *
 * Los estilos se guardan ya en la forma que usa Univer (IStyleData) para que
 * la planilla embebida los muestre y los devuelva al guardar sin traducir.
 */

export type SheetFormatting = {
  /** [fila, columna, id de estilo], 1-based. Incluye celdas sin valor (bordes, rellenos). */
  styleCells: [number, number, string][];
  /** fila (1-based) → alto en px, solo las que no tienen el alto por defecto. */
  rowHeights: Record<number, number>;
  hiddenRows: number[];
  freeze: { rows: number; columns: number } | null;
};

export type WorkbookFormatting = {
  styles: Record<string, StoredStyle>;
  sheets: Record<string, SheetFormatting>;
};

// Paleta "Office" por defecto, en el orden en que Excel numera los colores
// de tema (0 = fondo 1, 1 = texto 1, 2 = fondo 2, 3 = texto 2, 4–9 = énfasis).
const DEFAULT_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

// Paleta indexada heredada de Excel 97 (colores "indexed").
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
  "000000", "FFFFFF",
];

const BORDER_STYLES: Record<string, number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7,
  medium: 8, mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13,
};
const H_ALIGN: Record<string, number> = { left: 1, center: 2, centerContinuous: 2, right: 3, justify: 4, distributed: 6, fill: 1 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, center: 2, bottom: 3 };

type ExcelColor = { argb?: string; theme?: number; tint?: number; indexed?: number };

function themePalette(workbook: ExcelJS.Workbook): string[] {
  // ExcelJS guarda el XML del tema tal cual; el esquema de colores viene en
  // el orden dk1, lt1, dk2, lt2, accent1..6 — Excel numera lt1, dk1, lt2, dk2.
  const xml = (workbook as unknown as { _themes?: Record<string, string> })._themes?.theme1;
  if (!xml) return DEFAULT_THEME;
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0];
  if (!scheme) return DEFAULT_THEME;
  const colors = [...scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6])>[\s\S]*?(?:srgbClr val="([0-9A-Fa-f]{6})"|lastClr="([0-9A-Fa-f]{6})")[\s\S]*?<\/a:\1>/g)]
    .reduce<Record<string, string>>((acc, m) => ({ ...acc, [m[1]]: (m[2] ?? m[3]).toUpperCase() }), {});
  const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
  return order.map((key, index) => colors[key] ?? DEFAULT_THEME[index]);
}

function applyTint(hex: string, tint: number | undefined): string {
  if (!tint) return hex;
  const channel = (i: number) => {
    const value = parseInt(hex.slice(i, i + 2), 16);
    const tinted = tint < 0 ? value * (1 + tint) : value + (255 - value) * tint;
    return Math.max(0, Math.min(255, Math.round(tinted))).toString(16).padStart(2, "0");
  };
  return `${channel(0)}${channel(2)}${channel(4)}`.toUpperCase();
}

function toRgb(color: ExcelColor | undefined, theme: string[]): { rgb: string } | null {
  if (!color) return null;
  let hex: string | undefined;
  if (color.argb && /^[0-9A-Fa-f]{8}$/.test(color.argb)) hex = color.argb.slice(2);
  else if (color.argb && /^[0-9A-Fa-f]{6}$/.test(color.argb)) hex = color.argb;
  else if (typeof color.theme === "number") hex = theme[color.theme];
  else if (typeof color.indexed === "number") hex = INDEXED[color.indexed];
  if (!hex) return null;
  return { rgb: `#${applyTint(hex.toUpperCase(), color.tint)}` };
}

function toStyle(style: Partial<ExcelJS.Style>, theme: string[]): StoredStyle | null {
  const out: StoredStyle = {};
  if (style.numFmt && style.numFmt !== "General") out.n = { pattern: style.numFmt };

  const font = style.font;
  if (font) {
    if (font.name) out.ff = font.name;
    if (font.size) out.fs = font.size;
    if (font.bold) out.bl = 1;
    if (font.italic) out.it = 1;
    if (font.underline) out.ul = { s: 1 };
    if (font.strike) out.st = { s: 1 };
    const color = toRgb(font.color as ExcelColor | undefined, theme);
    if (color && color.rgb !== "#000000") out.cl = color;
  }

  const fill = style.fill;
  if (fill && fill.type === "pattern" && fill.pattern && fill.pattern !== "none") {
    const color = toRgb((fill.fgColor ?? fill.bgColor) as ExcelColor | undefined, theme);
    if (color) out.bg = color;
  }

  const border = style.border;
  if (border) {
    const bd: Record<string, { s: number; cl: { rgb: string } }> = {};
    for (const [side, key] of [["top", "t"], ["right", "r"], ["bottom", "b"], ["left", "l"]] as const) {
      const edge = border[side];
      if (!edge?.style) continue;
      bd[key] = { s: BORDER_STYLES[edge.style] ?? 1, cl: toRgb(edge.color as ExcelColor | undefined, theme) ?? { rgb: "#000000" } };
    }
    if (Object.keys(bd).length) out.bd = bd;
  }

  const alignment = style.alignment;
  if (alignment) {
    if (alignment.horizontal && H_ALIGN[alignment.horizontal]) out.ht = H_ALIGN[alignment.horizontal];
    if (alignment.vertical && V_ALIGN[alignment.vertical]) out.vt = V_ALIGN[alignment.vertical];
    if (alignment.wrapText) out.tb = 3;
    if (typeof alignment.textRotation === "number" && alignment.textRotation !== 0) out.tr = { a: alignment.textRotation };
  }

  return Object.keys(out).length ? out : null;
}

const EMPTY: WorkbookFormatting = { styles: {}, sheets: {} };

/** Nunca bloquea una importación: si ExcelJS no puede leer el archivo, la
 * planilla entra igual, sin formato (como hasta ahora). */
export async function extractWorkbookFormatting(bytes: Uint8Array): Promise<WorkbookFormatting> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return EMPTY;
  }
  const theme = themePalette(workbook);
  const styles: Record<string, StoredStyle> = {};
  const idByKey = new Map<string, string>();
  const sheets: Record<string, SheetFormatting> = {};

  workbook.eachSheet((worksheet) => {
    const styleCells: [number, number, string][] = [];
    const rowHeights: Record<number, number> = {};
    const hiddenRows: number[] = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (row.height && row.height !== (worksheet.properties.defaultRowHeight ?? 15)) rowHeights[rowNumber] = Math.round((row.height * 96) / 72);
      if (row.hidden) hiddenRows.push(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const style = toStyle(cell.style ?? {}, theme);
        if (!style) return;
        const key = JSON.stringify(style);
        let id = idByKey.get(key);
        if (!id) {
          id = `x${idByKey.size + 1}`;
          idByKey.set(key, id);
          styles[id] = style;
        }
        styleCells.push([rowNumber, colNumber, id]);
      });
    });
    const view = worksheet.views?.find((v) => v.state === "frozen") as { xSplit?: number; ySplit?: number } | undefined;
    const freeze = view && ((view.xSplit ?? 0) > 0 || (view.ySplit ?? 0) > 0) ? { rows: view.ySplit ?? 0, columns: view.xSplit ?? 0 } : null;
    sheets[worksheet.name] = { styleCells, rowHeights, hiddenRows, freeze };
  });

  return { styles, sheets };
}

/** Suma el formato a una copia de trabajo (por nombre de hoja). */
export function applyWorkbookFormatting(snapshot: WorkingSnapshot, formatting: WorkbookFormatting): WorkingSnapshot {
  return {
    ...snapshot,
    styles: formatting.styles,
    sheets: snapshot.sheets.map((sheet) => {
      const format = formatting.sheets[sheet.name];
      if (!format) return sheet;
      return { ...sheet, styleCells: format.styleCells, rowHeights: format.rowHeights, hiddenRows: format.hiddenRows, freeze: format.freeze };
    }),
  };
}
