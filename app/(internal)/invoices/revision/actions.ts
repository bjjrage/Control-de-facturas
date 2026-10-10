"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoiceByAmount } from "@/lib/invoice-auto-match";
import { validateInvoiceArithmetic } from "@/lib/invoice-arithmetic";
import { INVOICE_QUANTITY_ERROR, isValidInvoiceQuantity } from "@/lib/invoice-item-reconcile";
import { applyDeterministicItemMatches, insertInvoiceItems, parseInvoiceLinesInput } from "@/lib/invoice-items";
import { revalidatePath } from "next/cache";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(fd: FormData, k: string) {
  const v = fd.get(k);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isOwnedInboxObject(bucket: string, path: string, empresaId: string) {
  const prefix = `${empresaId}/inbox/`;
  const tail = path.slice(prefix.length);
  return bucket === "invoice-files" && path.startsWith(prefix) && tail.length > 0
    && !tail.includes("..") && !tail.includes("\\") && !tail.includes("//");
}

/** Completa a mano un job que quedó en needs_review: crea la factura y lo cierra. */
export async function resolveInvoiceJob(jobId: string, formData: FormData): Promise<
  { error: string; invoiceId?: string; warning?: string } | { error: null; invoiceId: string; warning?: string }
> {
  const profile = await requireProfile(["administracion", "admin"]);
  const empresaId = profile.empresa_id;
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: job } = await supabase
    .from("invoice_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!job) return { error: "Job no encontrado." };
  if (job.status !== "needs_review" && job.status !== "failed") {
    return { error: "Este job no está disponible para resolución manual; actualizá la pantalla antes de continuar." };
  }
  if (job.invoice_id) {
    return {
      error: "Este job ya creó una factura. No se generó otra; revisá o corregí la factura existente.",
      invoiceId: job.invoice_id as string,
    };
  }
  if (!isOwnedInboxObject(job.storage_bucket, job.storage_path, empresaId)) {
    return { error: "El archivo del job no pertenece a la bandeja de esta empresa; no se modificó el archivo." };
  }

  const providerId = str(formData, "provider_id");
  const invoiceNumber = str(formData, "invoice_number");
  const invoiceDate = str(formData, "invoice_date");
  const currency = str(formData, "currency") ?? "PYG";
  const total = num(formData, "total");

  if (!providerId || !invoiceNumber || !invoiceDate) {
    return { error: "Completá proveedor, número y fecha." };
  }
  if (total === null || total <= 0) return { error: "El total debe ser mayor a cero." };

  // R3-04: misma validación server-side que el diálogo (los valores finales se
  // recalculan; ante discrepancia se exige confirmación explícita auditada).
  const jobLinesPreview = parseInvoiceLinesInput(
    (job.extracted as { items?: unknown } | null)?.items ?? []
  );
  if (jobLinesPreview.some((line) => line.quantity !== null && !isValidInvoiceQuantity(line.quantity))) {
    return { error: INVOICE_QUANTITY_ERROR };
  }
  const arithmetic = validateInvoiceArithmetic({
    provider_name: null,
    provider_tax_id: null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    subtotal: num(formData, "subtotal"),
    vat: num(formData, "vat"),
    total,
    timbrado: str(formData, "timbrado"),
    order_reference: null,
    product_description: null,
    items: jobLinesPreview.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      subtotal: l.subtotal,
    })),
  });
  if (arithmetic.status !== "VALIDA" && formData.get("arithmetic_confirmed") !== "on") {
    return {
      error: `Revisión aritmética: ${arithmetic.issues[0] ?? "datos inconsistentes."} Corregí los importes o confirmá explícitamente que los verificaste contra el documento.`,
    };
  }

  const { data: provider, error: providerError } = await supabase.from("providers")
    .select("id").eq("id", providerId).eq("empresa_id", empresaId).maybeSingle();
  if (providerError || !provider) return { error: "Proveedor no disponible para esta empresa." };

  // Claim the manual resolution before touching Storage or creating an invoice.
  // Concurrent submissions race on this conditional update; only one may proceed.
  const claim = await supabase.from("invoice_jobs")
    .update({ status: "processing", attempts: job.attempts + 1, locked_at: new Date().toISOString(), error: null, message: "Resolución manual en curso." })
    .eq("id", jobId)
    .eq("empresa_id", empresaId)
    .eq("status", job.status)
    .eq("attempts", job.attempts)
    .is("invoice_id", null)
    .select("attempts")
    .maybeSingle();
  if (claim.error || !claim.data) {
    return { error: "Este job ya está siendo procesado o cambió de estado. Actualizá la pantalla antes de continuar." };
  }
  const claimedAttempts = Number(claim.data.attempts);

  const restoreClaim = async (message: string) => {
    const restored = await supabase.from("invoice_jobs")
      .update({ status: job.status, locked_at: null, message })
      .eq("id", jobId)
      .eq("empresa_id", empresaId)
      .eq("status", "processing")
      .eq("attempts", claimedAttempts)
      .is("invoice_id", null)
      .select("id")
      .maybeSingle();
    return !restored.error && Boolean(restored.data);
  };

  // El archivo ya está en Storage (inbox). Lo movemos a su ubicación por proveedor.
  const finalPath = `${providerId}/${crypto.randomUUID()}-${sanitizeFileName(job.file_name)}`;
  let attachmentId: string | null = null;
  const copy = await admin.storage.from(job.storage_bucket).copy(job.storage_path, finalPath);
  if (copy.error) {
    await restoreClaim("No se pudo preparar el archivo; el job sigue disponible para revisión.");
    return { error: "No se pudo preparar el archivo adjunto." };
  }
  if (!copy.error) {
    const { data: att, error: attachmentError } = await admin
      .from("attachments")
      .insert({
        empresa_id: empresaId,
        bucket: "invoice-files",
        path: finalPath,
        file_name: job.file_name,
        mime_type: job.mime_type,
        uploaded_by: profile.id,
      })
      .select("id")
      .single();
    if (attachmentError || !att) {
      let warning: string | undefined;
      if (attachmentError?.code && /^[0-9A-Z]{5}$/.test(attachmentError.code)) {
        try {
          const removed = await admin.storage.from("invoice-files").remove([finalPath]);
          if (removed.error) warning = "No se pudo registrar el adjunto y su copia de Storage requiere limpieza.";
        } catch {
          warning = "No se pudo registrar el adjunto y falló la limpieza de su copia de Storage.";
        }
      } else {
        warning = "No se pudo confirmar el registro del adjunto; la copia se conservó para evitar borrar un archivo posiblemente referenciado.";
      }
      const restored = await restoreClaim("No se pudo registrar el adjunto; el job sigue disponible para revisión.");
      if (!restored) warning = [warning, "El job sigue reclamado y deberá recuperarse por vencimiento."].filter(Boolean).join(" ");
      return { error: attachmentError?.message ?? "No se pudo confirmar el registro del archivo adjunto.", ...(warning ? { warning } : {}) };
    }
    attachmentId = att.id;
  }

  const cleanupNewAttachment = async (): Promise<string | undefined> => {
    if (!attachmentId) return;
    let deleted: { id: string } | null = null;
    try {
      const result = await admin.from("attachments").delete()
        .eq("id", attachmentId).eq("empresa_id", empresaId)
        .select("id").maybeSingle();
      if (result.error) return "El archivo adjunto se conservó porque no se pudo confirmar la eliminación de su metadata.";
      deleted = result.data as { id: string } | null;
    } catch {
      return "El archivo adjunto se conservó porque falló la eliminación de su metadata.";
    }
    if (deleted?.id !== attachmentId) {
      return "El archivo adjunto se conservó porque su metadata sigue referenciada.";
    }
    try {
      const removed = await admin.storage.from("invoice-files").remove([finalPath]);
      if (removed.error) return "La metadata del adjunto se eliminó, pero no se pudo borrar el objeto de Storage.";
    } catch {
      return "La metadata del adjunto se eliminó, pero falló la limpieza del objeto de Storage.";
    }
  };

  const { data: createResult, error } = await supabase.rpc("create_invoice_from_job", {
    p_empresa_id: empresaId,
    p_job_id: jobId,
    p_expected_attempts: claimedAttempts,
    p_invoice: {
      provider_id: providerId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      currency,
      subtotal: num(formData, "subtotal"),
      vat: num(formData, "vat"),
      total,
      timbrado: str(formData, "timbrado"),
      attachment_id: attachmentId,
    },
  });
  const created = createResult as { ok?: boolean; invoice_id?: string; duplicate?: boolean; error?: string } | null;
  if (error || !created?.ok || !created.invoice_id) {
    if (!error || !error.code || !/^[0-9A-Z]{5}$/.test(error.code)) {
      // A transport failure or malformed success can hide a committed RPC.
      // Keep the lease and attachment intact for recovery to inspect.
      return { error: "No se pudo confirmar el resultado de creación. El job quedó protegido; verificá su estado antes de reintentar." };
    }
    const cleanupWarning = await cleanupNewAttachment();
    const claimRestored = await restoreClaim(error?.message ?? created?.error ?? "No se pudo crear la factura; el job requiere revisión.");
    return {
      error:
        error?.code === "23505"
          ? "Ya existe una factura con ese número para este proveedor."
          : (error?.message ?? created?.error ?? "No se pudo crear la factura."),
      ...(cleanupWarning || !claimRestored ? {
        warning: [cleanupWarning, !claimRestored ? "El job sigue reclamado y deberá recuperarse por vencimiento." : null].filter(Boolean).join(" "),
      } : {}),
    };
  }

  const invoiceId = created.invoice_id;
  if (created.duplicate) {
    const cleanupWarning = await cleanupNewAttachment();
    const duplicateUpdate = await supabase.from("invoice_jobs").update({
      status: "needs_review", outcome: "needs_manual", locked_at: null,
      message: "El job ya referencia una factura existente. No se repitieron líneas ni conciliaciones.",
    }).eq("id", jobId).eq("empresa_id", empresaId).eq("status", "processing")
      .eq("attempts", claimedAttempts).eq("invoice_id", invoiceId).select("id").maybeSingle();
    revalidatePath("/invoices/revision");
    return {
      error: "Este job ya creó una factura; se conservó su referencia sin duplicar líneas.",
      invoiceId,
      ...((cleanupWarning || duplicateUpdate.error || !duplicateUpdate.data) ? {
        warning: [cleanupWarning, duplicateUpdate.error?.message, !duplicateUpdate.data ? "El job requiere recuperación de estado." : null].filter(Boolean).join(" "),
      } : {}),
    };
  }

  // The RPC created the invoice and job reference atomically and wrote the
  // canonical invoice.created audit event in the same transaction.
  // Líneas del job revisado (si la extracción las trajo): habilitan la
  // conciliación por ítem sin cambiar el flujo de revisión existente. Un
  // multi-row INSERT garantiza todo-o-nada; ante error el job conserva el
  // invoice_id para impedir duplicarlo en un retry.
  const jobLines = parseInvoiceLinesInput(
    (job.extracted as { items?: unknown } | null)?.items ?? []
  );
  if (jobLines.length > 0) {
    const { error: linesError } = await insertInvoiceItems(supabase, {
      empresaId,
      invoiceId,
      items: jobLines,
    });
    if (linesError) {
      await logAudit(supabase, {
        action: "invoice.lines_save_failed",
        invoiceId,
        detail: { error: linesError },
      });
      await supabase.from("invoice_jobs").update({
        status: "needs_review",
        outcome: "needs_manual",
        invoice_id: invoiceId,
        locked_at: null,
        error: linesError,
        message: "La factura se creó, pero sus líneas no se guardaron. Revisá la factura existente antes de continuar.",
      }).eq("id", jobId).eq("empresa_id", empresaId)
        .eq("status", "processing").eq("attempts", claimedAttempts).eq("invoice_id", invoiceId);
      revalidatePath("/invoices/revision");
      revalidatePath("/invoices");
      return { error: "La factura se creó, pero no se guardaron sus líneas. No se vinculó ni concilió.", invoiceId };
    }
  }

  const matchedOrderId = await autoMatchInvoiceByAmount(supabase, { invoiceId, providerId, total, empresaId });
  let itemMatchError: string | null = null;
  let itemMatchPending = 0;
  if (jobLines.length > 0 && matchedOrderId) {
    const { error: itemError, pending } = await applyDeterministicItemMatches(supabase, {
      empresaId,
      invoiceId,
      orderId: matchedOrderId,
    });
    itemMatchPending = pending;
    if (itemError) {
      itemMatchError = itemError;
      await logAudit(supabase, {
        action: "invoice.item_match_failed",
        invoiceId,
        detail: { error: itemError },
      });
    }
  }

  const jobUpdate = await supabase
    .from("invoice_jobs")
    .update({
      status: itemMatchError || itemMatchPending > 0 ? "needs_review" : "done",
      outcome: itemMatchError || itemMatchPending > 0 ? "needs_manual" : matchedOrderId ? "matched" : "created_unmatched",
      invoice_id: invoiceId,
      locked_at: null,
      error: itemMatchError,
      message: itemMatchError
        ? "La factura se creó, pero falló una imputación de línea. Revisá las imputaciones antes de aprobar el pago."
        : itemMatchPending > 0
        ? `${itemMatchPending} línea(s) quedaron sin imputación; revisalas antes de aprobar el pago.`
        : matchedOrderId ? "Cargada y vinculada a una orden." : "Cargada, pero quedó sin vincular a una orden.",
    })
    .eq("id", jobId)
    .eq("empresa_id", empresaId)
    .eq("status", "processing")
    .eq("attempts", claimedAttempts)
    .eq("invoice_id", invoiceId)
    .select("id")
    .maybeSingle();

  revalidatePath("/invoices/revision");
  revalidatePath("/invoices");
  const warning = jobUpdate.error || !jobUpdate.data
    ? "La factura se creó, pero no se pudo actualizar el estado del job. Revisá la factura existente; no vuelvas a crearla."
    : itemMatchError
    ? "La factura se creó, pero requiere revisar sus imputaciones antes de aprobar el pago."
    : itemMatchPending > 0
    ? `${itemMatchPending} línea(s) quedaron sin imputación y requieren revisión.`
    : undefined;
  return { error: null, invoiceId, ...(warning ? { warning } : {}) };
}

