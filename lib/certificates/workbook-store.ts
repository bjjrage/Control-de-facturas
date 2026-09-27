import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { contiguousBlocks, parseWorkbook, WorkbookInputError } from "@/lib/workbook-interpretation/parser";
import type { WorkbookCell, WorkbookDefinedName, WorkbookRepresentation, WorkbookSheetRepresentation } from "@/lib/workbook-interpretation/types";

/**
 * Fase 1 de "Certificados Excel-first" (ver memoria de proyecto
 * excel-first-certificados). El Excel de un certificado entra completo y
 * queda guardado en dos niveles, a propósito distintos:
 *
 * - Documento fuente: el .xlsx tal cual lo subió el usuario, en Storage
 *   privado, INMUTABLE. Nunca se transforma; siempre se puede descargar
 *   igual a como entró.
 * - Documento de trabajo: una copia estructurada (jsonb) de lo que YA lee
 *   parseWorkbook — valores, fórmulas, celdas combinadas, hojas ocultas,
 *   anchos de columna, nombres definidos. Esta es la que edita la planilla
 *   embebida (Fase 3) y la que lee el extractor determinístico (Fase 5/8).
 *
 * No se exige reconstruir el .xlsx byte a byte desde el jsonb — el original
 * ya cubre eso. Se exige equivalencia OPERACIONAL: lo mismo que ya prueba
 * el test de ida y vuelta de este archivo.
 */

export const CERTIFICATE_WORKBOOKS_BUCKET = "certificate-workbooks";

/** [fila, columna, valor, texto visible (null = igual al valor), fórmula, tipo] */
export type StoredCell = [number, number, string | number | boolean | null, string | null, string | null, string | null];

export type StoredSheet = {
  name: string;
  index: number;
  hidden: boolean;
  usedRange: string;
  rowCount: number;
  columnCount: number;
  merges: string[];
  columnWidths: (number | null)[];
  cells: StoredCell[];
};

export type WorkingSnapshot = {
  fileName: string;
  sheets: StoredSheet[];
  definedNames: WorkbookDefinedName[];
};

export type CertificateWorkbookRow = {
  id: string;
  certificateId: string;
  projectId: string;
  originalFileName: string;
  originalFileSize: number;
  originalStoragePath: string;
  originalFileHash: string;
  workingSnapshot: WorkingSnapshot;
  workingRevision: number;
  structureHash: string;
  mapping: unknown;
  mappingStructureHash: string | null;
  analyzedAt: string | null;
  analysisError: string | null;
  createdAt: string;
};

export function toStoredSheets(workbook: WorkbookRepresentation): StoredSheet[] {
  return workbook.sheets.map((sheet) => ({
    name: sheet.sheetName,
    index: sheet.sheetIndex,
    hidden: Boolean(sheet.hidden),
    usedRange: sheet.usedRange,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    merges: sheet.mergedCells,
    columnWidths: sheet.columnWidths ?? [],
    cells: sheet.cells.map((cell) => [
      cell.row,
      cell.column,
      cell.raw,
      cell.raw !== null && cell.formatted === String(cell.raw) ? null : cell.formatted,
      cell.formula,
      cell.type,
    ]),
  }));
}

function fromStoredCell([row, column, raw, formatted, formula, type]: StoredCell): WorkbookCell {
  return {
    address: XLSX.utils.encode_cell({ r: row - 1, c: column - 1 }),
    row,
    column,
    raw,
    formatted: formatted ?? (raw === null ? null : String(raw)),
    formula,
    type,
  };
}

/** Reconstruye la misma representación que produce parseWorkbook — usada
 * para volver a correr el extractor/Luna sobre lo guardado sin re-leer el
 * .xlsx. NO reconstruye el binario original (ver comentario del módulo). */
export function workbookFromSnapshot(snapshot: WorkingSnapshot): WorkbookRepresentation {
  const sheets: WorkbookSheetRepresentation[] = snapshot.sheets.map((sheet) => {
    const cells = sheet.cells.map(fromStoredCell);
    return {
      sheetName: sheet.name,
      sheetIndex: sheet.index,
      usedRange: sheet.usedRange,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      mergedCells: sheet.merges,
      allCellCount: cells.length,
      serializedCellCount: cells.length,
      cells,
      blocks: cells.length ? contiguousBlocks(cells) : [],
      hidden: sheet.hidden,
      columnWidths: sheet.columnWidths,
    };
  });
  const totalCells = sheets.reduce((sum, sheet) => sum + sheet.cells.length, 0);
  return {
    fileName: snapshot.fileName,
    workbookType: /\.csv$/i.test(snapshot.fileName) ? "CSV" : "EXCEL",
    sheets,
    definedNames: snapshot.definedNames,
    totalCells,
    serializedCellCount: totalCells,
    warnings: [],
  };
}

