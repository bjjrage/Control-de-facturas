"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlan } from "@/lib/auth";
import {
  createInventoryReceipt as createInventoryReceiptAtomic,
  confirmInventoryReceipt,
  confirmWarehouseSubmission,
  postInventoryMovement,
  saveWarehouseSubmissionLinesAtomic,
} from "@/lib/inventory/service";
import { generateWarehousePortalToken, sha256Bytes, warehousePortalUrl } from "@/lib/inventory/portal";
import { parseInventorySpreadsheet, photoEvidenceProposal } from "@/lib/inventory/evidence";
import { sanitizeFileName } from "@/lib/storage";
import type { InventoryLocationType, InventoryMovementInput, WarehouseSubmissionLineState } from "@/lib/inventory/types";

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export interface CanonicalReceiptItemInput {
  orderItemId: string;
  productoId?: string | null;
  quantity: number;
  notes?: string | null;
}

export async function createCanonicalReceipt(args: {
  orderId: string;
  fecha: string;
  recibidoPor: string;
  deliveryLocationId?: string | null;
  remisionNumber?: string | null;
  idempotencyKey: string;
  items: CanonicalReceiptItemInput[];
  notes?: string | null;
}) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  if (
    !args.items.length
    || !args.recibidoPor.trim()
    || !args.idempotencyKey.trim()
    || new Set(args.items.map((item) => item.orderItemId)).size !== args.items.length
    || args.items.some((item) => !item.orderItemId || !Number.isFinite(item.quantity) || item.quantity <= 0)
  ) {
    return { error: "La recepción necesita responsable, idempotencia y al menos una línea.", id: null };
  }
  const result = await createInventoryReceiptAtomic(supabase, {
    empresaId: profile.empresa_id,
    orderId: args.orderId,
    fecha: args.fecha,
    recibidoPor: args.recibidoPor.trim(),
    deliveryLocationId: args.deliveryLocationId,
    remisionNumber: clean(args.remisionNumber),
    idempotencyKey: args.idempotencyKey.trim(),
    createdBy: profile.id,
    notes: clean(args.notes),
    items: args.items,
  });
  if (result.error || !result.data) {
    return { error: result.error ?? "No se pudo crear la recepción.", id: null };
  }
  revalidatePath(`/orders/${args.orderId}`);
  return { error: null, id: result.data };
}

