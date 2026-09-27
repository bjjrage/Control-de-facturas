import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseWorkbook, WorkbookInputError } from "@/lib/workbook-interpretation/parser";
import type { CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import type { WorkbookInterpretationResult } from "@/lib/workbook-interpretation/types";
import { CERTIFICATE_WORKBOOKS_BUCKET, computeStructureHash, toStoredSheets, type WorkingSnapshot } from "./workbook-store";

/**
 * Fase 4 de "Certificados Excel-first": sesión de importación de OBRA NUEVA.
 * El Excel entra completo sin crear ningún project; la planilla se ve y se
 * edita en la sesión mientras Luna analiza. La obra se crea recién cuando el
 * usuario confirma (ver [[excel-first-certificados]], Corrección 1).
 */

export type ContractRegime = "PUBLIC_WORK" | "PRIVATE_WORK" | "OTHER";
export type ImportSessionStatus = "UPLOADED" | "ANALYZING" | "ANALYZED" | "ANALYSIS_FAILED" | "CONFIRMED" | "DISCARDED";

export type ImportSession = {
  id: string;
  status: ImportSessionStatus;
  originalFileName: string;
  originalFileSize: number;
  originalStoragePath: string;
  originalFileHash: string;
  workingSnapshot: WorkingSnapshot;
  workingRevision: number;
  structureHash: string;
  interpretation: WorkbookInterpretationResult | null;
  candidate: CanonicalImportCandidate | null;
  analyzedStructureHash: string | null;
  analysisStartedAt: string | null;
  analyzedAt: string | null;
  analysisError: string | null;
  suggestedRegime: ContractRegime | null;
  confirmedProjectId: string | null;
  createdAt: string;
};

type SessionRow = {
  id: string; status: ImportSessionStatus; original_file_name: string; original_file_size: number;
  original_storage_path: string; original_file_hash: string; working_snapshot: WorkingSnapshot; working_revision: number;
  structure_hash: string; interpretation: WorkbookInterpretationResult | null; candidate: CanonicalImportCandidate | null;
  analyzed_structure_hash: string | null; analysis_started_at: string | null; analyzed_at: string | null; analysis_error: string | null;
  suggested_regime: ContractRegime | null; confirmed_project_id: string | null; created_at: string;
};

const SESSION_COLUMNS =
  "id, status, original_file_name, original_file_size, original_storage_path, original_file_hash, working_snapshot, " +
  "working_revision, structure_hash, interpretation, candidate, analyzed_structure_hash, analysis_started_at, analyzed_at, analysis_error, " +
  "suggested_regime, confirmed_project_id, created_at";

function fromRow(row: SessionRow): ImportSession {
  return {
    id: row.id,
    status: row.status,
    originalFileName: row.original_file_name,
    originalFileSize: row.original_file_size,
    originalStoragePath: row.original_storage_path,
    originalFileHash: row.original_file_hash,
    workingSnapshot: row.working_snapshot,
    workingRevision: row.working_revision,
    structureHash: row.structure_hash,
    interpretation: row.interpretation,
    candidate: row.candidate,
    analyzedStructureHash: row.analyzed_structure_hash,
    analysisStartedAt: row.analysis_started_at,
    analyzedAt: row.analyzed_at,
    analysisError: row.analysis_error,
    suggestedRegime: row.suggested_regime,
    confirmedProjectId: row.confirmed_project_id,
    createdAt: row.created_at,
  };
}

/** Sube el original (inmutable) y guarda la copia de trabajo, sin project. */
export async function createImportSession(
  supabase: SupabaseClient,
  input: { empresaId: string; userId: string; fileName: string; bytes: Uint8Array },
): Promise<{ id: string | null; error: string | null }> {
  let snapshot: WorkingSnapshot;
  try {
    const workbook = parseWorkbook(input.bytes, input.fileName);
    snapshot = { fileName: workbook.fileName, sheets: toStoredSheets(workbook), definedNames: workbook.definedNames ?? [] };
  } catch (cause) {
    return { id: null, error: cause instanceof WorkbookInputError ? cause.message : "No se pudo leer la planilla." };
  }

  const id = randomUUID();
  const storagePath = `sessions/${input.empresaId}/${id}/${input.fileName}`;
  const { error: uploadError } = await supabase.storage
    .from(CERTIFICATE_WORKBOOKS_BUCKET)
    .upload(storagePath, input.bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (uploadError) return { id: null, error: `No se pudo guardar el archivo original: ${uploadError.message}` };

  const { error } = await supabase.from("workbook_import_sessions").insert({
    id,
    empresa_id: input.empresaId,
    created_by: input.userId,
    original_file_name: input.fileName,
    original_file_size: input.bytes.byteLength,
    original_storage_path: storagePath,
    original_file_hash: createHash("sha256").update(input.bytes).digest("hex"),
    working_snapshot: snapshot,
    structure_hash: computeStructureHash(snapshot),
  });
  if (error) return { id: null, error: error.message };
  return { id, error: null };
}

export async function loadImportSession(supabase: SupabaseClient, empresaId: string, sessionId: string): Promise<ImportSession | null> {
  const { data } = await supabase
    .from("workbook_import_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return data ? fromRow(data as unknown as SessionRow) : null;
}

/**
 * Sugerencia de régimen — nunca decide: el usuario la confirma una vez al
 * crear la obra (Corrección 3). Un certificado de ejecución detectado con su
 * circuito (anticipo/retención/fiscalización) es la señal de obra pública.
 */
export function suggestContractRegime(candidate: CanonicalImportCandidate): ContractRegime | null {
  if (candidate.certificate.status !== "NOT_DETECTED") return "PUBLIC_WORK";
  return null;
}
