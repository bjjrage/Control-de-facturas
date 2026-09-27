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
} from "@/lib/certificates/workbook-store";

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
