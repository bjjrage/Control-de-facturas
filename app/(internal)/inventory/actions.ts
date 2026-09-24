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
  postManualInventoryMovement,
  saveWarehouseSubmissionLinesAtomic,
} from "@/lib/inventory/service";
import { generateWarehousePortalToken, sha256Bytes, warehousePortalUrl } from "@/lib/inventory/portal";
import { parseInventorySpreadsheet, photoEvidenceProposal } from "@/lib/inventory/evidence";
import { sanitizeFileName } from "@/lib/storage";
import type { InventoryLocationType, InventoryMovementInput, WarehouseSubmissionLineState } from "@/lib/inventory/types";
import {
  buildManualInventoryMovement,
  isManualInventoryMovementType,
  resolveManualMovementProject,
  validateManualInventoryMovementRequest,
  type ManualInventoryMovementRequest,
} from "@/lib/inventory/manual";

type ManualMovementActionResult = { error: string | null; id: string | null; retryable: boolean };

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
  if (typeof locationId !== "string" || !/^[0-9a-f-]{36}$/i.test(locationId)) {
    return { error: "La ubicación de depósito no es válida.", token: null, url: null };
  }
  let normalizedExpiry: string | null = null;
  if (expiresAt != null && expiresAt !== "") {
    const parsedExpiry = new Date(expiresAt);
    if (!Number.isFinite(parsedExpiry.getTime()) || parsedExpiry.getTime() <= Date.now()) {
      return { error: "La fecha de expiración debe ser futura.", token: null, url: null };
    }
    normalizedExpiry = parsedExpiry.toISOString();
  }
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
    expires_at: normalizedExpiry,
    created_by: profile.id,
  });
  if (error) return { error: error.message, token: null, url: null };
  revalidatePath(`/projects/${location.project_id}`);
  return { error: null, token: generated.token, url: warehousePortalUrl(generated.token) };
}

export async function revokeWarehousePortalLink(linkId: string) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  if (typeof linkId !== "string" || !/^[0-9a-f-]{36}$/i.test(linkId)) {
    return { error: "El enlace de depósito no es válido." };
  }
  const { data: link } = await supabase
    .from("warehouse_portal_links")
    .select("id, location_id, active")
    .eq("id", linkId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!link) return { error: "El enlace no existe o no pertenece a esta empresa." };
  if (!link.active) return { error: null };

  const { data: location } = await supabase
    .from("inventory_locations")
    .select("project_id, location_type")
    .eq("id", link.location_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!location || location.location_type !== "PROJECT" || !location.project_id) {
    return { error: "No se pudo verificar el depósito de obra del enlace." };
  }

  const { error } = await supabase
    .from("warehouse_portal_links")
    .update({ active: false })
    .eq("id", linkId)
    .eq("empresa_id", profile.empresa_id)
    .eq("active", true);
  if (error) return { error: error.message };
  revalidatePath(`/projects/${location.project_id}`);
  return { error: null };
}

