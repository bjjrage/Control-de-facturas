import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayLocationName } from "@/lib/inventory/display-location-name";
import { hashWarehousePortalToken, inspectWarehousePortalFile, sha256Bytes } from "@/lib/inventory/portal";
import { sanitizeFileName } from "@/lib/storage";
import { updateOpenWarehouseSubmission } from "@/lib/inventory/update-open-warehouse-submission";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

async function validateFiles(formData: FormData, limit: number, allowSheets: boolean): Promise<
  { files: Array<{ file: File; bytes: Uint8Array<ArrayBuffer>; contentType: string }>; error: null } |
  { files: []; error: string }
> {
  const submitted = formData.getAll("files").filter((value): value is File => value instanceof File && !!value.name);
  if (submitted.length > limit) return { files: [], error: `Adjunta hasta ${limit} archivos por envio.` };
  const files: Array<{ file: File; bytes: Uint8Array<ArrayBuffer>; contentType: string }> = [];
  for (const file of submitted) {
    if (!file.size || file.size > MAX_FILE_BYTES) return { files: [], error: `${file.name}: el archivo debe tener entre 1 byte y 20 MB.` };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectWarehousePortalFile(file.name, file.type, bytes, allowSheets);
    if (!inspected.ok || !inspected.contentType) return { files: [], error: inspected.error ?? "Archivo no permitido." };
    files.push({ file, bytes, contentType: inspected.contentType });
  }
  return { files, error: null };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type RouteContext = { params: Promise<{ token: string }> };

async function resolveLink(token: string) {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("warehouse_portal_links")
    .select("id, empresa_id, location_id, active, expires_at, created_by")
    .eq("token_hash", hashWarehousePortalToken(token))
    .maybeSingle();
  if (!link || !link.active || !link.expires_at || new Date(link.expires_at).getTime() <= Date.now()) return null;
  const { data: location } = await admin
    .from("inventory_locations")
    .select("id, name, project_id, location_type, active")
    .eq("id", link.location_id)
    .eq("empresa_id", link.empresa_id)
    .maybeSingle();
  if (!location || !location.active || location.location_type !== "PROJECT" || !location.project_id) return null;
  return { admin, link, location };
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveLink(token);
  if (!resolved) return NextResponse.json({ error: "Enlace inválido o vencido." }, { status: 404 });
  return NextResponse.json({
    location: displayLocationName(resolved.location.name),
    locationId: resolved.location.id,
    projectId: resolved.location.project_id,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveLink(token);
  if (!resolved) return NextResponse.json({ error: "Enlace inválido o vencido." }, { status: 404 });

  const { admin, link, location } = resolved;
  if (Number(request.headers.get("content-length") ?? 0) > 21 * 1024 * 1024) {
    return NextResponse.json({ error: "El envío supera el límite de 20 MB. Dividí los archivos en varios envíos." }, { status: 413 });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer el envío. Revisá los archivos y el límite de 20 MB." }, { status: 400 });
  }
  const action = String(formData.get("action") ?? "").trim().toLowerCase();

  // =========================================================================
  // ACTION: RECEIPT (Recepción de OC desde el Portal Único)
  // =========================================================================
  if (action === "receipt") {
    const orderId = String(formData.get("order_id") ?? "").trim();
    const fecha = String(formData.get("fecha") ?? "").trim();
    const recibidoPor = String(formData.get("recibido_por") ?? "").trim();
    const remisionNumber = String(formData.get("remision_number") ?? "").trim() || null;
    const notas = String(formData.get("notas") ?? "").trim() || null;
    const itemsRaw = String(formData.get("items") ?? "[]").trim();

    if (!orderId || !isIsoDate(fecha) || !recibidoPor) {
      return NextResponse.json({ error: "Faltan datos obligatorios (OC, fecha, responsable)." }, { status: 400 });
    }

    let items: Array<{ order_item_id: string; producto_id?: string | null; quantity: number }>;
    try {
      items = JSON.parse(itemsRaw);
      if (!Array.isArray(items) || items.length === 0) throw new Error("Sin líneas");
    } catch {
      return NextResponse.json({ error: "Las líneas de recepción no son válidas." }, { status: 400 });
    }

    // Verify the order belongs to this project and tenant
    const { data: order, error: orderError } = await admin
      .from("authorized_orders")
      .select("id, project_id, status")
      .eq("id", orderId)
      .eq("empresa_id", link.empresa_id)
      .eq("project_id", location.project_id)
      .maybeSingle();

    if (orderError || !order) {
      return NextResponse.json({ error: "La OC no pertenece a esta obra o empresa." }, { status: 404 });
    }

    const submitted = await validateFiles(formData, 10, false);
    if (submitted.error) return NextResponse.json({ error: submitted.error }, { status: 400 });
    const attempt = String(formData.get("idempotency_key") ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt)) return NextResponse.json({ error: "La recepción requiere un intento estable." }, { status: 400 });
    const { data: createData, error: createError } = await admin.rpc("inventory_portal_receipt", {
      p_token_hash: hashWarehousePortalToken(token), p_order: order.id, p_date: fecha,
      p_received_by: recibidoPor, p_remision: remisionNumber, p_attempt: attempt, p_notes: notas,
      p_items: items.map(i => ({ order_item_id: i.order_item_id, producto_id: i.producto_id || null, cantidad_recibida: Number(i.quantity), notas: null })),
    });

    if (createError) {
      return NextResponse.json({ error: createError.message ?? "No se pudo registrar la recepción." }, { status: 400 });
    }

    const receiptResult = createData as { receipt_id?: string } | null;
    const receiptId = receiptResult?.receipt_id;
    if (!receiptId) {
      return NextResponse.json({ error: "No se pudo generar el borrador de recepción." }, { status: 500 });
    }

    // Save all evidence before stock is posted. A failed upload leaves the
    // idempotent receipt in DRAFT so the same attempt can be retried safely.
    const evidenceWarnings: string[] = [];
    for (const { file, bytes, contentType } of submitted.files) {
      const sha256 = sha256Bytes(bytes);
      const { data: existing, error: existingError } = await admin.from("inventory_receipt_evidence")
        .select("id").eq("empresa_id", link.empresa_id).eq("receipt_id", receiptId).eq("sha256", sha256).limit(1).maybeSingle();
      if (existingError) { evidenceWarnings.push(file.name); continue; }
      if (existing) continue;
      const path = `receipts/${receiptId}/${randomUUID()}-${sanitizeFileName(file.name)}`;
      const { error: uploadErr } = await admin.storage.from("warehouse-evidence").upload(path, bytes, {
        contentType,
      });
      if (uploadErr) { evidenceWarnings.push(file.name); continue; }
      {
        const { error: evidenceError } = await admin.from("inventory_receipt_evidence").insert({
          empresa_id: link.empresa_id,
          receipt_id: receiptId,
          storage_bucket: "warehouse-evidence",
          storage_path: path,
          file_name: file.name,
          mime_type: contentType,
          size_bytes: file.size,
          sha256,
          uploaded_by: link.created_by,
        });
        if (evidenceError) {
          evidenceWarnings.push(file.name);
          await admin.storage.from("warehouse-evidence").remove([path]);
        }
      }
    }

    if (evidenceWarnings.length) {
      return NextResponse.json({
        ok: false, receiptId, status: "DRAFT", pendingEvidence: evidenceWarnings,
        error: "No se guardaron todos los adjuntos. Reintentá con los mismos datos; el stock todavía no se confirmó.",
      }, { status: 503 });
    }
    const { data: movements, error: confirmationError } = await admin.rpc("inventory_confirm_receipt", {
      p_empresa_id: link.empresa_id, p_receipt_id: receiptId,
      p_delivery_location_id: location.id,
      p_idempotency_key: `warehouse-portal-receipt:${link.id}:${attempt}`,
      p_confirmed_by: null,
    });
    if (confirmationError) {
      return NextResponse.json({
        ok: false, receiptId, status: "DRAFT",
        error: confirmationError.message ?? "No se pudo confirmar la recepción. Reintentá con los mismos datos.",
      }, { status: 409 });
    }
    return NextResponse.json({ ok: true, receiptId, status: "CONFIRMED", uploadIncomplete: false, pendingEvidence: [], movements });
  }


  // =========================================================================
  // ACTION: CONSUMPTION / SALIDA (Salida de material con imputación a partida)
  // =========================================================================
  if (action === "consumption") {
    const productoId = String(formData.get("producto_id") ?? "").trim();
    const quantity = Number(formData.get("quantity") ?? 0);
    const budgetItemId = String(formData.get("budget_item_id") ?? "").trim() || null;
    const withdrawnBy = String(formData.get("withdrawn_by") ?? "").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!productoId || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Seleccioná un producto y una cantidad válida mayor a cero." }, { status: 400 });
    }

    // Verify product exists in tenant
    const { data: product, error: prodErr } = await admin
      .from("productos")
      .select("id, nombre, unidad, activo")
      .eq("id", productoId)
      .eq("empresa_id", link.empresa_id)
      .maybeSingle();

    if (prodErr || !product || !product.activo) {
      return NextResponse.json({ error: "El producto seleccionado no está activo o no pertenece a la empresa." }, { status: 404 });
    }

    // If budget item is provided, verify it belongs to this project and tenant
    if (budgetItemId) {
      // budget_items no tiene empresa_id; el scoping multitenant queda garantizado
      // por project_id (la ubicación/link ya fue validado contra link.empresa_id)
      // y la RLS de budget_items resuelve la pertenencia vía projects.empresa_id.
      const { data: budgetItem, error: biErr } = await admin
        .from("budget_items")
        .select("id")
        .eq("id", budgetItemId)
        .eq("project_id", location.project_id)
        .maybeSingle();

      if (biErr) {
        return NextResponse.json({ error: "No se pudo validar la partida. Intentá nuevamente." }, { status: 500 });
      }
      if (!budgetItem) {
        return NextResponse.json({ error: "La partida no pertenece a esta obra." }, { status: 400 });
      }
    }

    const attempt = String(formData.get("idempotency_key") ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt) || !budgetItemId) {
      return NextResponse.json({ error: "La salida requiere partida y un intento estable." }, { status: 400 });
    }
    const submitted = await validateFiles(formData, 5, false);
    if (submitted.error) return NextResponse.json({ error: submitted.error }, { status: 400 });
    const { data: movementId, error: moveError } = await admin.rpc("inventory_portal_consumption", {
      p_token_hash: hashWarehousePortalToken(token),
      p_product: product.id, p_budget: budgetItemId, p_quantity: quantity, p_attempt: attempt,
      p_metadata: { withdrawn_by: withdrawnBy, notes },
    });

    if (moveError) {
      return NextResponse.json({ error: moveError.message ?? "No se pudo registrar la salida en el stock." }, { status: 400 });
    }

    // Upload photo evidence if attached
    const pendingEvidence: string[] = [];
    for (const { file, bytes, contentType } of submitted.files) {
      const path = `consumptions/${movementId}/${sha256Bytes(bytes)}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await admin.storage.from("warehouse-evidence").upload(path, bytes, {
        contentType,
        upsert: true,
      });
      if (uploadError) pendingEvidence.push(file.name);
    }

    // Update portal link usage timestamp
    await admin
      .from("warehouse_portal_links")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", link.id);

    return NextResponse.json({
      ok: true,
      movementId,
      uploadIncomplete: pendingEvidence.length > 0,
      pendingEvidence,
      message: pendingEvidence.length ? "Salida registrada, pero faltan adjuntos por guardar." : "Salida registrada con éxito.",
    });
  }

  // =========================================================================
  // ACTION: SUBMISSION (Rendición periódica / carga de evidencias o planilla)
  // =========================================================================
  const periodStart = String(formData.get("period_start") ?? "").trim();
  const periodEnd = String(formData.get("period_end") ?? "").trim();
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodEnd < periodStart) {
    return NextResponse.json({ error: "El período no es válido." }, { status: 400 });
  }

  const submitted = await validateFiles(formData, MAX_FILES, true);
  if (submitted.error) return NextResponse.json({ error: submitted.error }, { status: 400 });
  const files = submitted.files;
  if (!files.length) return NextResponse.json({ error: "Subí al menos una foto o planilla." }, { status: 400 });

  const notes = String(formData.get("notes") ?? "").trim() || null;
  const remisionNumber = String(formData.get("remision_number") ?? "").trim() || null;

  let { data: submission, error: submissionError } = await admin
    .from("warehouse_submissions")
    .insert({
      empresa_id: link.empresa_id,
      location_id: link.location_id,
      project_id: location.project_id,
      portal_link_id: link.id,
      period_start: periodStart,
      period_end: periodEnd,
      remision_number: remisionNumber,
      notes,
      status: "UPLOADED",
    })
    .select("id, status")
    .single();

  if (submissionError) {
    const existing = await admin
      .from("warehouse_submissions")
      .select("id, status")
      .eq("empresa_id", link.empresa_id)
      .eq("location_id", link.location_id)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();
    submission = existing.data;
    submissionError = existing.error;
  }
  if (submissionError || !submission) return NextResponse.json({ error: "No se pudo crear la rendición." }, { status: 409 });
  if (submission.status === "CONFIRMED" || submission.status === "VOIDED") {
    return NextResponse.json({ error: "El período ya está cerrado.", submissionId: submission.id }, { status: 409 });
  }

  const accepted: string[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];
  const resolvedSha256: string[] = [];
  const failedUploads: Array<{ sha256: string; file_name: string; reason: string }> = [];

  for (const { file, bytes, contentType } of files) {
    const sha256 = sha256Bytes(bytes);
    const { data: existingEvidence } = await admin
      .from("warehouse_submission_evidence")
      .select("id")
      .eq("submission_id", submission.id)
      .eq("sha256", sha256)
      .maybeSingle();
    if (existingEvidence) {
      accepted.push(file.name);
      resolvedSha256.push(sha256);
      continue;
    }
    const path = `${link.location_id}/${submission.id}/${randomUUID()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage.from("warehouse-evidence").upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (uploadError) {
      const reason = uploadError.message ?? "error al subir a storage";
      rejected.push({ file: file.name, reason });
      failedUploads.push({ sha256, file_name: file.name, reason });
      continue;
    }
    const { error: evidenceError } = await admin.from("warehouse_submission_evidence").insert({
      empresa_id: link.empresa_id,
      submission_id: submission.id,
      storage_bucket: "warehouse-evidence",
      storage_path: path,
      file_name: file.name,
      mime_type: contentType,
      size_bytes: file.size,
      sha256,
      uploaded_external: true,
    });
    if (evidenceError) {
      const { data: duplicateAfterRace } = await admin
        .from("warehouse_submission_evidence")
        .select("id")
        .eq("submission_id", submission.id)
        .eq("sha256", sha256)
        .maybeSingle();
      await admin.storage.from("warehouse-evidence").remove([path]);
      if (duplicateAfterRace) {
        accepted.push(file.name);
        resolvedSha256.push(sha256);
      } else {
        const reason = evidenceError.message ?? "error al registrar evidencia";
        rejected.push({ file: file.name, reason });
        failedUploads.push({ sha256, file_name: file.name, reason });
      }
      continue;
    }
    accepted.push(file.name);
    resolvedSha256.push(sha256);
  }

  const { data: gateRows, error: gateError } = await admin.rpc("inventory_apply_warehouse_upload_result", {
    p_empresa_id: link.empresa_id,
    p_submission_id: submission.id,
    p_resolved_sha256: resolvedSha256,
    p_failed: failedUploads,
  });
  if (gateError) {
    return NextResponse.json(
      { ok: false, error: "No se pudo actualizar el estado de ingestión.", submissionId: submission.id },
      { status: 500 }
    );
  }
  const gate = Array.isArray(gateRows) ? gateRows[0] : gateRows;
  const uploadIncomplete = Boolean(gate?.upload_incomplete);
  const pendingUploads = Array.isArray(gate?.pending_uploads) ? gate.pending_uploads : [];
  const pendingSummary = pendingUploads
    .map((p: { file_name?: string; reason?: string }) => `${p.file_name ?? "?"}: ${p.reason ?? "pendiente"}`)
    .join("; ");

  await admin
    .from("warehouse_portal_links")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", link.id)
    .eq("empresa_id", link.empresa_id);

  if (accepted.length === 0) {
    const allFailedMsg = `Falló la carga de todos los archivos: ${rejected.map((r) => `${r.file}: ${r.reason}`).join("; ")}`;
    const updated = await updateOpenWarehouseSubmission(admin, submission.id, link.empresa_id, {
        status: "NEEDS_REVIEW",
        processing_error: uploadIncomplete && pendingSummary ? `${allFailedMsg} | Pendientes: ${pendingSummary}` : allFailedMsg,
      });
    if (!updated) return NextResponse.json({ error: "La rendición ya fue cerrada.", submissionId: submission.id }, { status: 409 });
    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo guardar ningún archivo.",
        submissionId: submission.id,
        accepted,
        rejected,
        uploadIncomplete,
        pendingUploads,
      },
      { status: 500 }
    );
  }

  if (rejected.length > 0) {
    const partialMsg = `Carga parcial (${accepted.length}/${files.length}). Fallaron: ${rejected.map((r) => `${r.file}: ${r.reason}`).join("; ")}`;
    const updated = await updateOpenWarehouseSubmission(admin, submission.id, link.empresa_id, {
        status: "NEEDS_REVIEW",
        processing_error: pendingSummary ? `${partialMsg} | Pendientes: ${pendingSummary}` : partialMsg,
      });
    if (!updated) return NextResponse.json({ error: "La rendición ya fue cerrada.", submissionId: submission.id }, { status: 409 });
    return NextResponse.json(
      {
        ok: false,
        partial: true,
        error: partialMsg,
        submissionId: submission.id,
        uploaded: accepted.length,
        total: files.length,
        accepted,
        rejected,
        uploadIncomplete,
        pendingUploads,
      },
      { status: 207 }
    );
  }

  if (uploadIncomplete) {
    const updated = await updateOpenWarehouseSubmission(admin, submission.id, link.empresa_id, {
        status: "NEEDS_REVIEW",
        processing_error: pendingSummary ? `Quedan pendientes: ${pendingSummary}` : null,
      });
    if (!updated) return NextResponse.json({ error: "La rendición ya fue cerrada.", submissionId: submission.id }, { status: 409 });
    return NextResponse.json(
      {
        ok: true,
        partial: true,
        submissionId: submission.id,
        uploaded: accepted.length,
        total: files.length,
        accepted,
        rejected: [],
        uploadIncomplete: true,
        pendingUploads,
      },
      { status: 207 }
    );
  }

  const updated = await updateOpenWarehouseSubmission(admin, submission.id, link.empresa_id, { processing_error: null });
  if (!updated) return NextResponse.json({ error: "La rendición ya fue cerrada.", submissionId: submission.id }, { status: 409 });

  return NextResponse.json({
    ok: true,
    partial: false,
    submissionId: submission.id,
    uploaded: accepted.length,
    total: files.length,
    uploadIncomplete: false,
    pendingUploads: [],
    accepted,
    rejected: [],
  });
}