/** Reencola un job para que el worker lo intente de nuevo. */
export async function retryInvoiceJob(jobId: string) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data: job, error: lookupError } = await supabase
    .from("invoice_jobs")
    .select("id, invoice_id, attempts")
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!job) return { error: "Job no encontrado." };
  if (job.invoice_id) return { error: "Este job ya creó una factura y no se puede reencolar. Revisá la factura existente." };
  const { data: updated, error } = await supabase
    .from("invoice_jobs")
    // attempts is also the fencing token; keep it monotonic across manual retries.
    .update({ status: "queued", error: null, message: null, outcome: null })
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id)
    .eq("status", "failed")
    .eq("attempts", job.attempts)
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "El job cambió de estado o ya creó una factura; actualizá la pantalla antes de reintentar." };
  revalidatePath("/invoices/revision");
  return { error: null };
}

/** Descarta un job (y borra su archivo del inbox). */
export async function discardInvoiceJob(jobId: string): Promise<{ error: string | null; warning?: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: job, error } = await supabase
    .from("invoice_jobs")
    .delete()
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id)
    .in("status", ["needs_review", "failed"])
    .is("invoice_id", null)
    .select("storage_bucket, storage_path")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!job) return { error: "El job cambió de estado o ya creó una factura; actualizá la pantalla." };

  // Delete wins the row lock before touching Storage. A concurrent resolver
  // must then fail its status CAS; if resolution wins, this DELETE returns no row.
  const prefix = `${profile.empresa_id}/inbox/`;
  const ownInboxPath = job.storage_bucket === "invoice-files"
    && job.storage_path.startsWith(prefix)
    && job.storage_path.length > prefix.length
    && !job.storage_path.slice(prefix.length).includes("..")
    && !job.storage_path.includes("\\")
    && !job.storage_path.includes("//");
  let warning: string | undefined;
  if (ownInboxPath) {
    try {
      const removed = await admin.storage.from("invoice-files").remove([job.storage_path]);
      if (removed.error) warning = "El job se descartó, pero no se pudo borrar su archivo de la bandeja.";
    } catch {
      warning = "El job se descartó, pero falló la limpieza de su archivo de la bandeja.";
    }
  } else {
    warning = "El job se descartó; el archivo se conservó porque su ruta no pertenece a la bandeja de esta empresa.";
  }
  revalidatePath("/invoices/revision");
  return { error: null, ...(warning ? { warning } : {}) };
}
