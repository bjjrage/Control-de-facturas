import type * as XLSXType from "xlsx";

/**
 * Lee un XLSX/XLS/CSV. Un CSV UTF-8 sin BOM (lo normal al exportar desde muchas herramientas) se
 * decodificaba como Windows-1252 y "Código"/"Descripción" llegaban rotos, así que los encabezados no se
 * reconocían. Para `.csv` se intenta UTF-8 estricto (con o sin BOM); si los bytes no son UTF-8 válido
 * se mantiene la lectura previa.
 */
export function readSpreadsheet(
  XLSX: typeof XLSXType,
  buffer: ArrayBuffer,
  fileName: string,
  options: XLSXType.ParsingOptions = {},
): XLSXType.WorkBook {
  if (/\.csv$/i.test(fileName)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      // Preserve textual amounts/codes until the user chooses the locale.
      return XLSX.read(text, { ...options, type: "string", raw: true });
    } catch {
      /* no es UTF-8 válido: lectura por defecto */
    }
  }
  return XLSX.read(buffer, { ...options, type: "array" });
}