export async function uploadReceiptEvidence(receiptId: string, files: File[]) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const admin = createAdminClient();
  const { data: receipt } = await admin
    .from("oc_recepciones")
    .select("id")
    .eq("id", receiptId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!receipt) return { error: "Recepción no encontrada.", uploaded: 0 };
  let uploaded = 0;
  for (const file of files.filter((item) => item instanceof File && item.size > 0).slice(0, 10)) {
    if (file.size > 20 * 1024 * 1024) return { error: `${file.name}: supera los 20MB.`, uploaded };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = sha256Bytes(bytes);
    const { data: duplicate } = await admin
      .from("inventory_receipt_evidence")
      .select("id")
      .eq("receipt_id", receiptId)
      .eq("sha256", sha256)
      .maybeSingle();
    if (duplicate) {
      uploaded++;
      continue;
    }
    const path = `receipts/${receiptId}/${randomUUID()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage.from("warehouse-evidence").upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadError) continue;
    const { error } = await admin.from("inventory_receipt_evidence").insert({
      empresa_id: profile.empresa_id,
      receipt_id: receiptId,
      storage_bucket: "warehouse-evidence",
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      sha256,
      uploaded_by: profile.id,
    });
    if (error) {
      await admin.storage.from("warehouse-evidence").remove([path]);
      continue;
    }
    uploaded++;
  }
  revalidatePath("/orders");
  return { error: null, uploaded };
}

export async function createInventoryLocation(args: {
  name: string;
  locationType: InventoryLocationType;
  projectId?: string | null;
  parentLocationId?: string | null;
  isPrimary?: boolean;
}) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const name = clean(args.name);
  if (!name) return { error: "El nombre de la ubicación es obligatorio.", id: null };
  if (args.locationType === "PROJECT" && !args.projectId) {
    return { error: "Una ubicación de obra necesita proyecto.", id: null };
  }
  if (args.projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", args.projectId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!project) return { error: "Proyecto inválido para esta empresa.", id: null };
  }
  const { data, error } = await supabase
    .from("inventory_locations")
    .insert({
      empresa_id: profile.empresa_id,
      name,
      location_type: args.locationType,
      project_id: args.projectId ?? null,
      parent_location_id: args.parentLocationId ?? null,
      is_primary: args.isPrimary ?? false,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear la ubicación.", id: null };
  revalidatePath("/inventory");
  revalidatePath("/stock");
  return { error: null, id: data.id as string };
}

export async function createWarehousePortalLink(locationId: string, expiresAt?: string | null) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: location } = await supabase
    .from("inventory_locations")
    .select("id, location_type, project_id")
    .eq("id", locationId)
    .eq("empresa_id", profile.empresa_id)
    .eq("active", true)
    .maybeSingle();
  if (!location || location.location_type !== "PROJECT" || !location.project_id) {
    return { error: "El link solo puede crearse para una ubicación de obra.", token: null, url: null };
  }
  const generated = generateWarehousePortalToken();
  const { error } = await supabase.from("warehouse_portal_links").insert({
    empresa_id: profile.empresa_id,
    location_id: locationId,
    token_hash: generated.tokenHash,
    token_hint: generated.tokenHint,
    expires_at: expiresAt ?? null,
    created_by: profile.id,
  });
  if (error) return { error: error.message, token: null, url: null };
  return { error: null, token: generated.token, url: warehousePortalUrl(generated.token) };
}

export async function postCanonicalInventoryMovement(input: Omit<InventoryMovementInput, "empresaId" | "createdBy">) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const result = await postInventoryMovement(supabase, {
    ...input,
    empresaId: profile.empresa_id,
    createdBy: profile.id,
  });
  if (result.error) return { error: result.error, id: null };
  revalidatePath("/stock");
  return { error: null, id: result.data };
}

export async function confirmCanonicalReceipt(args: {
  receiptId: string;
  deliveryLocationId?: string | null;
  idempotencyKey?: string | null;
}) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const result = await confirmInventoryReceipt(supabase, {
    empresaId: profile.empresa_id,
    receiptId: args.receiptId,
    deliveryLocationId: args.deliveryLocationId,
    idempotencyKey: args.idempotencyKey,
    confirmedBy: profile.id,
  });
  if (result.error) return { error: result.error, ids: null };
  revalidatePath("/stock");
  revalidatePath("/orders");
  return { error: null, ids: result.data };
}

export async function updateWarehouseSubmissionLine(args: {
  lineId: string;
  productoId?: string | null;
  quantity?: number | null;
  unit?: string | null;
  budgetItemId?: string | null;
  state: WarehouseSubmissionLineState;
  notes?: string | null;
}) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: line } = await supabase
    .from("warehouse_submission_lines")
    .select("id, submission_id, inventory_movement_id")
    .eq("id", args.lineId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!line) return { error: "Línea de rendición no encontrada." };
  if (line.inventory_movement_id) {
    return { error: "La línea ya está vinculada a un movimiento canónico y es inmutable." };
  }
  const { data: submission } = await supabase
    .from("warehouse_submissions")
    .select("status")
    .eq("id", line.submission_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (submission?.status === "CONFIRMED") {
    return { error: "Las líneas de una rendición confirmada son inmutables." };
  }
  const { error } = await supabase
    .from("warehouse_submission_lines")
    .update({
      producto_id: args.productoId ?? null,
      quantity: args.quantity ?? null,
      unit: clean(args.unit),
      budget_item_id: args.budgetItemId ?? null,
      state: args.state,
      notes: clean(args.notes),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.lineId)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: error.message };
  revalidatePath(`/inventory/submissions/${line.submission_id}`);
  return { error: null };
}

export async function processWarehouseSubmission(submissionId: string) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: submission } = await supabase
    .from("warehouse_submissions")
    .select("id, status, upload_incomplete, processing_error")
    .eq("id", submissionId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!submission) return { error: "Rendición no encontrada.", proposals: 0 };
  if (submission.status === "CONFIRMED" || submission.status === "VOIDED") {
    return { error: "La rendición ya no admite procesamiento.", proposals: 0 };
  }
  await supabase
    .from("warehouse_submissions")
    .update({
      status: "PROCESSING",
      processing_started_at: new Date().toISOString(),
      processing_error: submission.upload_incomplete ? submission.processing_error : null,
    })
    .eq("id", submissionId)
    .eq("empresa_id", profile.empresa_id);

  const { data: evidence } = await supabase
    .from("warehouse_submission_evidence")
    .select("id, storage_bucket, storage_path, file_name, mime_type, extraction_status")
    .eq("submission_id", submissionId)
    .eq("empresa_id", profile.empresa_id)
    .eq("extraction_status", "NOT_PROCESSED")
    .order("created_at");

  let proposalCount = 0;
  const errors: string[] = [];
  if (submission.upload_incomplete && submission.processing_error) {
    errors.push(submission.processing_error);
  }
  for (const item of evidence ?? []) {
    const { data: claimed } = await supabase
      .from("warehouse_submission_evidence")
      .update({ extraction_status: "PROCESSING" })
      .eq("id", item.id)
      .eq("empresa_id", profile.empresa_id)
      .eq("extraction_status", "NOT_PROCESSED")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const isSpreadsheet =
      item.mime_type?.includes("spreadsheet") ||
      item.mime_type?.includes("csv") ||
      /\.(xlsx|xls|csv)$/i.test(item.file_name);
    if (!isSpreadsheet) {
      const proposal = photoEvidenceProposal(item.file_name);
      await supabase
        .from("warehouse_submission_evidence")
        .update({ extraction_status: "PROPOSED", extraction_result: proposal, confidence: null })
        .eq("id", item.id)
        .eq("empresa_id", profile.empresa_id);
      continue;
    }

    const downloaded = await admin.storage.from(item.storage_bucket).download(item.storage_path);
    if (downloaded.error || !downloaded.data) {
      const message = `${item.file_name}: no se pudo leer la planilla`;
      errors.push(message);
      await supabase
        .from("warehouse_submission_evidence")
        .update({ extraction_status: "FAILED", extraction_error: downloaded.error?.message ?? message })
        .eq("id", item.id)
        .eq("empresa_id", profile.empresa_id);
      continue;
    }
    const parsed = parseInventorySpreadsheet(new Uint8Array(await downloaded.data.arrayBuffer()));
    if (parsed.errors.length) errors.push(...parsed.errors.map((error) => `${item.file_name}: ${error}`));

    const rows = parsed.rows.map((row) => ({
      rawDescription: row.rawDescription,
      quantity: row.quantity,
      unit: row.unit,
      confidence: row.confidence,
      uncertaintyReason: row.uncertaintyReason,
      notes: row.notes,
    }));

    if (rows.length) {
      const { data: saveResult, error: saveError } = await saveWarehouseSubmissionLinesAtomic(supabase, {
        empresaId: profile.empresa_id,
        submissionId,
        evidenceId: item.id,
        lines: rows,
      });
      if (saveError || !saveResult) {
        const errMsg = `${item.file_name}: ${saveError ?? "error al guardar líneas de rendición"}`;
        errors.push(errMsg);
        await supabase
          .from("warehouse_submission_evidence")
          .update({ extraction_status: "FAILED", extraction_error: errMsg })
          .eq("id", item.id)
          .eq("empresa_id", profile.empresa_id);
        continue;
      }
      proposalCount += saveResult.inserted_count;
    }

    await supabase
      .from("warehouse_submission_evidence")
      .update({
        extraction_status: "PROPOSED",
        extraction_result: { rows: parsed.rows.length, errors: parsed.errors },
        extraction_error: parsed.errors.length ? parsed.errors.join("; ") : null,
        confidence: parsed.errors.length ? 0.5 : 1,
      })
      .eq("id", item.id)
      .eq("empresa_id", profile.empresa_id);
  }
  await supabase
    .from("warehouse_submissions")
    .update({
      status: "NEEDS_REVIEW",
      processed_at: new Date().toISOString(),
      processing_error: errors.length ? errors.join("; ") : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .eq("empresa_id", profile.empresa_id);
  revalidatePath(`/inventory/submissions/${submissionId}`);
  return { error: errors.length ? errors.join("; ") : null, proposals: proposalCount };
}

export async function confirmCanonicalWarehouseSubmission(args: {
  submissionId: string;
  idempotencyKey?: string | null;
}) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const result = await confirmWarehouseSubmission(supabase, {
    empresaId: profile.empresa_id,
    submissionId: args.submissionId,
    confirmedBy: profile.id,
    idempotencyKey: args.idempotencyKey,
  });
  if (result.error) return { error: result.error, ids: null };
  revalidatePath(`/inventory/submissions/${args.submissionId}`);
  revalidatePath("/stock");
  return { error: null, ids: result.data };
}
