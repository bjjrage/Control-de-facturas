"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectCertificateStatus } from "@/lib/types";
import {
  CERTIFICATE_WORKBOOKS_BUCKET,
  computeStructureHash,
  createCertificateWorkbook,
  loadCertificateWorkbook,
  type CertificateWorkbookRow,
  type WorkingSnapshot,
  workbookFromSnapshot,
} from "@/lib/certificates/workbook-store";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import type { WorkbookInterpretationResult } from "@/lib/workbook-interpretation/types";

/**
 * Fase 1 de "Certificados Excel-first" — subir y leer la planilla embebida
 * de un certificado. Ver memoria de proyecto excel-first-certificados.
 */

async function loadOwnedCertificateForWorkbook(supabase: SupabaseClient, certificateId: string, empresaId: string) {
  const { data } = await supabase
    .from("project_certificates")
    .select("id, project_id, status, projects!inner(empresa_id)")
    .eq("id", certificateId)
    .maybeSingle();
  if (!data) return null;
  const proj = data.projects as unknown as { empresa_id: string };
  if (proj.empresa_id !== empresaId) return null;
  return { id: data.id as string, projectId: data.project_id as string, status: data.status as ProjectCertificateStatus };
}

export type AttachCertificateWorkbookResult = { error: string | null; workbookId: string | null };

/** Sube el Excel del certificado tal cual — todas las hojas, ocultas
 * incluidas, con fórmulas. Un certificado solo puede tener un workbook (se
 * reemplaza el vínculo si ya tenía uno de un intento previo fallido; ver
 * constraint unique en la tabla). Solo mientras el certificado está en
 * BORRADOR — lo mismo que ya protege sus líneas. */
export async function attachCertificateWorkbook(certificateId: string, formData: FormData): Promise<AttachCertificateWorkbookResult> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificateForWorkbook(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado.", workbookId: null };
  if (cert.status !== "BORRADOR") return { error: "Solo se puede adjuntar la planilla a un certificado en borrador.", workbookId: null };

  const existing = await loadCertificateWorkbook(supabase, certificateId);
  if (existing) return { error: "Este certificado ya tiene una planilla adjunta.", workbookId: existing.id };

  const uploaded = formData.get("file");
  if (!(uploaded instanceof File)) return { error: "Seleccioná un archivo .xlsx.", workbookId: null };
  if (uploaded.size > 10 * 1024 * 1024) return { error: "El archivo supera el límite de 10 MB.", workbookId: null };

  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  const result = await createCertificateWorkbook(supabase, {
    empresaId: profile.empresa_id,
    userId: profile.id,
    projectId: cert.projectId,
    certificateId,
    fileName: uploaded.name,
    bytes,
  });
  if (result.error) return { error: result.error, workbookId: null };

  await logAudit(supabase, {
    action: "certificate_workbook.attached",
    detail: { project_id: cert.projectId, certificate_id: certificateId, workbook_id: result.id, file_name: uploaded.name },
  });
  revalidatePath(`/projects/${cert.projectId}`);
  return { error: null, workbookId: result.id };
}

/**
 * Autoguardado de la planilla embebida (Fase 3): la grilla llama a esto cada
 * tanto mientras el usuario edita, nunca celda por celda. Solo escribe si el
 * certificado sigue en BORRADOR — la base ya lo exige
 * (guard_certificate_workbook_write, migración 20260927120000), esto
 * devuelve el mismo motivo en español antes de intentar el UPDATE.
 */
export async function saveCertificateWorkbookSnapshot(
  workbookId: string,
  snapshot: WorkingSnapshot
): Promise<{ error: string | null; structureChanged: boolean }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("certificate_workbooks")
    .select("id, certificate_id, empresa_id, structure_hash, working_revision, project_certificates!inner(status)")
    .eq("id", workbookId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!existing) return { error: "Planilla no encontrada.", structureChanged: false };
  const cert = existing.project_certificates as unknown as { status: ProjectCertificateStatus };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya no está en borrador; la planilla quedó congelada.", structureChanged: false };

  const newStructureHash = computeStructureHash(snapshot);
  const structureChanged = newStructureHash !== existing.structure_hash;

  const { error } = await supabase
    .from("certificate_workbooks")
    .update({
      working_snapshot: snapshot,
      structure_hash: newStructureHash,
      working_revision: (existing.working_revision as number) + 1,
    })
    .eq("id", workbookId);
  if (error) return { error: "No se pudo guardar la planilla.", structureChanged: false };

  revalidatePath(`/projects/${existing.certificate_id}`);
  return { error: null, structureChanged };
}

