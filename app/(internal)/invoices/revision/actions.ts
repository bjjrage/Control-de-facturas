"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoiceByAmount } from "@/lib/invoice-auto-match";
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
export async function resolveInvoiceJob(jobId: string, formData: FormData) {
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
  if (job.status === "done") return { error: "Este archivo ya fue procesado." };

  const providerId = str(formData, "provider_id");
  const invoiceNumber = str(formData, "invoice_number");
  const invoiceDate = str(formData, "invoice_date");
  const currency = str(formData, "currency") ?? "PYG";
  const total = num(formData, "total");

  if (!providerId || !invoiceNumber || !invoiceDate) {
    return { error: "Completá proveedor, número y fecha." };
  }
  if (total === null || total <= 0) return { error: "El total debe ser mayor a cero." };

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
    return {
      error:
        error?.code === "23505"
          ? "Ya existe una factura con ese número para este proveedor."
          : (error?.message ?? "No se pudo crear la factura."),
    };
  }

  await logAudit(supabase, { action: "invoice.created", invoiceId: invoice.id, detail: { source: "bulk_review" } });
  await autoMatchInvoiceByAmount(supabase, { invoiceId: invoice.id, providerId, total, empresaId });

  await supabase
    .from("invoice_jobs")
    .update({ status: "done", outcome: "created_unmatched", invoice_id: invoice.id, message: "Cargada desde revisión." })
    .eq("id", jobId);

  revalidatePath("/invoices/revision");
  revalidatePath("/invoices");
  return { error: null, invoiceId: invoice.id as string };
}

/** Reencola un job para que el worker lo intente de nuevo. */
export async function retryInvoiceJob(jobId: string) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  await supabase
    .from("invoice_jobs")
    .update({ status: "queued", attempts: 0, error: null, message: null, outcome: null })
    .eq("id", jobId)
    .eq("empresa_id", profile.empresa_id);
  revalidatePath("/invoices/revision");
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
