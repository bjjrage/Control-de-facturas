/**
 * Núcleo del parseo de facturas del bulk: descargar de Storage -> leer con
 * GPT-4o / pdf-parse -> identificar proveedor por RUC -> crear factura + adjunto
 * + auto-conciliar. Sin dependencias de Next: lo usan tanto el worker
 * standalone (worker/index.ts) como el route handler que lo dispara desde la
 * app (app/api/invoices/process-jobs/route.ts).
 */
import { SupabaseClient } from "@supabase/supabase-js";
import { extractInvoiceFieldsFromFile } from "./invoice-extraction";
import { findProviderByTaxId } from "./provider-lookup";
import { autoMatchInvoiceByAmount } from "./invoice-auto-match";
import { logAudit } from "./audit";
import { sanitizeFileName } from "./storage";

const MAX_ATTEMPTS = 3;

export type InvoiceJobRow = {
  id: string;
  empresa_id: string;
  created_by: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  batch_date: string;
  attempts: number;
};

async function finish(db: SupabaseClient, jobId: string, patch: Record<string, unknown>) {
  await db.from("invoice_jobs").update({ locked_at: null, ...patch }).eq("id", jobId);
}

/** Procesa un job ya reclamado (status 'processing'). Nunca tira. */
export async function processInvoiceJob(db: SupabaseClient, job: InvoiceJobRow): Promise<void> {
  const { data: blob, error: dlError } = await db.storage.from(job.storage_bucket).download(job.storage_path);
  if (dlError || !blob) {
    return finish(db, job.id, { status: "failed", error: `No se pudo bajar el archivo: ${dlError?.message ?? "?"}` });
  }
  const bytes = Buffer.from(await blob.arrayBuffer());

  const { data: parsed, error: extractError } = await extractInvoiceFieldsFromFile(bytes, job.mime_type);
  if (extractError || !parsed) {
    if (job.attempts < MAX_ATTEMPTS) {
      return finish(db, job.id, { status: "queued", error: extractError ?? "Lectura fallida" });
    }
    return finish(db, job.id, {
      status: "needs_review",
      outcome: "needs_manual",
      error: extractError ?? "No se pudo leer la factura",
      message: extractError ?? "No se pudo leer la factura — cargala a mano.",
    });
  }

  const provider = await findProviderByTaxId(db, parsed.provider_tax_id, job.empresa_id);
  const providerName = provider?.name ?? parsed.provider_name;

  if (!provider || !parsed.invoice_number || !parsed.total || parsed.total <= 0) {
    const reason = !provider
      ? `Proveedor no identificado (RUC ${parsed.provider_tax_id ?? "no detectado"}${parsed.provider_name ? `, "${parsed.provider_name}"` : ""}).`
      : !parsed.invoice_number
        ? "Número de factura no legible."
        : "Monto no legible.";
    return finish(db, job.id, {
      status: "needs_review",
      outcome: "needs_manual",
      extracted: parsed,
      provider_id: provider?.id ?? null,
      message: `${reason} Completala en revisión.`,
    });
  }

  const finalPath = `${provider.id}/${Date.now()}-${sanitizeFileName(job.file_name)}`;
  await db.storage.from("invoice-files").copy(job.storage_path, finalPath);

  const { data: attachment } = await db
    .from("attachments")
    .insert({
      empresa_id: job.empresa_id,
      bucket: "invoice-files",
      path: finalPath,
      file_name: job.file_name,
      mime_type: job.mime_type,
      size_bytes: bytes.length,
      uploaded_by: job.created_by,
    })
    .select("id")
    .single();

  const { data: invoice, error: invoiceError } = await db
    .from("invoices")
    .insert({
      empresa_id: job.empresa_id,
      provider_id: provider.id,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date ?? job.batch_date,
      currency: "PYG",
      subtotal: parsed.subtotal,
      vat: parsed.vat,
      total: parsed.total,
      timbrado: parsed.timbrado,
      attachment_id: attachment?.id ?? null,
      created_by: job.created_by,
    })
    .select("id")
    .single();

  if (invoiceError || !invoice) {
    const dup = invoiceError?.code === "23505";
    return finish(db, job.id, {
      status: dup ? "needs_review" : "failed",
      outcome: dup ? "needs_manual" : "error",
      extracted: parsed,
      provider_id: provider.id,
      error: invoiceError?.message,
      message: dup
        ? `Ya existe una factura con ese número para ${providerName}.`
        : (invoiceError?.message ?? "No se pudo crear la factura."),
    });
  }

  await logAudit(db, { action: "invoice.created", invoiceId: invoice.id, detail: { source: "bulk_worker" } });

  const matchedOrderId = await autoMatchInvoiceByAmount(db, {
    invoiceId: invoice.id,
    providerId: provider.id,
    total: parsed.total,
    empresaId: job.empresa_id,
  });

  return finish(db, job.id, {
    status: "done",
    outcome: matchedOrderId ? "matched" : "created_unmatched",
    extracted: parsed,
    provider_id: provider.id,
    invoice_id: invoice.id,
    message: matchedOrderId
      ? "Conciliada automáticamente."
      : "Cargada, pero ninguna orden pendiente coincide en monto — vinculala a mano.",
  });
}

/**
 * Reclama y procesa jobs de la cola hasta que se vacíe, se agote el
 * presupuesto de tiempo, o se llegue a `maxJobs`. Devuelve un resumen.
 */
export async function drainInvoiceJobs(
  db: SupabaseClient,
  opts: { maxJobs?: number; maxMs?: number } = {}
): Promise<{ processed: number; remaining: number }> {
  const maxJobs = opts.maxJobs ?? 25;
  const deadline = Date.now() + (opts.maxMs ?? 45_000);
  let processed = 0;

  while (processed < maxJobs && Date.now() < deadline) {
    const { data: job, error } = await db.rpc("claim_invoice_job");
    if (error || !job || !job.id) break;
    try {
      await processInvoiceJob(db, job as InvoiceJobRow);
    } catch (e) {
      await finish(db, job.id, { status: "failed", error: (e as Error).message ?? "error inesperado" });
    }
    processed++;
  }

  const { count } = await db
    .from("invoice_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "processing"]);

  return { processed, remaining: count ?? 0 };
}
