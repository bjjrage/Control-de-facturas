"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoiceByAmount } from "@/lib/invoice-auto-match";
import {
  ACCEPTED_INVOICE_FILE_TYPES,
  MAX_INVOICE_FILE_BYTES,
  extractInvoiceFieldsFromFile,
} from "@/lib/invoice-extraction";
import { findProviderByTaxId } from "@/lib/provider-lookup";
import { revalidatePath } from "next/cache";

export type BulkFileResult = {
  fileName: string;
  outcome: "matched" | "created_unmatched" | "needs_manual" | "error";
  message: string;
  invoiceId?: string;
  invoiceNumber?: string;
  providerName?: string | null;
  total?: number;
};

function result(fileName: string, outcome: BulkFileResult["outcome"], message: string, extra: Partial<BulkFileResult> = {}): BulkFileResult {
  return { fileName, outcome, message, ...extra };
}

/**
 * Processes one photo from a batch upload (a folder's worth of paper invoices
 * for a weekly/biweekly/monthly closing): reads it with GPT-4o-mini vision,
 * identifies the provider by RUC, creates the invoice, and runs the same
 * amount-based auto-match as the single-invoice flow. Never throws — every
 * outcome (including OpenAI/DB failures) comes back as a BulkFileResult so one
 * bad photo never stops the rest of the batch. Called once per file from the
 * client (bulk-form.tsx), which drives its own concurrency and progress UI.
 */
export async function processInvoicePhoto(formData: FormData): Promise<BulkFileResult> {
  const profile = await requireProfile(["administracion", "admin"]);

  const file = formData.get("file") as File | null;
  const batchDate = (formData.get("batch_date") as string | null) || new Date().toISOString().slice(0, 10);
  const fileName = file?.name ?? "(sin nombre)";

  if (!file || file.size === 0) return result(fileName, "error", "Archivo vacío.");
  if (file.size > MAX_INVOICE_FILE_BYTES) return result(fileName, "error", "El archivo supera los 20MB.");
  if (!ACCEPTED_INVOICE_FILE_TYPES.includes(file.type)) {
    return result(fileName, "error", "Formato no soportado (usá JPG, PNG, WEBP o PDF).");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const { data: parsed, error: extractError } = await extractInvoiceFieldsFromFile(bytes, file.type);
  if (extractError || !parsed) {
    return result(fileName, "needs_manual", extractError ?? "No se pudo leer la factura.");
  }

  const supabase = await createClient();
  const empresaId = profile.empresa_id;
  const provider = await findProviderByTaxId(supabase, parsed.provider_tax_id, empresaId);
  const providerId = provider?.id ?? null;
  const providerName = provider?.name ?? parsed.provider_name;

  if (!providerId) {
    return result(
      fileName,
      "needs_manual",
      `Proveedor no identificado (RUC ${parsed.provider_tax_id ?? "no detectado"}${
        parsed.provider_name ? `, "${parsed.provider_name}"` : ""
      }). Cargala a mano desde "Nueva factura".`
    );
  }
  if (!parsed.invoice_number) {
    return result(fileName, "needs_manual", `Número de factura no legible (proveedor: ${providerName}).`, {
      providerName,
    });
  }
  if (!parsed.total || parsed.total <= 0) {
    return result(fileName, "needs_manual", `Monto no legible (proveedor: ${providerName}).`, { providerName });
  }

  const admin = createAdminClient();
  const path = `${providerId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await admin.storage
    .from("invoice-files")
    .upload(path, file, { contentType: file.type || undefined });
  if (uploadError) return result(fileName, "error", "No se pudo subir el archivo: " + uploadError.message);

  const { data: attachment } = await admin
    .from("attachments")
    .insert({
      empresa_id: empresaId,
      bucket: "invoice-files",
      path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: profile.id,
    })
    .select("id")
    .single();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      provider_id: providerId,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date ?? batchDate,
      currency: "PYG",
      subtotal: parsed.subtotal,
      vat: parsed.vat,
      total: parsed.total,
      timbrado: parsed.timbrado,
      attachment_id: attachment?.id ?? null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (invoiceError || !invoice) {
    const message =
      invoiceError?.code === "23505"
        ? `Ya existe una factura con ese número para ${providerName}.`
        : (invoiceError?.message ?? "No se pudo crear la factura.");
    return result(fileName, "error", message, { providerName });
  }

  await logAudit(supabase, { action: "invoice.created", invoiceId: invoice.id, detail: { source: "bulk" } });

  const matchedOrderId = await autoMatchInvoiceByAmount(supabase, {
    invoiceId: invoice.id,
    providerId,
    total: parsed.total,
    empresaId,
  });

  revalidatePath("/invoices");

  return result(
    fileName,
    matchedOrderId ? "matched" : "created_unmatched",
    matchedOrderId
      ? "Conciliada automáticamente."
      : "Cargada, pero ninguna orden pendiente coincide en monto — vinculala a mano.",
    { invoiceId: invoice.id, invoiceNumber: parsed.invoice_number, providerName, total: parsed.total }
  );
}
