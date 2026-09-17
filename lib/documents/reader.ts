// lib/documents/reader.ts
// DocumentReader — Capa mínima server-side para leer contenido real de documentos.
// Soporta: PDF (text layer), XLSX (workbook/sheets/cells estructurados).
// NO incluye DeepSeek Vision — si el PDF es escaneado sin text layer, retorna requires_vision.
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.ms-excel"
  | "text/csv"
  | "application/vnd.oasis.opendocument.spreadsheet";

export interface DocumentExtractionResult {
  documentId: string;
  mimeType: string;
  extractionMethod: "pdf_text" | "xlsx_structured" | "csv_text" | "unsupported";
  text?: string;           // para PDF con text layer, CSV
  structured?: {           // para XLSX
    sheets: Array<{
      name: string;
      rows: Array<Record<string, unknown>>;
      cols: string[];
    }>;
  };
  warnings: string[];
  truncated: boolean;
  requiresVision: boolean; // true si PDF escaneado sin text layer
}

export interface DocumentReadParams {
  db: SupabaseClient;
  empresaId: string;
  documentId: string;
  maxChars?: number;
  maxRows?: number;
  maxSheets?: number;
}

const MAX_TEXT_CHARS = 100000;
const MAX_XLSX_ROWS = 5000;
const MAX_XLSX_SHEETS = 10;

/** Detecta si un buffer es PDF */
function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
}

/** Detecta si un buffer es XLSX/ZIP */
function isXlsx(buffer: Buffer): boolean {
  // XLSX es un ZIP que empieza con PK
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Extrae texto de PDF usando pdf-parse (lazy import) */
async function extractPdfText(buffer: Buffer, maxChars: number): Promise<{
  text: string;
  truncated: boolean;
  requiresVision: boolean;
}> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();

  const text = result.text.trim();
  const truncated = text.length > maxChars;
  const finalText = truncated ? text.slice(0, maxChars) : text;

  // Si el PDF tiene muy poco texto extraíble, probablemente es escaneado
  const requiresVision = text.length < 100;

  return { text: finalText, truncated, requiresVision };
}

/** Extrae estructura de XLSX usando xlsx (lazy import) */
async function extractXlsxStructured(buffer: Buffer, maxRows: number, maxSheets: number): Promise<{
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>>; cols: string[] }>;
  truncated: boolean;
}> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const sheets = workbook.SheetNames.slice(0, maxSheets).map((name) => {
    const sheet = workbook.Sheets[name];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
    const rows = json.slice(0, maxRows);
    const cols = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
    return { name, rows, cols };
  });

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  const truncated = totalRows > maxRows;

  return { sheets, truncated };
}

/** Extrae CSV como texto plano */
async function extractCsvText(buffer: Buffer, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  const text = buffer.toString("utf-8");
  const truncated = text.length > maxChars;
  return { text: truncated ? text.slice(0, maxChars) : text, truncated };
}

/**
 * Lee y extrae contenido real de un documento.
 * Valida tenant, ownership, y MIME type antes de procesar.
 * Nunca devuelve el archivo binario/base64 — solo texto/estructura extraída.
 * Contenido extraído se trata como DATA no confiable (prompt injection protection).
 */
export async function readDocumentContent(params: DocumentReadParams): Promise<DocumentExtractionResult> {
  const { db, empresaId, documentId, maxChars = MAX_TEXT_CHARS, maxRows = MAX_XLSX_ROWS, maxSheets = MAX_XLSX_SHEETS } = params;

  // 1. Buscar attachment con tenant scoping
  const { data: attachment, error: attErr } = await params.db
    .from("attachments")
    .select("*")
    .eq("id", documentId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (attErr) throw new Error(`Error leyendo documento: ${attErr.message}`);
  if (!attachment) {
    throw new Error(`Documento no encontrado o no pertenece a tu empresa (id=${documentId})`);
  }

  // 2. Validar MIME type soportado
  const mimeType = attachment.mime_type as DocumentMimeType | null;
  if (!mimeType) {
    return {
      documentId: attachment.id,
      mimeType: "unknown",
      extractionMethod: "unsupported",
      warnings: ["Documento sin mime_type definido"],
      truncated: false,
      requiresVision: false,
    };
  }

  // 3. Descargar archivo desde storage
  let fileBuffer: Buffer;
  try {
    const { data: fileData, error: storageErr } = await params.db.storage
      .from(attachment.bucket)
      .download(attachment.path);

    if (storageErr || !fileData) {
      throw new Error(`No se pudo descargar archivo: ${storageErr?.message ?? "sin data"}`);
    }

    fileBuffer = Buffer.from(await fileData.arrayBuffer());
  } catch (e) {
    return {
      documentId: attachment.id,
      mimeType,
      extractionMethod: "unsupported",
      warnings: [`Error accediendo al storage: ${e instanceof Error ? e.message : String(e)}`],
      truncated: false,
      requiresVision: false,
    };
  }

  // 4. Extraer según MIME type
  if (mimeType === "application/pdf" || isPdf(fileBuffer)) {
    const { text, truncated, requiresVision } = await extractPdfText(fileBuffer, params.maxChars ?? MAX_TEXT_CHARS);
    return {
      documentId: attachment.id,
      mimeType: "application/pdf",
      extractionMethod: requiresVision ? "unsupported" : "pdf_text",
      text,
      warnings: requiresVision ? ["PDF parece escaneado (sin text layer suficiente) — requiere vision provider"] : [],
      truncated,
      requiresVision,
    };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    isXlsx(fileBuffer)
  ) {
    const { sheets, truncated } = await extractXlsxStructured(fileBuffer, params.maxRows ?? MAX_XLSX_ROWS, params.maxSheets ?? MAX_XLSX_SHEETS);
    return {
      documentId: attachment.id,
      mimeType,
      extractionMethod: "xlsx_structured",
      structured: { sheets },
      warnings: [],
      truncated,
      requiresVision: false,
    };
  }

  if (mimeType === "text/csv") {
    const { text, truncated } = await extractCsvText(fileBuffer, params.maxChars ?? MAX_TEXT_CHARS);
    return {
      documentId: attachment.id,
      mimeType: "text/csv",
      extractionMethod: "csv_text",
      text,
      warnings: [],
      truncated,
      requiresVision: false,
    };
  }

  // MIME type no soportado
  return {
    documentId: attachment.id,
    mimeType,
    extractionMethod: "unsupported",
    warnings: [`MIME type no soportado para extracción: ${mimeType}`],
    truncated: false,
    requiresVision: false,
  };
}

/** Verifica si un MIME type es soportado para extracción de contenido */
export function isSupportedMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/vnd.oasis.opendocument.spreadsheet",
  ].includes(mimeType);
}

/** Computa hash SHA-256 del contenido extraído (para deduplicación/auditoría) */
export function hashExtractedContent(result: DocumentExtractionResult): string {
  const payload = {
    text: result.text ?? "",
    structured: result.structured ?? null,
    mimeType: result.mimeType,
  };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(canonical).digest("hex");
}