export type ApplyCertificateWorkbookResult = {
  error: string | null;
  lines: number;
  montoPresente: number | null;
  warnings: string[];
};

/**
 * "Aplicar planilla al certificado": el paso explícito que pasa lo trabajado
 * en la planilla a los números del ERP (líneas, montos, período). El
 * autoguardado solo cuida que no se pierda lo tipeado; esto corre UNA vez,
 * cuando el usuario lo pide. No llama a Luna: relee las celdas con el mapeo
 * que ya se guardó al importar. Si la estructura (hojas/columnas) cambió, ese
 * mapeo ya no vale y no se aplica nada.
 */
export async function applyCertificateWorkbook(certificateId: string): Promise<ApplyCertificateWorkbookResult> {
  const fail = (error: string, warnings: string[] = []): ApplyCertificateWorkbookResult => ({ error, lines: 0, montoPresente: null, warnings });
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: cert } = await supabase
    .from("project_certificates")
    .select("id, project_id, numero, status, projects!inner(empresa_id)")
    .eq("id", certificateId)
    .maybeSingle();
  if (!cert || (cert.projects as unknown as { empresa_id: string }).empresa_id !== profile.empresa_id) return fail("Certificado no encontrado.");
  if (cert.status !== "BORRADOR") return fail("El certificado ya no está en borrador; retrocedelo para volver a aplicar la planilla.");

  const workbook = await loadCertificateWorkbook(supabase, certificateId);
  if (!workbook) return fail("Este certificado no tiene planilla.");
  if (!workbook.mapping) return fail("Esta planilla no tiene un análisis guardado; no se sabe qué celda es qué.");
  const currentStructure = computeStructureHash(workbook.workingSnapshot);
  if (workbook.mappingStructureHash && workbook.mappingStructureHash !== currentStructure) {
    return fail("Cambió la estructura de la planilla (hojas o columnas movidas/agregadas); el análisis guardado ya no corresponde. No se aplicó nada.");
  }

  const candidate = buildCanonicalImportCandidate(
    workbookFromSnapshot(workbook.workingSnapshot),
    { importPlan: workbook.mapping } as WorkbookInterpretationResult
  );
  const doc = candidate.certificate;
  if (doc.status !== "SAFE_TO_APPLY" && doc.status !== "APPLY_WITH_WARNINGS") {
    return fail(`No se aplicó: ${doc.reason}`);
  }
  if (doc.number !== null && Number(doc.number) !== Number(cert.numero)) {
    return fail(`La planilla dice Certificado N°${doc.number} y este es el N°${cert.numero}; no se aplicó.`);
  }

  const { data: budget } = await supabase.from("budget_items").select("id, code").eq("project_id", cert.project_id);
  const codeToId = new Map((budget ?? []).map((row) => [String(row.code), String(row.id)]));
  const lines = doc.items.map((item, index) => ({
    certificate_id: certificateId,
    budget_item_id: item.matchedBudgetCode ? codeToId.get(item.matchedBudgetCode) ?? null : null,
    codigo: item.code,
    descripcion: item.description,
    unidad: item.unit,
    qty_contractual: item.quantityContractual,
    precio_unitario: item.unitPrice,
    qty_anterior: item.quantityPrevious,
    qty_presente: item.quantityCurrent,
    sort_order: index,
    source_sheet: item.source.sheet,
    source_row: item.source.row ?? null,
    source_cells: item.source.range ? { range: item.source.range } : null,
    mapping_version: workbook.mappingStructureHash,
  }));

  // Reemplazo completo: nada referencia a estas líneas (sin FKs entrantes) y
  // la guarda de la base solo deja escribirlas en BORRADOR.
  const { error: deleteError } = await supabase.from("project_certificate_items").delete().eq("certificate_id", certificateId);
  if (deleteError) return fail(`No se pudieron reemplazar las líneas: ${deleteError.message}`);
  const { error: insertError } = await supabase.from("project_certificate_items").insert(lines);
  if (insertError) return fail(`Se borraron las líneas anteriores pero falló la carga de las nuevas: ${insertError.message}. Volvé a apretar Aplicar.`);

  const { data: stored } = await supabase
    .from("project_certificate_items")
    .select("monto_anterior, monto_presente")
    .eq("certificate_id", certificateId);
  const montoAnterior = (stored ?? []).reduce((s, i) => s + Number(i.monto_anterior ?? 0), 0);
  const montoPresente = (stored ?? []).reduce((s, i) => s + Number(i.monto_presente ?? 0), 0);
  const { error: headerError } = await supabase
    .from("project_certificates")
    .update({
      monto_anterior: montoAnterior,
      monto_presente: montoPresente,
      ...(doc.periodStart ? { period_start: doc.periodStart } : {}),
      ...(doc.periodEnd ? { period_end: doc.periodEnd } : {}),
    })
    .eq("id", certificateId);
  if (headerError) return fail(`Las líneas se aplicaron pero no se pudieron actualizar los totales: ${headerError.message}`);

  await logAudit(supabase, {
    action: "project_certificate.workbook_applied",
    detail: { project_id: cert.project_id, certificate_id: certificateId, lines: lines.length, monto_presente: montoPresente, working_structure: currentStructure },
  });
  revalidatePath(`/projects/${cert.project_id}`);
  return {
    error: null,
    lines: lines.length,
    montoPresente,
    warnings: doc.status === "APPLY_WITH_WARNINGS" ? [doc.reason] : [],
  };
}

