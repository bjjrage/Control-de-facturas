"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoiceByAmount } from "@/lib/invoice-auto-match";
import { validateInvoiceArithmetic } from "@/lib/invoice-arithmetic";
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

/** Completa a mano un job que quedó en needs_review: crea la factura y lo cierra. */
export async function resolveInvoiceJob(jobId: string, formData: FormData): Promise<
  { error: string; invoiceId?: string; warning?: undefined } | { error: null; invoiceId: string; warning?: string }
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
    .update({ status: "processing", error: null, message: "Resolución manual en curso." })
    .eq("id", jobId)
    .eq("empresa_id", empresaId)
    .eq("status", job.status)
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) {
    return { error: "Este job ya está siendo procesado o cambió de estado. Actualizá la pantalla antes de continuar." };
  }

  const restoreClaim = async (message: string) => {
    await supabase.from("invoice_jobs")
      .update({ status: job.status, message })
      .eq("id", jobId)
      .eq("empresa_id", empresaId)
      .eq("status", "processing")
      .is("invoice_id", null);
  };

  // El archivo ya está en Storage (inbox). Lo movemos a su ubicación por proveedor.
  const finalPath = `${providerId}/${Date.now()}-${sanitizeFileName(job.file_name)}`;
  let attachmentId: string | null = null;
  const copy = await admin.storage.from("invoice-files").copy(job.storage_path, finalPath);
  if (!copy.error) {
    const { data: att } = await admin
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
    attachmentId = att?.id ?? null;
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      provider_id: providerId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      currency,
      subtotal: num(formData, "subtotal"),
      vat: num(formData, "vat"),
      total,
      timbrado: str(formData, "timbrado"),
      attachment_id: attachmentId,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !invoice) {
    await restoreClaim(error?.message ?? "No se pudo crear la factura; el job requiere revisión.");
    return {
      error:
        error?.code === "23505"
          ? "Ya existe una factura con ese número para este proveedor."
          : (error?.message ?? "No se pudo crear la factura."),
    };
  }

  // Persist the invoice reference immediately. From this point onward a retry
  // must resume by inspecting this invoice, never create another one.
  const checkpoint = await supabase.from("invoice_jobs")
    .update({
      status: "needs_review",
      outcome: "needs_manual",
      invoice_id: invoice.id,
      message: "La factura se creó; se está verificando su contenido y conciliación.",
    })
    .eq("id", jobId)
    .eq("empresa_id", empresaId)
    .eq("status", "processing")
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (checkpoint.error || !checkpoint.data) {
    revalidatePath("/invoices/revision");
    revalidatePath("/invoices");
    return {
      error: "La factura se creó, pero el job no pudo guardar su referencia. No vuelvas a crearla; verificá la factura existente.",
      invoiceId: invoice.id as string,
    };
  }

  await logAudit(supabase, {
    action: "invoice.created",
    invoiceId: invoice.id,
    detail: {
      source: "bulk_review",
      ...(arithmetic.status !== "VALIDA" ? { arithmetic_review: "confirmed" } : {}),
    },
  });
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
      invoiceId: invoice.id as string,
      items: jobLines,
    });
    if (linesError) {
      await logAudit(supabase, {
        action: "invoice.lines_save_failed",
        invoiceId: invoice.id,
        detail: { error: linesError },
      });
      await supabase.from("invoice_jobs").update({
        status: "needs_review",
        outcome: "needs_manual",
        invoice_id: invoice.id,
        error: linesError,
        message: "La factura se creó, pero sus líneas no se guardaron. Revisá la factura existente antes de continuar.",
      }).eq("id", jobId).eq("empresa_id", empresaId)
        .eq("status", "needs_review").eq("invoice_id", invoice.id);
      revalidatePath("/invoices/revision");
      revalidatePath("/invoices");
      return { error: "La factura se creó, pero no se guardaron sus líneas. No se vinculó ni concilió.", invoiceId: invoice.id as string };
    }
  }

  const matchedOrderId = await autoMatchInvoiceByAmount(supabase, { invoiceId: invoice.id, providerId, total, empresaId });
  let itemMatchError: string | null = null;
  let itemMatchPending = 0;
  if (jobLines.length > 0 && matchedOrderId) {
    const { error: itemError, pending } = await applyDeterministicItemMatches(supabase, {
      empresaId,
      invoiceId: invoice.id as string,
      orderId: matchedOrderId,
    });
    itemMatchPending = pending;
    if (itemError) {
      itemMatchError = itemError;
      await logAudit(supabase, {
        action: "invoice.item_match_failed",
        invoiceId: invoice.id,
        detail: { error: itemError },
      });
    }
  }

  const jobUpdate = await supabase
    .from("invoice_jobs")
    .update({
      status: itemMatchError ? "needs_review" : "done",
      outcome: itemMatchError ? "needs_manual" : matchedOrderId ? "matched" : "created_unmatched",
      invoice_id: invoice.id,
      error: itemMatchError,
      message: itemMatchError
        ? "La factura se creó, pero falló una imputación de línea. Revisá las imputaciones antes de aprobar el pago."
        : itemMatchPending > 0
        ? `${itemMatchPending} línea(s) quedaron sin imputación; revisalas antes de aprobar el pago.`
        : matchedOrderId ? "Cargada y vinculada a una orden." : "Cargada, pero quedó sin vincular a una orden.",
    })
    .eq("id", jobId)
    .eq("empresa_id", empresaId)
    .eq("status", "needs_review")
    .eq("invoice_id", invoice.id)
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
  return { error: null, invoiceId: invoice.id as string, ...(warning ? { warning } : {}) };
}

/** Reencola un job para que el worker lo intente de nuevo. */
export async function retryInvoiceJob(jobId: string) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data: job, error: lookupError } = await supabase
    .from("invoice_jobs")
    .select("id, invoice_id")
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (lookupError) return { error: lookupError.message };
  if (!job) return { error: "Job no encontrado." };
  if (job.invoice_id) return { error: "Este job ya creó una factura y no se puede reencolar. Revisá la factura existente." };
  const { data: updated, error } = await supabase
    .from("invoice_jobs")
    .update({ status: "queued", attempts: 0, error: null, message: null, outcome: null })
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id)
    .eq("status", "failed")
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "El job cambió de estado o ya creó una factura; actualizá la pantalla antes de reintentar." };
  revalidatePath("/invoices/revision");
  return { error: null };
}

/** Descarta un job (y borra su archivo del inbox). */
export async function discardInvoiceJob(jobId: string) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: job } = await supabase
    .from("invoice_jobs")
    .select("storage_path, invoice_id")
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!job) return;
  if (job.invoice_id) return; // ya generó una factura — no se descarta

  await admin.storage.from("invoice-files").remove([job.storage_path]);
  await supabase.from("invoice_jobs").delete().eq("id", jobId).eq("empresa_id", profile.empresa_id);
  revalidatePath("/invoices/revision");
}