export async function postCanonicalInventoryMovement(input: ManualInventoryMovementRequest): Promise<ManualMovementActionResult> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const fail = (error: string, retryable = false): ManualMovementActionResult => ({ error, id: null, retryable });

  try {
    validateManualInventoryMovementRequest(input);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Los datos del movimiento no son válidos.");
  }
  if (!isManualInventoryMovementType(input.movementType)) {
    return fail("El tipo de movimiento manual no es válido.");
  }

  const reason = input.reason?.trim() ?? "";
  const { data: existing, error: existingError } = await supabase
    .from("inventory_movements")
    .select("id, producto_id, quantity, movement_type, from_location_id, to_location_id, source_type, source_id, source_line_id, cost_currency, unit_cost, exchange_rate_to_company, metadata")
    .eq("empresa_id", profile.empresa_id)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  // A failed lookup cannot prove that an earlier request with this key did not commit.
  if (existingError) return fail(existingError.message, true);
  if (existing) {
    const storedReason = (existing.metadata as { reason?: unknown } | null)?.reason;
    const sameRequest =
      existing.source_type === "MANUAL"
      && existing.source_id === input.idempotencyKey
      && existing.source_line_id == null
      && existing.producto_id === input.productoId
      && Number(existing.quantity) === input.quantity
      && existing.movement_type === input.movementType
      && existing.from_location_id === (input.fromLocationId ?? null)
      && existing.to_location_id === (input.toLocationId ?? null)
      && (typeof storedReason === "string" ? storedReason : "") === reason
      && (input.movementType !== "ADJUSTMENT" || existing.cost_currency === input.costCurrency)
      && (input.movementType !== "ADJUSTMENT" || input.quantity < 0 || Number(existing.unit_cost) === input.unitCost)
      && (input.movementType !== "ADJUSTMENT" || input.quantity < 0
        || Number(existing.exchange_rate_to_company ?? 0) === Number(
          input.costCurrency === "PYG" ? 1 : input.exchangeRateToCompany ?? 0,
        ));
    return sameRequest
      ? { error: null, id: existing.id as string, retryable: false }
      : fail("La clave de idempotencia ya corresponde a otro movimiento.");
  }

  const { data: product } = await supabase
    .from("productos")
    .select("id, unidad")
    .eq("id", input.productoId)
    .eq("empresa_id", profile.empresa_id)
    .eq("activo", true)
    .maybeSingle();
  if (!product || typeof product.unidad !== "string" || !product.unidad.trim()) {
    return fail("El producto no está activo, no pertenece a esta empresa o no tiene unidad válida.");
  }

  const locationIds = [...new Set([input.fromLocationId, input.toLocationId].filter((id): id is string => !!id))];
  const { data: locations, error: locationError } = await supabase
    .from("inventory_locations")
    .select("id, project_id, location_type")
    .eq("empresa_id", profile.empresa_id)
    .eq("active", true)
    .in("id", locationIds);
  if (locationError) return fail(locationError.message);
  const locationById = new Map((locations ?? []).map((location) => [location.id as string, location]));
  if (locationIds.some((id) => !locationById.has(id))) {
    return fail("Una ubicación no está activa o no pertenece a esta empresa.");
  }
  const fromLocation = input.fromLocationId ? locationById.get(input.fromLocationId) : null;
  const toLocation = input.toLocationId ? locationById.get(input.toLocationId) : null;
  const projectId = resolveManualMovementProject(
    input.movementType,
    (fromLocation?.project_id as string | null | undefined) ?? null,
    (toLocation?.project_id as string | null | undefined) ?? null,
  );

  let negativeAdjustmentUnitCost: number | null = null;
  if (input.movementType === "ADJUSTMENT" && input.quantity < 0) {
    const { data: balance, error: balanceError } = await supabase
      .from("inventory_balances")
      .select("quantity, total_cost")
      .eq("empresa_id", profile.empresa_id)
      .eq("producto_id", input.productoId)
      .eq("location_id", input.fromLocationId!)
      .eq("cost_currency", input.costCurrency!)
      .eq("cost_status", "COMPUTABLE")
      .maybeSingle();
    if (balanceError) return fail(balanceError.message);
    const balanceQuantity = Number(balance?.quantity);
    const totalCost = Number(balance?.total_cost);
    if (!balance || !Number.isFinite(balanceQuantity) || balanceQuantity < Math.abs(input.quantity)) {
      return fail("Stock computable insuficiente en esa ubicación y moneda.");
    }
    if (balance.total_cost == null || !Number.isFinite(totalCost) || totalCost < 0 || balanceQuantity <= 0) {
      return fail("El costo del saldo seleccionado requiere revisión antes de ajustar.");
    }
    negativeAdjustmentUnitCost = Number((totalCost / balanceQuantity).toFixed(6));
  }

  let movement: InventoryMovementInput;
  try {
    movement = buildManualInventoryMovement(input, {
      empresaId: profile.empresa_id,
      createdBy: profile.id,
      unit: product.unidad,
      projectId,
      negativeAdjustmentUnitCost,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Los datos del movimiento no son válidos.");
  }

  const result = await postManualInventoryMovement(supabase, movement);
  if (result.error) {
    const retryable = /fetch failed|network|timeout|timed out|connection|abort|econn/i.test(result.error);
    return fail(result.error, retryable);
  }
  revalidatePath("/inventario");
  revalidatePath("/stock");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { error: null, id: result.data, retryable: false };
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
  if (
    !args ||
    typeof args.lineId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(args.lineId) ||
    !["PROPOSED", "CONFIRMED", "REJECTED"].includes(args.state)
  ) {
    return { error: "Los datos de revisión de la línea no son válidos." };
  }
  const productoId = clean(args.productoId);
  const budgetItemId = clean(args.budgetItemId);
  const unit = clean(args.unit);
  const quantity = args.quantity == null ? null : Number(args.quantity);
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0)) {
    return { error: "La cantidad debe ser mayor a cero." };
  }
  if (args.state === "CONFIRMED" && (!productoId || !budgetItemId || !unit || quantity == null)) {
    return { error: "Para confirmar la línea completá producto, cantidad, unidad y partida." };
  }
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
    .select("status, project_id")
    .eq("id", line.submission_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!submission || ["CONFIRMED", "VOIDED", "PROCESSING"].includes(submission.status)) {
    return { error: "La rendición está cerrada o en procesamiento y no admite cambios." };
  }
  if (productoId) {
    const { data: product } = await supabase
      .from("productos")
      .select("id, unidad, activo")
      .eq("id", productoId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!product || !product.activo) return { error: "El producto no existe, está inactivo o no pertenece a esta empresa." };
    if (unit && product.unidad.trim() !== unit.trim()) {
      return { error: "La unidad debe coincidir con la unidad del producto." };
    }
  }
  if (budgetItemId) {
    const { data: budgetItem } = await supabase
      .from("budget_items")
      .select("id")
      .eq("id", budgetItemId)
      .eq("project_id", submission.project_id)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!budgetItem) return { error: "La partida no pertenece a la obra de esta rendición." };
  }
  const { error } = await supabase
    .from("warehouse_submission_lines")
    .update({
      producto_id: productoId,
      quantity,
      unit,
      budget_item_id: budgetItemId,
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
  await admin
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
  await admin
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
