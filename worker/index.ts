/**
 * Worker de parseo de facturas. Corre siempre prendido en Railway (start:
 * `npx tsx worker/index.ts`). Hace polling de la tabla `invoice_jobs` cada
 * POLL_MS y procesa un job por ciclo:
 *
 *   descargar de Storage -> leer con GPT-4o / pdf-parse -> identificar proveedor
 *   por RUC -> crear factura + adjunto + auto-conciliar.
 *
 * Los que salen incompletos quedan en `needs_review` para la cola de revisión
 * manual del panel. Nunca tira: cualquier error deja el job en `failed` (o lo
 * reencola si attempts < MAX_ATTEMPTS) y sigue con el próximo.
 *
 * La lógica de extracción / lookup / match se reutiliza de lib/ tal cual — esos
 * archivos no dependen de Next.
 */
import { config } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { extractInvoiceFieldsFromFile } from "../lib/invoice-extraction";
import { findProviderByTaxId } from "../lib/provider-lookup";
import { autoMatchInvoice } from "../lib/invoice-auto-match";
import { matchInvoiceItemsToOrderItems } from "../lib/invoice-item-match";
import { logAudit } from "../lib/audit";
import { sanitizeFileName } from "../lib/storage";

// Local: toma las credenciales de .env.local. En Railway vienen de las env vars
// del servicio y esto es no-op.
config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2500);
const MAX_ATTEMPTS = 3;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY");
  process.exit(1);
}

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type InvoiceJob = {
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

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function finish(jobId: string, patch: Record<string, unknown>) {
  await db.from("invoice_jobs").update({ locked_at: null, ...patch }).eq("id", jobId);
}

async function processJob(job: InvoiceJob) {
  log(`job ${job.id} — ${job.file_name} (intento ${job.attempts})`);

  const { data: blob, error: dlError } = await db.storage
    .from(job.storage_bucket)
    .download(job.storage_path);
  if (dlError || !blob) {
    return finish(job.id, { status: "failed", error: `No se pudo bajar el archivo: ${dlError?.message ?? "?"}` });
  }
  const bytes = Buffer.from(await blob.arrayBuffer());

  const { data: parsed, error: extractError } = await extractInvoiceFieldsFromFile(bytes, job.mime_type);
  if (extractError || !parsed) {
    if (job.attempts < MAX_ATTEMPTS) {
      return finish(job.id, { status: "queued", error: extractError ?? "Lectura fallida" });
    }
    return finish(job.id, {
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
    return finish(job.id, {
      status: "needs_review",
      outcome: "needs_manual",
      extracted: parsed,
      provider_id: provider?.id ?? null,
      message: `${reason} Completala en revisión.`,
    });
  }

  // Adjunto: copiar el archivo del inbox a su ubicación definitiva por proveedor.
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
    return finish(job.id, {
      status: "needs_review",
      outcome: dup ? "duplicate" : "error",
      extracted: parsed,
      provider_id: provider.id,
      error: invoiceError?.message,
      message: dup ? `Ya existe una factura con ese número para ${providerName}.` : (invoiceError?.message ?? "No se pudo crear la factura."),
    });
  }

  await logAudit(db, { action: "invoice.created", invoiceId: invoice.id, detail: { source: "bulk_worker" } });

  // Guardar líneas de detalle extraídas por el AI.
  const invoiceItemIds: { id: string; idx: number }[] = [];
  if (parsed.items && parsed.items.length > 0) {
    for (let i = 0; i < parsed.items.length; i++) {
      const item = parsed.items[i];
      if (!item.description?.trim()) continue;
      const { data: ii } = await db
        .from("invoice_items")
        .insert({
          invoice_id: invoice.id,
          empresa_id: job.empresa_id,
          product_description: item.description.trim(),
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          sort_order: i,
        })
        .select("id")
        .single();
      if (ii) invoiceItemIds.push({ id: ii.id as string, idx: i });
    }
  }

  const matchedOrderId = await autoMatchInvoice(db, {
    invoiceId: invoice.id,
    providerId: provider.id,
    total: parsed.total,
    empresaId: job.empresa_id,
    orderReference: parsed.order_reference,
    productDescription: parsed.product_description,
  });

  // Si se matcheó la OC y hay ítems en ambos lados, hacer matching semántico de líneas.
  if (matchedOrderId && invoiceItemIds.length > 0) {
    const { data: orderItems } = await db
      .from("authorized_order_items")
      .select("id, product, quantity, unit, quantity_invoiced")
      .eq("order_id", matchedOrderId)
      .order("sort_order");

    if (orderItems && orderItems.length > 0) {
      const invoiceItemsForMatch = invoiceItemIds.map(({ id, idx }) => ({
        id,
        description: parsed.items[idx].description,
        quantity: parsed.items[idx].quantity,
        unit: parsed.items[idx].unit,
      }));

      const itemMatches = await matchInvoiceItemsToOrderItems(
        orderItems.map((o) => ({
          id: o.id as string,
          product: o.product as string,
          quantity: o.quantity as number,
          unit: o.unit as string,
          quantity_invoiced: o.quantity_invoiced as number,
        })),
        invoiceItemsForMatch
      );

      for (const m of itemMatches) {
        await db.from("invoice_item_matches").insert({
          invoice_item_id: m.invoice_item_id,
          order_item_id: m.order_item_id,
          empresa_id: job.empresa_id,
          quantity_matched: m.quantity_matched,
        });
      }
    }
  }

  return finish(job.id, {
    status: "done",
    outcome: matchedOrderId ? "matched" : "created_unmatched",
    extracted: parsed,
    provider_id: provider.id,
    invoice_id: invoice.id,
    message: matchedOrderId
      ? "Conciliada automáticamente."
      : "Cargada, pero ninguna orden pendiente coincide — vinculala a mano.",
  });
}

async function main() {
  log(`worker arrancado — polling cada ${POLL_MS}ms`);
  while (!stopping) {
    // Reencolar jobs huérfanos antes de reclamar uno nuevo.
    // Si el worker murió a mitad de un job, locked_at queda viejo; esta llamada
    // los devuelve a 'queued' (o a 'failed' si ya agotaron MAX_ATTEMPTS).
    try {
      const { data: stale, error: staleErr } = await db.rpc("requeue_stale_invoice_jobs", {
        timeout_minutes: 30,  // locked_at no se actualiza durante el procesamiento → este es el tiempo máximo de un job
        max_attempts: MAX_ATTEMPTS,
      });
      if (staleErr) log("requeue_stale error:", staleErr.message);
      else if (stale && stale > 0) log(`requeue_stale: ${stale} job(s) recuperados`);
    } catch (e) {
      log("requeue_stale throw:", (e as Error).message);
    }

    let job: InvoiceJob | null = null;
    try {
      const { data, error } = await db.rpc("claim_invoice_job");
      if (error) { log("claim error:", error.message); }
      else job = (data && data.id ? data : null) as InvoiceJob | null;
    } catch (e) {
      log("claim throw:", (e as Error).message);
    }

    if (!job) { await sleep(POLL_MS); continue; }

    try {
      await processJob(job);
    } catch (e) {
      log(`job ${job.id} throw:`, (e as Error).message);
      await finish(job.id, { status: "failed", error: (e as Error).message ?? "error inesperado" });
    }
  }
  log("worker detenido");
  process.exit(0);
}

main();