/**
 * Huella de ESTRUCTURA, no de contenido: hojas (nombre + orden + oculta) y,
 * por hoja, la fila de encabezado (primera fila con ≥2 celdas de texto) y
 * sus columnas. Editar un valor o agregar una partida no la cambia; agregar
 * una hoja, mover una columna o cambiar un encabezado sí. La usa el mapeo
 * de Luna (Fase 5/6): un mapeo con un structure_hash viejo ya no es
 * confiable y hay que re-analizar; uno con el mismo hash se puede reusar
 * tal cual, aunque los valores hayan cambiado.
 */
export function computeStructureHash(snapshot: WorkingSnapshot): string {
  const signature = snapshot.sheets.map((sheet) => {
    const byRow = new Map<number, StoredCell[]>();
    for (const cell of sheet.cells) byRow.set(cell[0], [...(byRow.get(cell[0]) ?? []), cell]);
    const headerRow = [...byRow.entries()]
      .sort(([a], [b]) => a - b)
      .find(([, cells]) => cells.filter((c) => typeof c[2] === "string").length >= 2);
    const headers = (headerRow?.[1] ?? [])
      .sort((a, b) => a[1] - b[1])
      .map((c) => `${c[1]}:${(c[3] ?? c[2] ?? "").toString().trim().toLowerCase()}`);
    return { name: sheet.name, hidden: sheet.hidden, headers };
  });
  return createHash("sha256").update(JSON.stringify(signature)).digest("hex");
}

/** Sube el .xlsx original (inmutable) y guarda la copia de trabajo. Falla
 * si el certificado ya tiene un workbook (un certificado = un workbook; ver
 * constraint unique de la tabla). */
export async function createCertificateWorkbook(
  supabase: SupabaseClient,
  input: { empresaId: string; userId: string; projectId: string; certificateId: string; fileName: string; bytes: Uint8Array },
): Promise<{ id: string | null; error: string | null }> {
  let workbook: WorkbookRepresentation;
  try {
    workbook = parseWorkbook(input.bytes, input.fileName);
  } catch (cause) {
    return { id: null, error: cause instanceof WorkbookInputError ? cause.message : "No se pudo leer la planilla." };
  }

  const storagePath = `${input.projectId}/${input.certificateId}/${Date.now()}-${input.fileName}`;
  const { error: uploadError } = await supabase.storage
    .from(CERTIFICATE_WORKBOOKS_BUCKET)
    .upload(storagePath, input.bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (uploadError) return { id: null, error: `No se pudo guardar el archivo original: ${uploadError.message}` };

  const snapshot: WorkingSnapshot = { fileName: workbook.fileName, sheets: toStoredSheets(workbook), definedNames: workbook.definedNames ?? [] };
  const { data, error } = await supabase
    .from("certificate_workbooks")
    .insert({
      empresa_id: input.empresaId,
      project_id: input.projectId,
      certificate_id: input.certificateId,
      original_file_name: input.fileName,
      original_file_size: input.bytes.byteLength,
      original_storage_path: storagePath,
      original_file_hash: createHash("sha256").update(input.bytes).digest("hex"),
      working_snapshot: snapshot,
      structure_hash: computeStructureHash(snapshot),
      created_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    // El archivo original ya subió a Storage; no se borra por un error acá
    // abajo (queda huérfano hasta un reintento, pero eso es preferible a
    // perder el documento fuente si el insert falla por otra causa).
    return { id: null, error: error?.message ?? "No se pudo guardar la planilla." };
  }
  return { id: String(data.id), error: null };
}

type WorkbookRow = {
  id: string; certificate_id: string; project_id: string; original_file_name: string; original_file_size: number;
  original_storage_path: string; original_file_hash: string; working_snapshot: WorkingSnapshot; working_revision: number;
  structure_hash: string; mapping: unknown; mapping_structure_hash: string | null; analyzed_at: string | null;
  analysis_error: string | null; created_at: string;
};

function fromRow(row: WorkbookRow): CertificateWorkbookRow {
  return {
    id: row.id,
    certificateId: row.certificate_id,
    projectId: row.project_id,
    originalFileName: row.original_file_name,
    originalFileSize: row.original_file_size,
    originalStoragePath: row.original_storage_path,
    originalFileHash: row.original_file_hash,
    workingSnapshot: row.working_snapshot,
    workingRevision: row.working_revision,
    structureHash: row.structure_hash,
    mapping: row.mapping,
    mappingStructureHash: row.mapping_structure_hash,
    analyzedAt: row.analyzed_at,
    analysisError: row.analysis_error,
    createdAt: row.created_at,
  };
}

const WORKBOOK_COLUMNS =
  "id, certificate_id, project_id, original_file_name, original_file_size, original_storage_path, original_file_hash, " +
  "working_snapshot, working_revision, structure_hash, mapping, mapping_structure_hash, analyzed_at, analysis_error, created_at";

export async function loadCertificateWorkbook(supabase: SupabaseClient, certificateId: string): Promise<CertificateWorkbookRow | null> {
  const { data } = await supabase
    .from("certificate_workbooks")
    .select(WORKBOOK_COLUMNS)
    .eq("certificate_id", certificateId)
    .maybeSingle();
  return data ? fromRow(data as unknown as WorkbookRow) : null;
}