export type CertificateWorkbookView = Pick<
  CertificateWorkbookRow,
  "id" | "originalFileName" | "workingSnapshot" | "structureHash" | "mapping" | "mappingStructureHash" | "analyzedAt" | "analysisError" | "createdAt"
>;

/** Planilla adjunta a un certificado (null si no tiene). */
export async function getCertificateWorkbook(certificateId: string): Promise<{ error: string | null; workbook: CertificateWorkbookView | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificateForWorkbook(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado.", workbook: null };

  const workbook = await loadCertificateWorkbook(supabase, certificateId);
  if (!workbook) return { error: null, workbook: null };
  return {
    error: null,
    workbook: {
      id: workbook.id,
      originalFileName: workbook.originalFileName,
      workingSnapshot: workbook.workingSnapshot,
      structureHash: workbook.structureHash,
      mapping: workbook.mapping,
      mappingStructureHash: workbook.mappingStructureHash,
      analyzedAt: workbook.analyzedAt,
      analysisError: workbook.analysisError,
      createdAt: workbook.createdAt,
    },
  };
}

/** URL firmada de corta duración para descargar el .xlsx original tal cual
 * se subió — nunca la copia de trabajo. */
export async function getCertificateWorkbookDownloadUrl(certificateId: string): Promise<{ error: string | null; url: string | null; fileName: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificateForWorkbook(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado.", url: null, fileName: null };

  const { data: row } = await supabase
    .from("certificate_workbooks")
    .select("original_storage_path, original_file_name")
    .eq("certificate_id", certificateId)
    .maybeSingle();
  if (!row) return { error: "Este certificado no tiene planilla adjunta.", url: null, fileName: null };

  const { data, error } = await supabase.storage
    .from(CERTIFICATE_WORKBOOKS_BUCKET)
    .createSignedUrl(row.original_storage_path, 300);
  if (error || !data) return { error: "No se pudo generar el enlace de descarga.", url: null, fileName: null };
  return { error: null, url: data.signedUrl, fileName: row.original_file_name };
}
